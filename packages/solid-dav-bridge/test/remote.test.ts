// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { assertSafeUrl, createGuardedFetch, SsrfError } from "@jeswr/guarded-fetch";
import { describe, expect, it, vi } from "vitest";
import { findComponents, parseComponents } from "../src/ical.js";
import { importCalendar } from "../src/ingest.js";
import { DavFetchError, fetchDav } from "../src/remote.js";
import { veventWithRrule } from "./fixtures.js";

/** A stubbed (already-SSRF-safe) fetch returning a body + recording the request. */
function textFetch(body: string, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status, headers: { "content-type": "text/calendar" } });
  }) as unknown as typeof globalThis.fetch;
  return { fetchFn, calls };
}

describe("fetchDav", () => {
  it("returns the raw DAV body from an endpoint", async () => {
    const { fetchFn } = textFetch(veventWithRrule);
    const text = await fetchDav("https://dav.example.com/cal/", { fetch: fetchFn });
    expect(findComponents(parseComponents(text), "VEVENT")).toHaveLength(1);
  });

  it("sends a calendar/vcard-preferring Accept header by default", async () => {
    const { fetchFn, calls } = textFetch(veventWithRrule);
    await fetchDav("https://dav.example.com/cal/", { fetch: fetchFn });
    expect((calls[0]?.init.headers as Record<string, string>).accept).toContain("text/calendar");
  });

  it("sets a Basic Authorization header from a basic credential", async () => {
    const { fetchFn, calls } = textFetch(veventWithRrule);
    await fetchDav("https://dav.example.com/cal/", {
      fetch: fetchFn,
      davAuth: { type: "basic", username: "alice", password: "s3cr3t" },
    });
    const auth = (calls[0]?.init.headers as Record<string, string>).authorization;
    // base64("alice:s3cr3t") === "YWxpY2U6czNjcjN0"
    expect(auth).toBe("Basic YWxpY2U6czNjcjN0");
  });

  it("sets a Bearer Authorization header from a bearer credential", async () => {
    const { fetchFn, calls } = textFetch(veventWithRrule);
    await fetchDav("https://dav.example.com/cal/", {
      fetch: fetchFn,
      davAuth: { type: "bearer", token: "tok-123" },
    });
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer tok-123");
  });

  it("CRED SAFETY: the credential never appears in the URL or in a DavFetchError", async () => {
    const fetchFn = vi.fn(
      async () => new Response(null, { status: 500 }),
    ) as unknown as typeof globalThis.fetch;
    const err = await fetchDav("https://dav.example.com/cal/", {
      fetch: fetchFn,
      davAuth: { type: "basic", username: "alice", password: "s3cr3t-PASSWORD" },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(DavFetchError);
    // the error message + url carry only the URL + status — never the password
    expect(String(err.message)).not.toContain("s3cr3t-PASSWORD");
    expect(String(err.message)).not.toContain("alice");
    expect(err.url).toBe("https://dav.example.com/cal/");
    expect(err.url).not.toContain("s3cr3t");
  });

  it("issues a REPORT with an XML body + content-type when method=REPORT", async () => {
    const { fetchFn, calls } = textFetch(veventWithRrule);
    await fetchDav("https://dav.example.com/cal/", {
      fetch: fetchFn,
      method: "REPORT",
      body: "<calendar-query/>",
    });
    expect(calls[0]?.init.method).toBe("REPORT");
    expect((calls[0]?.init.headers as Record<string, string>)["content-type"]).toContain("xml");
    expect(String(calls[0]?.init.body)).toContain("calendar-query");
  });

  it("throws DavFetchError on a non-2xx status", async () => {
    const fetchFn = vi.fn(
      async () => new Response(null, { status: 404 }),
    ) as unknown as typeof globalThis.fetch;
    await expect(fetchDav("https://dav.example.com/x", { fetch: fetchFn })).rejects.toBeInstanceOf(
      DavFetchError,
    );
  });

  it("enforces the parse-time byte cap (encoded utf-8 bytes, not code units)", async () => {
    const emoji = "😀".repeat(60); // 60 code units, 240 utf-8 bytes
    const body = `BEGIN:VEVENT\r\nSUMMARY:${emoji}\r\nEND:VEVENT`;
    expect(body.length).toBeLessThan(new TextEncoder().encode(body).length);
    const { fetchFn } = textFetch(body);
    await expect(
      fetchDav("https://dav.example.com/x", { fetch: fetchFn, maxBytes: 150 }),
    ).rejects.toMatchObject({ message: expect.stringContaining("exceeds") });
  });

  it("wraps a thrown network error as DavFetchError", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof globalThis.fetch;
    await expect(fetchDav("https://dav.example.com/x", { fetch: fetchFn })).rejects.toBeInstanceOf(
      DavFetchError,
    );
  });
});

describe("importCalendar via a davUrl goes through the SSRF guard", () => {
  it("routes a davUrl read through the injected guarded fetch and writes the results", async () => {
    const davFetch = vi.fn(
      async () => new Response(veventWithRrule, { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    const writeCalls: string[] = [];
    const writeFetch = vi.fn(async (url: string | URL | Request) => {
      writeCalls.push(String(url));
      return new Response(null, { status: 201 });
    }) as unknown as typeof globalThis.fetch;

    const result = await importCalendar({
      container: "https://alice.pod.example/imports/dav/",
      davUrl: "https://dav.example.com/cal/",
      davFetch,
      writeFetch,
    });
    expect(result.written).toBe(1);
    // the DAV read happened via the injected (SSRF-safe) fetch, not writeFetch
    expect((davFetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
    expect(writeCalls).toHaveLength(1);
  });
});

describe("SSRF guard wiring (the real @jeswr/guarded-fetch policy)", () => {
  // These prove the guard the default path routes through (nodeGuardedFetch)
  // actually refuses dangerous targets, so a user-typed DAV URL cannot reach
  // private/loopback/metadata hosts.
  it("refuses the cloud-metadata address", async () => {
    await expect(assertSafeUrl("https://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(
      SsrfError,
    );
  });
  it("refuses loopback", async () => {
    await expect(assertSafeUrl("https://127.0.0.1/")).rejects.toBeInstanceOf(SsrfError);
  });
  it("refuses a private RFC1918 literal", async () => {
    await expect(assertSafeUrl("https://10.0.0.5/")).rejects.toBeInstanceOf(SsrfError);
  });
  it("refuses a non-https scheme", async () => {
    await expect(assertSafeUrl("http://dav.example.com/")).rejects.toBeInstanceOf(SsrfError);
  });
  it("refuses userinfo in the URL (no credential smuggling via the URL)", async () => {
    await expect(assertSafeUrl("https://user:pass@dav.example.com/")).rejects.toBeInstanceOf(
      SsrfError,
    );
  });
});

describe("redirect handling (guarded-fetch re-validates + strips creds per hop)", () => {
  // The module docs previously claimed "redirects are not followed"; in fact
  // guarded-fetch DOES follow them but re-validates each hop and strips credential
  // headers cross-origin. These pin the security-relevant behaviour the DAV
  // credential path depends on: the Authorization header never reaches a different
  // origin, and a redirect to an internal address is refused.
  it("STRIPS the Authorization header on a cross-origin redirect (no off-origin cred leak)", async () => {
    let hop = 0;
    const seen: { url: string; authorization: string | null }[] = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      hop += 1;
      const h = new Headers(init?.headers ?? {});
      seen.push({ url: String(url), authorization: h.get("authorization") });
      if (hop === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://origin-b.example/evil" },
        });
      }
      return new Response("final", { status: 200, headers: { "content-type": "text/plain" } });
    }) as unknown as typeof globalThis.fetch;
    // deterministic public-IP resolver so host classification passes for the example hosts
    const dnsLookup = (async () => [{ address: "93.184.216.34", family: 4 }]) as never;
    const guarded = createGuardedFetch({ fetch: fetcher, dnsLookup });

    const res = await guarded("https://origin-a.example/cal", {
      headers: { authorization: "Basic SECRETCREDS" },
    });
    expect(res.status).toBe(200);
    // hop 1 (origin A) carried the credential; hop 2 (cross-origin B) did NOT
    expect(seen[0]?.authorization).toBe("Basic SECRETCREDS");
    expect(seen[1]?.url).toBe("https://origin-b.example/evil");
    expect(seen[1]?.authorization).toBeNull();
  });

  it("REFUSES a redirect to a cloud-metadata address (redirect-based SSRF closed)", async () => {
    const fetcher = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://169.254.169.254/latest/meta-data/" },
      })) as unknown as typeof globalThis.fetch;
    const dnsLookup = (async () => [{ address: "93.184.216.34", family: 4 }]) as never;
    const guarded = createGuardedFetch({ fetch: fetcher, dnsLookup });
    await expect(guarded("https://origin-a.example/cal")).rejects.toBeInstanceOf(SsrfError);
  });
});
