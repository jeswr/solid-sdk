// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it, vi } from "vitest";
import { findComponents, parseComponents } from "../src/ical.js";
import {
  defaultContactSlug,
  defaultEventSlug,
  importAddressBook,
  importCalendar,
} from "../src/ingest.js";
import { vcardToContact, veventToEvent } from "../src/map.js";
import {
  vcardBasic,
  vcardHostile,
  vcardMessy,
  vcardMulti,
  veventHostile,
  veventMulti,
  veventWithRrule,
} from "./fixtures.js";

/** A stubbed authed fetch that records every request and returns a 201. */
function recordingFetch(status = 201) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetchFn, calls };
}

const CONTAINER = "https://alice.pod.example/imports/dav/";

describe("importCalendar", () => {
  it("writes a single VEVENT as one Turtle resource under the container", async () => {
    const { fetchFn, calls } = recordingFetch();
    const result = await importCalendar({
      writeFetch: fetchFn,
      container: CONTAINER,
      icsText: veventWithRrule,
    });

    expect(result.total).toBe(1);
    expect(result.written).toBe(1);
    expect(result.failed).toBe(0);
    expect(calls).toHaveLength(1);

    const { url, init } = calls[0] ?? { url: "", init: {} };
    expect(url.startsWith(CONTAINER)).toBe(true);
    expect(url.endsWith(".ttl")).toBe(true);
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("text/turtle");
    const body = String(init.body);
    expect(body).toContain("schema:Event");
    expect(body).toContain("Weekly standup");
    expect(body).toContain("ical:rrule");
  });

  it("writes every VEVENT of a multi-event calendar", async () => {
    const { fetchFn, calls } = recordingFetch();
    const result = await importCalendar({
      writeFetch: fetchFn,
      container: CONTAINER,
      icsText: veventMulti,
    });
    expect(result.total).toBe(2);
    expect(result.written).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it("OWNER-PRIVACY: never writes an .acl/.acr and never authors a broadening ACL", async () => {
    const { fetchFn, calls } = recordingFetch();
    await importCalendar({ writeFetch: fetchFn, container: CONTAINER, icsText: veventMulti });
    for (const { url, init } of calls) {
      expect(init.method).toBe("PUT");
      expect(url).not.toMatch(/\.acl$/);
      expect(url).not.toMatch(/\.acr$/);
      const body = String(init.body ?? "");
      expect(body).not.toContain("acl:agentClass");
      expect(body).not.toContain("foaf:Agent");
      expect(body).not.toContain("acl:Authorization");
    }
  });

  it("appends a trailing slash to a container missing one", async () => {
    const { fetchFn, calls } = recordingFetch();
    await importCalendar({
      writeFetch: fetchFn,
      container: "https://alice.pod.example/imports/dav",
      icsText: veventWithRrule,
    });
    expect(calls[0]?.url.startsWith("https://alice.pod.example/imports/dav/")).toBe(true);
  });

  it("default event slug is STABLE across runs (idempotent re-sync of the same UID)", async () => {
    const a = recordingFetch();
    const b = recordingFetch();
    await importCalendar({ writeFetch: a.fetchFn, container: CONTAINER, icsText: veventWithRrule });
    await importCalendar({ writeFetch: b.fetchFn, container: CONTAINER, icsText: veventWithRrule });
    expect(a.calls[0]?.url).toBe(b.calls[0]?.url);
  });

  it("honours a custom slug function", async () => {
    const { fetchFn, calls } = recordingFetch();
    await importCalendar({
      writeFetch: fetchFn,
      container: CONTAINER,
      icsText: veventWithRrule,
      slug: (_e, i) => `evt-${i}.ttl`,
    });
    expect(calls[0]?.url).toBe(`${CONTAINER}evt-0.ttl`);
  });

  it("SLUG ESCAPE: a traversal/separator slug cannot escape the container", async () => {
    for (const evil of ["..%2f..%2fevil.ttl", "../../evil.ttl", "/abs/evil.ttl", "a/b/c.ttl"]) {
      const { fetchFn, calls } = recordingFetch();
      await importCalendar({
        writeFetch: fetchFn,
        container: CONTAINER,
        icsText: veventWithRrule,
        slug: () => evil,
      });
      const url = calls[0]?.url ?? "";
      expect(url.startsWith(CONTAINER)).toBe(true);
      const tail = url.slice(CONTAINER.length);
      expect(tail).not.toContain("/");
    }
  });

  it("SLUG ESCAPE: a slug resolving to the container itself is REJECTED (no PUT)", async () => {
    for (const evil of ["", ".", "/", "//"]) {
      const { fetchFn, calls } = recordingFetch();
      await expect(
        importCalendar({
          writeFetch: fetchFn,
          container: CONTAINER,
          icsText: veventWithRrule,
          slug: () => evil,
        }),
      ).rejects.toThrow(/slug/);
      expect(calls).toHaveLength(0);
    }
  });

  // POD-SCOPE HARDENING (raw-string sweep, security/podscope-rawstring): the
  // container/scope logic now goes through `@jeswr/guarded-fetch`'s
  // `normalizePodBase`/`assertWithinPodScope` (parsed via `new URL()`, decides the
  // trailing slash from the PATH only) instead of a bespoke `container.endsWith("/")`
  // / `resolved.startsWith(base)` raw-string check. The bespoke check was fooled by a
  // container whose PATH lacked a trailing slash but whose QUERY/FRAGMENT happened to
  // END in "/" (e.g. `.../other?x=/`) — `.endsWith("/")` read that as "already
  // slash-terminated", so a resolved child landed as a SIBLING of `/other` (e.g.
  // `.../evt-0.ttl`) instead of nested under it (`.../other/evt-0.ttl`). These pin the
  // corrected behaviour: the query/fragment is discarded and the trailing slash is
  // decided from the real path, so every child still resolves strictly under the
  // intended container.
  it("POD-SCOPE: a container whose QUERY ends in '/' cannot smuggle a non-slash path past the check", async () => {
    const { fetchFn, calls } = recordingFetch();
    await importCalendar({
      writeFetch: fetchFn,
      container: `${CONTAINER.slice(0, -1)}?x=/`, // .../dav?x=/  (path has NO trailing slash)
      icsText: veventWithRrule,
      slug: () => "evt-0.ttl",
    });
    expect(calls).toHaveLength(1);
    const url = calls[0]?.url ?? "";
    // Correct: nested under the real container path, not a sibling of it, and no
    // query string survives onto the written resource URL.
    expect(url).toBe(`${CONTAINER}evt-0.ttl`);
  });

  it("POD-SCOPE: a container whose FRAGMENT ends in '/' cannot smuggle a non-slash path past the check", async () => {
    const { fetchFn, calls } = recordingFetch();
    await importCalendar({
      writeFetch: fetchFn,
      container: `${CONTAINER.slice(0, -1)}#/`, // .../dav#/  (path has NO trailing slash)
      icsText: veventWithRrule,
      slug: () => "evt-0.ttl",
    });
    expect(calls).toHaveLength(1);
    const url = calls[0]?.url ?? "";
    expect(url).toBe(`${CONTAINER}evt-0.ttl`);
  });

  it("POD-SCOPE: a real, already-normalised container is accepted unchanged", async () => {
    const { fetchFn, calls } = recordingFetch();
    await importCalendar({
      writeFetch: fetchFn,
      container: CONTAINER,
      icsText: veventWithRrule,
      slug: () => "evt-0.ttl",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${CONTAINER}evt-0.ttl`);
  });

  it("POD-SCOPE: a child path resolves correctly (strictly nested, no escape)", async () => {
    const { fetchFn, calls } = recordingFetch();
    await importCalendar({
      writeFetch: fetchFn,
      container: CONTAINER,
      icsText: veventWithRrule,
      slug: () => "sub/evt-0.ttl", // the "/" is sanitised, but confirm the resolved child stays nested
    });
    expect(calls).toHaveLength(1);
    const url = calls[0]?.url ?? "";
    expect(url.startsWith(CONTAINER)).toBe(true);
    expect(url).not.toBe(CONTAINER);
  });

  it("POD-SCOPE: a container escaping to a foreign origin is rejected", async () => {
    const { fetchFn } = recordingFetch();
    await expect(
      importCalendar({
        writeFetch: fetchFn,
        container: "javascript:alert(1)//",
        icsText: veventWithRrule,
        slug: () => "evt-0.ttl",
      }),
    ).rejects.toThrow(/container/);
  });

  it("if-none-match conditional adds If-None-Match: *", async () => {
    const { fetchFn, calls } = recordingFetch();
    await importCalendar({
      writeFetch: fetchFn,
      container: CONTAINER,
      icsText: veventWithRrule,
      conditional: "if-none-match",
    });
    expect((calls[0]?.init.headers as Record<string, string>)["if-none-match"]).toBe("*");
  });

  it("respects maxItems", async () => {
    const { fetchFn, calls } = recordingFetch();
    const result = await importCalendar({
      writeFetch: fetchFn,
      container: CONTAINER,
      icsText: veventMulti,
      maxItems: 1,
    });
    expect(result.total).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("HARDENING: a hostile VEVENT still produces one valid write", async () => {
    const { fetchFn, calls } = recordingFetch();
    const result = await importCalendar({
      writeFetch: fetchFn,
      container: CONTAINER,
      icsText: veventHostile,
    });
    expect(result.written).toBe(1);
    const body = String(calls[0]?.init.body);
    expect(body).toContain("schema:Event");
    expect(body).toContain("Recovered summary");
    expect(body).not.toContain("javascript:");
  });

  it("rejects a missing container", async () => {
    const { fetchFn } = recordingFetch();
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: testing the runtime guard.
      importCalendar({ writeFetch: fetchFn, container: "" as any, icsText: veventWithRrule }),
    ).rejects.toThrow(/container/);
  });

  it("requires either text or a davUrl", async () => {
    const { fetchFn } = recordingFetch();
    await expect(importCalendar({ writeFetch: fetchFn, container: CONTAINER })).rejects.toThrow(
      /icsText|davUrl/,
    );
  });

  describe("error handling", () => {
    it("fail-closed: stops on the first non-2xx and reports the partial result", async () => {
      let n = 0;
      const fetchFn = vi.fn(async () => {
        n++;
        return new Response(null, { status: n === 1 ? 201 : 500 });
      }) as unknown as typeof globalThis.fetch;
      const result = await importCalendar({
        writeFetch: fetchFn,
        container: CONTAINER,
        icsText: veventMulti,
      });
      expect(result.written).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.items[1]?.status).toBe(500);
      expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);
    });

    it("continueOnError: records failures and keeps going", async () => {
      let n = 0;
      const fetchFn = vi.fn(async () => {
        n++;
        return new Response(null, { status: n === 1 ? 500 : 201 });
      }) as unknown as typeof globalThis.fetch;
      const result = await importCalendar({
        writeFetch: fetchFn,
        container: CONTAINER,
        icsText: veventMulti,
        continueOnError: true,
      });
      expect(result.total).toBe(2);
      expect(result.written).toBe(1);
      expect(result.failed).toBe(1);
    });

    it("fail-closed: a thrown fetch error rethrows with the partial result attached", async () => {
      const fetchFn = vi.fn(async () => {
        throw new Error("network down");
      }) as unknown as typeof globalThis.fetch;
      await expect(
        importCalendar({ writeFetch: fetchFn, container: CONTAINER, icsText: veventWithRrule }),
      ).rejects.toMatchObject({ message: expect.stringContaining("write failed at item 0") });
    });
  });
});

describe("importAddressBook", () => {
  it("writes a vCard as a SolidOS-readable vcard:Individual resource", async () => {
    const { fetchFn, calls } = recordingFetch();
    const result = await importAddressBook({
      writeFetch: fetchFn,
      container: CONTAINER,
      vcfText: vcardBasic,
    });
    expect(result.written).toBe(1);
    const body = String(calls[0]?.init.body);
    // The task-model buildPerson writes the structured vcard form (never hand-built).
    expect(body).toContain("vcard:Individual");
    expect(body).toContain("Alice Example");
    // STRUCTURED email node: vcard:hasEmail [ … vcard:value <mailto:…> ]
    expect(body).toContain("vcard:hasEmail");
    expect(body).toContain("mailto:alice@example.com");
    // STRUCTURED phone node
    expect(body).toContain("vcard:hasTelephone");
    expect(body).toContain("tel:");
  });

  it("writes every vCard of a multi-card stream", async () => {
    const { fetchFn, calls } = recordingFetch();
    const result = await importAddressBook({
      writeFetch: fetchFn,
      container: CONTAINER,
      vcfText: vcardMulti,
    });
    expect(result.total).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it("OWNER-PRIVACY: never writes an .acl/.acr and never authors a broadening ACL", async () => {
    const { fetchFn, calls } = recordingFetch();
    await importAddressBook({ writeFetch: fetchFn, container: CONTAINER, vcfText: vcardMulti });
    for (const { url, init } of calls) {
      expect(url).not.toMatch(/\.acl$/);
      expect(url).not.toMatch(/\.acr$/);
      const body = String(init.body ?? "");
      expect(body).not.toContain("acl:agentClass");
      expect(body).not.toContain("foaf:Agent");
    }
  });

  it("HARDENING: a hostile vCard still writes a valid person with no leaked javascript:", async () => {
    const { fetchFn, calls } = recordingFetch();
    const result = await importAddressBook({
      writeFetch: fetchFn,
      container: CONTAINER,
      vcfText: vcardHostile,
    });
    expect(result.written).toBe(1);
    const body = String(calls[0]?.init.body);
    expect(body).toContain("vcard:Individual");
    expect(body).toContain("mailto:good@example.com");
    expect(body).not.toContain("javascript:");
  });

  it("HARDENING: a messy stream imports only the valid card", async () => {
    const { fetchFn, calls } = recordingFetch();
    const result = await importAddressBook({
      writeFetch: fetchFn,
      container: CONTAINER,
      vcfText: vcardMessy,
    });
    expect(result.total).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("requires either text or a davUrl", async () => {
    const { fetchFn } = recordingFetch();
    await expect(importAddressBook({ writeFetch: fetchFn, container: CONTAINER })).rejects.toThrow(
      /vcfText|davUrl/,
    );
  });
});

describe("default slugs", () => {
  it("event slug is deterministic and ends with .ttl", () => {
    const ev = veventToEvent(findComponents(parseComponents(veventWithRrule), "VEVENT")[0]!, {
      subject: "https://x/e.ttl#it",
    });
    expect(defaultEventSlug(ev, 0)).toBe(defaultEventSlug(ev, 0));
    expect(defaultEventSlug(ev, 0)).toMatch(/^event-[0-9a-f]{8}\.ttl$/);
  });
  it("contact slug is deterministic and ends with .ttl", () => {
    const c = vcardToContact(findComponents(parseComponents(vcardBasic), "VCARD")[0]!);
    expect(defaultContactSlug(c, 0)).toBe(defaultContactSlug(c, 0));
    expect(defaultContactSlug(c, 0)).toMatch(/^contact-[0-9a-f]{8}\.ttl$/);
  });
});
