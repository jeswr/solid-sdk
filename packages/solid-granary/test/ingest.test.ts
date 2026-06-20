// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it, vi } from "vitest";
import { defaultSlug, ingestGranary } from "../src/ingest.js";
import { granaryObjectToCanonical } from "../src/map.js";
import { hostileNote, mastodonNote, messyFeed, rssFeed } from "./fixtures.js";

/** A stubbed authed fetch that records every request and returns a 201. */
function recordingFetch(status = 201) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetchFn, calls };
}

const CONTAINER = "https://alice.pod.example/imports/granary/";

describe("ingestGranary", () => {
  it("writes a single AS2 object as one Turtle resource under the container", async () => {
    const { fetchFn, calls } = recordingFetch();
    const result = await ingestGranary(mastodonNote, {
      writeFetch: fetchFn,
      container: CONTAINER,
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
    expect(body).toContain("a as:Note");
    expect(body).toContain("Just shipped");
    // honest imported provenance is present in the written RDF
    expect(body).toContain("prov:wasDerivedFrom");
  });

  it("OWNER-PRIVACY: never writes an .acl/.acr and never targets a share resource", async () => {
    const { fetchFn, calls } = recordingFetch();
    await ingestGranary(rssFeed, { writeFetch: fetchFn, container: CONTAINER });
    for (const { url, init } of calls) {
      expect(init.method).toBe("PUT");
      expect(url).not.toMatch(/\.acl$/);
      expect(url).not.toMatch(/\.acr$/);
      // no body asserts a broad agentClass (public/authenticated) — we never author ACLs
      const body = String(init.body ?? "");
      expect(body).not.toContain("acl:agentClass");
      expect(body).not.toContain("foaf:Agent");
    }
  });

  it("writes every item of a Collection", async () => {
    const { fetchFn, calls } = recordingFetch();
    const result = await ingestGranary(rssFeed, { writeFetch: fetchFn, container: CONTAINER });
    expect(result.total).toBe(2);
    expect(result.written).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it("appends a trailing slash to a container missing one", async () => {
    const { fetchFn, calls } = recordingFetch();
    await ingestGranary(mastodonNote, {
      writeFetch: fetchFn,
      container: "https://alice.pod.example/imports/granary",
    });
    expect(calls[0]?.url.startsWith("https://alice.pod.example/imports/granary/")).toBe(true);
  });

  it("default slug is STABLE across runs (idempotent re-sync of the same source)", async () => {
    const a = recordingFetch();
    const b = recordingFetch();
    await ingestGranary(mastodonNote, { writeFetch: a.fetchFn, container: CONTAINER });
    await ingestGranary(mastodonNote, { writeFetch: b.fetchFn, container: CONTAINER });
    expect(a.calls[0]?.url).toBe(b.calls[0]?.url);
  });

  it("honours a custom slug function", async () => {
    const { fetchFn, calls } = recordingFetch();
    await ingestGranary(mastodonNote, {
      writeFetch: fetchFn,
      container: CONTAINER,
      slug: (_m, i) => `post-${i}.ttl`,
    });
    expect(calls[0]?.url).toBe(`${CONTAINER}post-0.ttl`);
  });

  it("sanitises a slug so it cannot escape the container (encoded + raw separators)", async () => {
    for (const evil of ["..%2f..%2fevil.ttl", "../../evil.ttl", "/abs/evil.ttl", "a/b/c.ttl"]) {
      const { fetchFn, calls } = recordingFetch();
      await ingestGranary(mastodonNote, {
        writeFetch: fetchFn,
        container: CONTAINER,
        slug: () => evil,
      });
      const url = calls[0]?.url ?? "";
      // The resolved write target MUST stay strictly under the container.
      expect(url.startsWith(CONTAINER)).toBe(true);
      // No path separators survive sanitisation (they collapse to '-'), so the
      // slug is a single flat resource name — it cannot traverse out.
      const tail = url.slice(CONTAINER.length);
      expect(tail).not.toContain("/");
    }
  });

  it("writes the LongChat shape when format=longchat", async () => {
    const { fetchFn, calls } = recordingFetch();
    await ingestGranary(mastodonNote, {
      writeFetch: fetchFn,
      container: CONTAINER,
      format: "longchat",
    });
    const body = String(calls[0]?.init.body);
    expect(body).toContain("sioc:content");
  });

  it("adds If-None-Match: * when conditional=if-none-match", async () => {
    const { fetchFn, calls } = recordingFetch();
    await ingestGranary(mastodonNote, {
      writeFetch: fetchFn,
      container: CONTAINER,
      conditional: "if-none-match",
    });
    expect((calls[0]?.init.headers as Record<string, string>)["if-none-match"]).toBe("*");
  });

  it("respects maxItems", async () => {
    const { fetchFn, calls } = recordingFetch();
    const result = await ingestGranary(rssFeed, {
      writeFetch: fetchFn,
      container: CONTAINER,
      maxItems: 1,
    });
    expect(result.total).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("HARDENING: a hostile object still produces one valid write (drops bad fields)", async () => {
    const { fetchFn, calls } = recordingFetch();
    const result = await ingestGranary(hostileNote, { writeFetch: fetchFn, container: CONTAINER });
    expect(result.written).toBe(1);
    const body = String(calls[0]?.init.body);
    expect(body).toContain("a as:Note");
    expect(body).toContain("recovered body from contentMap");
    // none of the hostile non-http(s) IRIs leaked into the graph
    expect(body).not.toContain("javascript:");
    expect(body).not.toContain("urn:");
    expect(body).not.toContain("mailto:");
  });

  it("HARDENING: a feed of junk imports only the valid item", async () => {
    const { fetchFn, calls } = recordingFetch();
    const result = await ingestGranary(messyFeed, { writeFetch: fetchFn, container: CONTAINER });
    expect(result.total).toBe(1);
    expect(calls).toHaveLength(1);
  });

  describe("error handling", () => {
    it("fail-closed: stops on the first non-2xx and reports the partial result", async () => {
      let n = 0;
      const fetchFn = vi.fn(async () => {
        n++;
        return new Response(null, { status: n === 1 ? 201 : 500 });
      }) as unknown as typeof globalThis.fetch;
      const result = await ingestGranary(rssFeed, { writeFetch: fetchFn, container: CONTAINER });
      expect(result.written).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.items[1]?.status).toBe(500);
      // stopped — only two attempts despite a 2-item feed where item 2 failed
      expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);
    });

    it("continueOnError: records failures and keeps going", async () => {
      let n = 0;
      const fetchFn = vi.fn(async () => {
        n++;
        return new Response(null, { status: n === 1 ? 500 : 201 });
      }) as unknown as typeof globalThis.fetch;
      const result = await ingestGranary(rssFeed, {
        writeFetch: fetchFn,
        container: CONTAINER,
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
        ingestGranary(mastodonNote, { writeFetch: fetchFn, container: CONTAINER }),
      ).rejects.toMatchObject({
        message: expect.stringContaining("write failed at item 0"),
      });
    });

    it("rejects a missing container", async () => {
      const { fetchFn } = recordingFetch();
      await expect(
        // biome-ignore lint/suspicious/noExplicitAny: testing the runtime guard.
        ingestGranary(mastodonNote, { writeFetch: fetchFn, container: "" as any }),
      ).rejects.toThrow(/container/);
    });
  });
});

describe("defaultSlug", () => {
  it("is deterministic and ends with .ttl", () => {
    const msg = granaryObjectToCanonical(mastodonNote);
    expect(defaultSlug(msg, 0)).toBe(defaultSlug(msg, 0));
    expect(defaultSlug(msg, 0)).toMatch(/^granary-[0-9a-f]{8}\.ttl$/);
  });
  it("differs for different source permalinks", () => {
    const a = granaryObjectToCanonical(mastodonNote);
    const b = granaryObjectToCanonical({
      type: "Note",
      content: "x",
      url: "https://other.example/p",
    });
    expect(defaultSlug(a, 0)).not.toBe(defaultSlug(b, 0));
  });
});
