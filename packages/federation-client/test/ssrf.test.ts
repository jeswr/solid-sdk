// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Adversarial tests for the SSRF guard. The registry URL is a user/config-supplied
// remote origin, so the guard is the security boundary: https-only, no userinfo,
// private/loopback/link-local/metadata targets blocked (as IP literals AND via DNS
// resolution, incl. DNS-rebinding multi-record sets), redirects re-validated (no
// auto-follow to a private host), body + time capped. All fetches are stubbed — the
// guard's classification runs BEFORE the stub is ever called, so a rejected target
// must never reach the underlying fetch.

import { isIP } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGuardedFetch,
  type DnsLookup,
  guardedFetch,
  isLoopbackAddress,
  isPublicAddress,
  SsrfError,
} from "../src/index.js";
import { classifyIpLiteral } from "../src/ssrf.js";

const PUBLIC_DNS: DnsLookup = async () => [{ address: "93.184.216.34", family: 4 }];

/** A fetch stub that records calls and returns a 200 OK Turtle response. */
function okFetch(): { fetch: typeof globalThis.fetch; calls: string[] } {
  const calls: string[] = [];
  const fetch = (async (url: string | URL | Request) => {
    calls.push(typeof url === "string" ? url : url.toString());
    return new Response("ok", { status: 200, headers: { "content-type": "text/turtle" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("SSRF guard — scheme + userinfo", () => {
  it("rejects a non-https (http) URL by default", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    await expect(guarded("http://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]); // never reached the underlying fetch
  });

  it("rejects non-http(s) schemes (file:, data:, gopher:)", async () => {
    const { fetch } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    for (const url of ["file:///etc/passwd", "data:text/plain,hi", "gopher://x/"]) {
      await expect(guarded(url)).rejects.toBeInstanceOf(SsrfError);
    }
  });

  it("rejects a URL carrying userinfo (credential leak to host)", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    await expect(guarded("https://user:pass@registry.example/doc")).rejects.toBeInstanceOf(
      SsrfError,
    );
    expect(calls).toEqual([]);
  });

  it("rejects a malformed URL", async () => {
    const { fetch } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    await expect(guarded("not a url")).rejects.toBeInstanceOf(SsrfError);
  });
});

describe("SSRF guard — IP-literal targets (no DNS needed)", () => {
  const cases: Array<[string, string]> = [
    ["loopback v4", "https://127.0.0.1/doc"],
    ["loopback v4 (other octet)", "https://127.5.6.7/doc"],
    ["RFC 1918 10/8", "https://10.0.0.5/doc"],
    ["RFC 1918 172.16/12", "https://172.16.0.1/doc"],
    ["RFC 1918 192.168/16", "https://192.168.1.1/doc"],
    ["link-local / cloud metadata", "https://169.254.169.254/latest/meta-data/"],
    ["CGNAT 100.64/10", "https://100.64.0.1/doc"],
    ["0.0.0.0/8", "https://0.0.0.0/doc"],
    ["multicast", "https://224.0.0.1/doc"],
    ["IPv6 loopback", "https://[::1]/doc"],
    ["IPv6 ULA fc00::/7", "https://[fc00::1]/doc"],
    ["IPv6 link-local fe80::/10", "https://[fe80::1]/doc"],
    ["IPv4-mapped IPv6 (compressed) → 10.0.0.1", "https://[::ffff:10.0.0.1]/doc"],
  ];
  for (const [name, url] of cases) {
    it(`rejects ${name}: ${url}`, async () => {
      const { fetch, calls } = okFetch();
      const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
      await expect(guarded(url)).rejects.toBeInstanceOf(SsrfError);
      expect(calls).toEqual([]); // classification happened before any fetch
    });
  }

  it("allows a public IP literal", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    const res = await guarded("https://93.184.216.34/doc");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
  });
});

describe("SSRF guard — DNS resolution + rebinding", () => {
  it("rejects a hostname that resolves to a private address", async () => {
    const dns: DnsLookup = async () => [{ address: "127.0.0.1", family: 4 }];
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: dns });
    await expect(guarded("https://evil.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("rejects a multi-record set where ANY record is private (rebinding mitigation)", async () => {
    // One public + one loopback record — must fail the WHOLE request.
    const dns: DnsLookup = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: dns });
    await expect(guarded("https://rebind.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("rejects a host that resolves to no addresses", async () => {
    const dns: DnsLookup = async () => [];
    const { fetch } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: dns });
    await expect(guarded("https://void.example/doc")).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects when DNS resolution throws", async () => {
    const dns: DnsLookup = async () => {
      throw new Error("NXDOMAIN");
    };
    const { fetch } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: dns });
    await expect(guarded("https://nope.example/doc")).rejects.toBeInstanceOf(SsrfError);
  });

  it("an INJECTED lookup that throws is a genuine resolution FAILURE — never a DNS-less fallback (#92 round-3 Medium)", async () => {
    // The default-Node-lookup → DNS-less fallback is scoped to the DEFAULT lookup only
    // (usingDefaultNodeLookup). An injected lookup throwing — even with a message that
    // looks like an import failure — must STILL fail closed, not be reinterpreted as
    // "this isn't really Node, allow the public host".
    const dns: DnsLookup = async () => {
      throw new Error("node:dns/promises is not importable");
    };
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: dns });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("allows a host that resolves entirely to public addresses", async () => {
    const dns: DnsLookup = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ];
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: dns });
    await expect(guarded("https://good.example/doc")).resolves.toBeInstanceOf(Response);
    expect(calls).toHaveLength(1);
  });

  it("DNS-less branch in a NON-browser runtime FAILS CLOSED for a public-looking host", async () => {
    // `dnsLookup: null` forces the DNS-less branch. The vitest runtime has no DOM
    // `window`, so it is treated as a non-browser DNS-less runtime (edge/worker) — a
    // public-looking hostname must FAIL CLOSED (SSRF escalation risk), not be allowed.
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("still classifies an IP literal even when no DNS is available", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null });
    // The DNS-less branch's literal-IP block is absolute regardless of DNS.
    await expect(guarded("https://127.0.0.1/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });
});

describe("SSRF guard — redirects", () => {
  /** A fetch that 302-redirects the first hop to `location`, then 200s. */
  function redirectingFetch(location: string): {
    fetch: typeof globalThis.fetch;
    calls: string[];
  } {
    const calls: string[] = [];
    let hop = 0;
    const fetch = (async (url: string | URL | Request) => {
      calls.push(typeof url === "string" ? url : url.toString());
      hop += 1;
      if (hop === 1) {
        return new Response(null, { status: 302, headers: { location } });
      }
      return new Response("ok", { status: 200, headers: { "content-type": "text/turtle" } });
    }) as typeof globalThis.fetch;
    return { fetch, calls };
  }

  it("does NOT auto-follow: issues redirect: manual to the underlying fetch", async () => {
    const { fetch } = redirectingFetch("https://other.example/doc");
    const spy = vi.fn(fetch);
    const guarded = createGuardedFetch({
      fetch: spy as typeof globalThis.fetch,
      dnsLookup: PUBLIC_DNS,
    });
    await guarded("https://registry.example/doc");
    // Every call must carry redirect:"manual".
    for (const call of spy.mock.calls) {
      expect((call[1] as RequestInit).redirect).toBe("manual");
    }
  });

  it("re-validates a redirect target and REFUSES a redirect to a private host", async () => {
    const { fetch, calls } = redirectingFetch("https://169.254.169.254/latest/meta-data/");
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    // The first hop was fetched; the redirect target was refused before a second fetch.
    expect(calls).toEqual(["https://registry.example/doc"]);
  });

  it("refuses a redirect to a non-https scheme", async () => {
    const { fetch } = redirectingFetch("http://registry.example/doc");
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
  });

  it("follows an allowed redirect to another public host", async () => {
    const { fetch, calls } = redirectingFetch("https://other.example/doc");
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    const res = await guarded("https://registry.example/doc");
    expect(res.status).toBe(200);
    expect(calls).toEqual(["https://registry.example/doc", "https://other.example/doc"]);
  });

  it("detects a redirect loop", async () => {
    // Always 302 back to the same URL.
    const calls: string[] = [];
    const fetch = (async (url: string | URL | Request) => {
      calls.push(typeof url === "string" ? url : url.toString());
      return new Response(null, {
        status: 302,
        headers: { location: "https://registry.example/doc" },
      });
    }) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
  });

  it("refuses after exceeding the redirect cap", async () => {
    // Each hop redirects to a fresh public host so the loop detector does not trip first.
    let n = 0;
    const fetch = (async () => {
      n += 1;
      return new Response(null, { status: 302, headers: { location: `https://h${n}.example/x` } });
    }) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS, maxRedirects: 2 });
    await expect(guarded("https://start.example/x")).rejects.toBeInstanceOf(SsrfError);
  });

  it("strips credential headers on a CROSS-ORIGIN redirect (no Authorization leak)", async () => {
    // hop 1 (origin A) 302s to origin B; assert B's request carries no Authorization.
    const headersSeen: Array<Headers> = [];
    let hop = 0;
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      headersSeen.push(new Headers(init?.headers ?? {}));
      hop += 1;
      if (hop === 1) {
        return new Response(null, {
          status: 307,
          headers: { location: "https://other.example/doc" },
        });
      }
      return new Response("ok", { status: 200, headers: { "content-type": "text/turtle" } });
    }) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    await guarded("https://registry.example/doc", {
      headers: { authorization: "Bearer secret", cookie: "sid=abc", "x-custom": "keep" },
    });
    // Hop 1 (same origin as the original) keeps the credential header.
    expect(headersSeen[0]?.get("authorization")).toBe("Bearer secret");
    // Hop 2 (CROSS-origin) must have it stripped — but keep the non-sensitive header.
    expect(headersSeen[1]?.get("authorization")).toBeNull();
    expect(headersSeen[1]?.get("cookie")).toBeNull();
    expect(headersSeen[1]?.get("x-custom")).toBe("keep");
  });

  it("KEEPS credential headers on a SAME-ORIGIN redirect", async () => {
    const headersSeen: Array<Headers> = [];
    let hop = 0;
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      headersSeen.push(new Headers(init?.headers ?? {}));
      hop += 1;
      if (hop === 1) {
        // Same origin, different path, 307 (preserves method/headers).
        return new Response(null, {
          status: 307,
          headers: { location: "https://registry.example/other" },
        });
      }
      return new Response("ok", { status: 200, headers: { "content-type": "text/turtle" } });
    }) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    await guarded("https://registry.example/doc", {
      headers: { authorization: "Bearer secret" },
    });
    expect(headersSeen[1]?.get("authorization")).toBe("Bearer secret");
  });

  it("switches a POST to GET and drops the body on a 303 redirect (method rewrite)", async () => {
    const seen: Array<{ method?: string; hasBody: boolean; contentType: string | null }> = [];
    let hop = 0;
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const i = (init ?? {}) as RequestInit;
      seen.push({
        method: i.method,
        hasBody: i.body !== undefined && i.body !== null,
        contentType: new Headers(i.headers ?? {}).get("content-type"),
      });
      hop += 1;
      if (hop === 1) {
        return new Response(null, {
          status: 303,
          headers: { location: "https://registry.example/result" },
        });
      }
      return new Response("ok", { status: 200, headers: { "content-type": "text/turtle" } });
    }) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    await guarded("https://registry.example/submit", {
      method: "POST",
      body: "payload",
      headers: { "content-type": "text/plain" },
    });
    // Hop 1 was the POST.
    expect(seen[0]?.method).toBe("POST");
    // Hop 2 (after 303) must be a GET with NO body and NO content-type.
    expect(seen[1]?.method).toBe("GET");
    expect(seen[1]?.hasBody).toBe(false);
    expect(seen[1]?.contentType).toBeNull();
  });

  it("preserves method + body across a SAME-ORIGIN 307 redirect", async () => {
    const seen: Array<{ method?: string; hasBody: boolean }> = [];
    let hop = 0;
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const i = (init ?? {}) as RequestInit;
      seen.push({ method: i.method, hasBody: i.body !== undefined && i.body !== null });
      hop += 1;
      if (hop === 1) {
        return new Response(null, {
          status: 307,
          headers: { location: "https://registry.example/result" },
        });
      }
      return new Response("ok", { status: 200, headers: { "content-type": "text/turtle" } });
    }) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    await guarded("https://registry.example/submit", { method: "POST", body: "payload" });
    expect(seen[1]?.method).toBe("POST");
    expect(seen[1]?.hasBody).toBe(true);
  });

  it("DROPS body + Authorization on a CROSS-ORIGIN 307 (no body/credential leak)", async () => {
    const seen: Array<{ method?: string; hasBody: boolean; auth: string | null }> = [];
    let hop = 0;
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const i = (init ?? {}) as RequestInit;
      seen.push({
        method: i.method,
        hasBody: i.body !== undefined && i.body !== null,
        auth: new Headers(i.headers ?? {}).get("authorization"),
      });
      hop += 1;
      if (hop === 1) {
        // 307 to a DIFFERENT origin.
        return new Response(null, {
          status: 307,
          headers: { location: "https://other.example/result" },
        });
      }
      return new Response("ok", { status: 200, headers: { "content-type": "text/turtle" } });
    }) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    await guarded("https://registry.example/submit", {
      method: "POST",
      body: "payload",
      headers: { authorization: "Bearer secret", "content-type": "text/plain" },
    });
    // Hop 2 is cross-origin: body dropped, Authorization stripped — even though 307
    // normally preserves both. The method is left as POST but with NO body.
    expect(seen[1]?.hasBody).toBe(false);
    expect(seen[1]?.auth).toBeNull();
  });
});

describe("SSRF guard — final URL preservation across redirects", () => {
  it("the returned Response carries the FINAL (post-redirect) URL for base-IRI resolution", async () => {
    let hop = 0;
    const fetch = (async () => {
      hop += 1;
      if (hop === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://other.example/final" },
        });
      }
      return new Response("ok", { status: 200, headers: { "content-type": "text/turtle" } });
    }) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    const res = await guarded("https://registry.example/start");
    // The capped response must expose the FINAL URL, not the original request URL, so
    // a relative IRI in the redirected document resolves correctly.
    expect(res.url).toBe("https://other.example/final");
  });
});

describe("SSRF guard — null-body response statuses", () => {
  it("handles a 204 No Content without throwing", async () => {
    const fetch = (async () => new Response(null, { status: 204 })) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    const res = await guarded("https://registry.example/empty");
    expect(res.status).toBe(204);
    // A 204 has no body — reading it yields the empty string.
    expect(await res.text()).toBe("");
  });

  it("handles a 304 Not Modified without throwing", async () => {
    const fetch = (async () =>
      new Response(null, { status: 304, headers: { etag: '"abc"' } })) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    const res = await guarded("https://registry.example/cached");
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe('"abc"');
  });
});

describe("SSRF guard — requireDnsPinning posture (DNS-rebinding fail-closed)", () => {
  it("refuses a HOSTNAME through the default fetch when requireDnsPinning is set", async () => {
    // No fetch supplied → the guard uses the default, which cannot pin DNS.
    const guarded = createGuardedFetch({ dnsLookup: PUBLIC_DNS, requireDnsPinning: true });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
  });

  it("FAILS BEFORE the DNS query — does NOT call the injected lookup when pinning rejects (#92 round-6 Medium)", async () => {
    // The strict-pinning rejection must fire before any network resolution, so no DNS
    // query is leaked for a request the strict posture was always going to refuse.
    let lookupCalls = 0;
    const dns: DnsLookup = async () => {
      lookupCalls += 1;
      return [{ address: "93.184.216.34", family: 4 }];
    };
    const guarded = createGuardedFetch({ dnsLookup: dns, requireDnsPinning: true });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(lookupCalls).toBe(0); // resolver never queried
  });

  it("STILL refuses a hostname under requireDnsPinning with a plain (non-pinning) `fetch`", async () => {
    // A generic auth/custom `fetch` does NOT satisfy the strict posture — only a
    // distinct `pinningFetch` does. This is the round-2 High: a plain fetch must not
    // silently bypass the fail-closed path.
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS, requireDnsPinning: true });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]); // never reached the (non-pinning) fetch
  });

  it("ALLOWS a hostname under requireDnsPinning ONLY when a branded pinningFetch is supplied", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({
      pinningFetch: fetch,
      dnsLookup: PUBLIC_DNS,
      requireDnsPinning: true,
    });
    await expect(guarded("https://registry.example/doc")).resolves.toBeInstanceOf(Response);
    expect(calls).toHaveLength(1);
  });

  it("uses pinningFetch as the underlying fetch in preference to a generic fetch", async () => {
    const generic = okFetch();
    const pinning = okFetch();
    const guarded = createGuardedFetch({
      fetch: generic.fetch,
      pinningFetch: pinning.fetch,
      dnsLookup: PUBLIC_DNS,
    });
    await guarded("https://registry.example/doc");
    expect(pinning.calls).toHaveLength(1);
    expect(generic.calls).toEqual([]);
  });

  it("ALLOWS an IP literal under requireDnsPinning even with the default fetch (no rebinding window)", async () => {
    // An IP literal needs no resolution, so requireDnsPinning does not apply to it.
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS, requireDnsPinning: true });
    await expect(guarded("https://93.184.216.34/doc")).resolves.toBeInstanceOf(Response);
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// BROWSER branch (#92): the DNS-less guard for a browser / static-export consumer.
// `dnsLookup: null` forces the no-resolver branch — the SAME branch a browser bundle
// (with no node:dns) takes automatically. The guard must still block http/userinfo/
// localhost/*.local/private-IP-literals and re-validate redirects the same way, while
// ALLOWING a public https host with no resolver (the documented residual).
// ---------------------------------------------------------------------------
describe("SSRF guard — BROWSER branch (no node:dns, #92)", () => {
  // Positively identify a browser context the way `isBrowserContext()` checks: `window ===
  // globalThis` AND `document` present. In a real browser the global object IS the window;
  // a server DOM shim (jsdom on Node, or an SSR polyfill) sets a SEPARATE `window` object,
  // so this identity distinguishes a real browser from a DOM-shimmed server (roborev #92
  // round-3/round-5 Medium). We stub `window` TO `globalThis` to satisfy the identity.
  function stubBrowser() {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("document", {});
  }
  /** Construct a guard for the DNS-less browser branch. Kept as a helper for clarity. */
  function makeUnderNonNode(opts: Parameters<typeof createGuardedFetch>[0]) {
    return createGuardedFetch(opts);
  }
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Create a guard on the DNS-less branch positively identified as a browser. */
  function browserGuard() {
    stubBrowser();
    const { fetch, calls } = okFetch();
    return { guarded: makeUnderNonNode({ fetch, dnsLookup: null }), calls };
  }

  it("ALLOWS a public https host in a real browser (no resolver, no shim needed)", async () => {
    const { guarded, calls } = browserGuard();
    await expect(guarded("https://registry.example/doc")).resolves.toBeInstanceOf(Response);
    expect(calls).toHaveLength(1);
  });

  it("rejects http:// by default (https-only)", async () => {
    const { guarded, calls } = browserGuard();
    await expect(guarded("http://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("rejects a non-http(s) scheme (file:/data:)", async () => {
    const { guarded, calls } = browserGuard();
    for (const url of ["file:///etc/passwd", "data:text/plain,hi"]) {
      await expect(guarded(url)).rejects.toBeInstanceOf(SsrfError);
    }
    expect(calls).toEqual([]);
  });

  it("rejects embedded userinfo (no credential leak to host)", async () => {
    const { guarded, calls } = browserGuard();
    await expect(guarded("https://user:pass@registry.example/doc")).rejects.toBeInstanceOf(
      SsrfError,
    );
    expect(calls).toEqual([]);
  });

  it("rejects localhost and *.local / *.localhost names", async () => {
    const { guarded, calls } = browserGuard();
    for (const url of [
      "https://localhost/doc",
      "https://localhost:8443/doc",
      "https://api.localhost/doc",
      "https://printer.local/doc",
      "https://LOCALHOST/doc", // case-insensitive
      "https://host.local./doc", // trailing FQDN dot
    ]) {
      await expect(guarded(url)).rejects.toBeInstanceOf(SsrfError);
    }
    expect(calls).toEqual([]); // never reached the underlying fetch
  });

  it("rejects private / loopback / link-local / metadata IP LITERALS in the host", async () => {
    const { guarded, calls } = browserGuard();
    for (const url of [
      "https://127.0.0.1/doc",
      "https://10.0.0.5/doc",
      "https://172.16.0.1/doc",
      "https://192.168.1.1/doc",
      "https://169.254.169.254/latest/meta-data/", // cloud metadata
      "https://100.64.0.1/doc", // CGNAT
      "https://0.0.0.0/doc",
      "https://[::1]/doc",
      "https://[fc00::1]/doc",
      "https://[fe80::1]/doc",
      "https://[::ffff:10.0.0.1]/doc", // IPv4-mapped private
    ]) {
      await expect(guarded(url)).rejects.toBeInstanceOf(SsrfError);
    }
    expect(calls).toEqual([]);
  });

  it("ALLOWS a public IP literal", async () => {
    const { guarded, calls } = browserGuard();
    await expect(guarded("https://93.184.216.34/doc")).resolves.toBeInstanceOf(Response);
    expect(calls).toHaveLength(1);
  });

  it("re-validates each redirect hop the SAME way — refuses a redirect to a private literal", async () => {
    stubBrowser();
    let hop = 0;
    const calls: string[] = [];
    const fetch = (async (url: string | URL | Request) => {
      calls.push(typeof url === "string" ? url : url.toString());
      hop += 1;
      if (hop === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/latest/meta-data/" },
        });
      }
      return new Response("ok", { status: 200, headers: { "content-type": "text/turtle" } });
    }) as typeof globalThis.fetch;
    const guarded = makeUnderNonNode({ fetch, dnsLookup: null });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    // The redirect to a private literal was refused before a second fetch.
    expect(calls).toEqual(["https://registry.example/doc"]);
  });

  it("refuses a redirect to localhost on the browser branch", async () => {
    stubBrowser();
    let hop = 0;
    const fetch = (async () => {
      hop += 1;
      if (hop === 1) {
        return new Response(null, { status: 302, headers: { location: "https://localhost/x" } });
      }
      return new Response("ok", { status: 200, headers: { "content-type": "text/turtle" } });
    }) as typeof globalThis.fetch;
    const guarded = makeUnderNonNode({ fetch, dnsLookup: null });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
  });

  it("follows an allowed redirect to another public host on the browser branch", async () => {
    stubBrowser();
    let hop = 0;
    const calls: string[] = [];
    const fetch = (async (url: string | URL | Request) => {
      calls.push(typeof url === "string" ? url : url.toString());
      hop += 1;
      if (hop === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://other.example/doc" },
        });
      }
      return new Response("ok", { status: 200, headers: { "content-type": "text/turtle" } });
    }) as typeof globalThis.fetch;
    const guarded = makeUnderNonNode({ fetch, dnsLookup: null });
    const res = await guarded("https://registry.example/doc");
    expect(res.status).toBe(200);
    expect(calls).toEqual(["https://registry.example/doc", "https://other.example/doc"]);
  });

  it("still caps the body on the browser branch", async () => {
    stubBrowser();
    const big = "a".repeat(2048);
    const fetch = (async () =>
      new Response(big, {
        status: 200,
        headers: { "content-type": "text/turtle" },
      })) as typeof globalThis.fetch;
    const guarded = makeUnderNonNode({ fetch, dnsLookup: null, maxBytes: 1024 });
    await expect(guarded("https://big.example/doc")).rejects.toBeInstanceOf(SsrfError);
  });

  it("permits an http://localhost dev registry under allowLoopback (loopback name)", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null, allowLoopback: true });
    const res = await guarded("http://localhost:3000/doc");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("REFUSES http: to a PUBLIC-looking host even under allowLoopback (#92 round-2 Medium)", async () => {
    // allowLoopback re-permits the http: scheme, but the DNS-less guard must still bind
    // http: to loopback NAMES only — a public-looking host over http: must be refused.
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null, allowLoopback: true });
    await expect(guarded("http://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("REFUSES .local / *.local mDNS names even under allowLoopback (#92 round-3 Medium)", async () => {
    // `.local` is the mDNS LAN namespace — a LINK-LOCAL/private target, NOT loopback. It
    // must be refused outright and NOT re-permitted by allowLoopback (which is a localhost
    // dev hatch), in BOTH http: and https: form, and even in a positively-identified
    // browser.
    stubBrowser();
    for (const flag of [{ allowLoopback: true }, { allowLoopback: false }]) {
      for (const url of [
        "https://printer.local/doc",
        "https://host.local./doc", // trailing FQDN dot
        "http://printer.local/doc",
        "https://local/doc",
      ]) {
        const { fetch, calls } = okFetch();
        const guarded = makeUnderNonNode({ fetch, dnsLookup: null, ...flag });
        await expect(guarded(url)).rejects.toBeInstanceOf(SsrfError);
        expect(calls).toEqual([]);
      }
    }
  });

  it("STILL ALLOWS *.localhost loopback names under allowLoopback (distinct from .local)", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null, allowLoopback: true });
    const res = await guarded("https://api.localhost/doc");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  describe("requireDnsPinning on the browser branch (cannot pin without a resolver)", () => {
    it("fails closed for a hostname when requireDnsPinning is set (no resolver to pin)", async () => {
      const { fetch, calls } = okFetch();
      const guarded = createGuardedFetch({ fetch, dnsLookup: null, requireDnsPinning: true });
      await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
      expect(calls).toEqual([]);
    });

    it("ALLOWS the hostname when the caller opts into the residual via allowUnresolvedHosts", async () => {
      const { fetch, calls } = okFetch();
      const guarded = createGuardedFetch({
        fetch,
        dnsLookup: null,
        requireDnsPinning: true,
        allowUnresolvedHosts: true,
      });
      await expect(guarded("https://registry.example/doc")).resolves.toBeInstanceOf(Response);
      expect(calls).toHaveLength(1);
    });

    it("STILL refuses a private literal even with requireDnsPinning + allowUnresolvedHosts", async () => {
      const { fetch, calls } = okFetch();
      const guarded = createGuardedFetch({
        fetch,
        dnsLookup: null,
        requireDnsPinning: true,
        allowUnresolvedHosts: true,
      });
      await expect(guarded("https://10.0.0.1/doc")).rejects.toBeInstanceOf(SsrfError);
      expect(calls).toEqual([]);
    });

    it("FAILS CLOSED for a localhost target under requireDnsPinning + allowLoopback (#92 round-3 Medium)", async () => {
      // The strict-pinning gate runs BEFORE the allowLoopback loopback-name allow path:
      // requireDnsPinning cannot be honoured without a resolver, so even a `localhost`
      // dev target must fail closed (it would have under the pre-#92 strict posture).
      const { fetch, calls } = okFetch();
      const guarded = createGuardedFetch({
        fetch,
        dnsLookup: null,
        allowLoopback: true,
        requireDnsPinning: true,
      });
      await expect(guarded("http://localhost:3000/doc")).rejects.toBeInstanceOf(SsrfError);
      expect(calls).toEqual([]);
    });

    it("ALLOWS the localhost target under requireDnsPinning + allowLoopback ONLY with allowUnresolvedHosts", async () => {
      const { fetch, calls } = okFetch();
      const guarded = createGuardedFetch({
        fetch,
        dnsLookup: null,
        allowLoopback: true,
        requireDnsPinning: true,
        allowUnresolvedHosts: true,
      });
      const res = await guarded("http://localhost:3000/doc");
      expect(res.status).toBe(200);
      expect(calls).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// EDGE / WORKER runtime (#92 round-2 High): "no node:dns" is ALSO true in a non-browser
// server runtime (edge / Cloudflare Workers / Deno without node compat). There, an
// unresolved public-looking hostname reaching private infra is a real SSRF escalation —
// NOT the benign browser residual. So the DNS-less branch must FAIL CLOSED for a public
// host there by default (no DOM window stubbed = this is the runtime under test), and
// only allow it when the caller explicitly opts in via allowUnresolvedHosts.
// ---------------------------------------------------------------------------
describe("SSRF guard — DNS-less NON-browser runtime fails closed (#92 round-2 High)", () => {
  it("FAILS CLOSED for a public-looking host (no DOM window → treated as edge/worker)", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]); // never reached the underlying fetch
  });

  it("ALLOWS a public host only when the caller opts in via allowUnresolvedHosts", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null, allowUnresolvedHosts: true });
    await expect(guarded("https://registry.example/doc")).resolves.toBeInstanceOf(Response);
    expect(calls).toHaveLength(1);
  });

  it("STILL refuses a private literal even with allowUnresolvedHosts (literal block is absolute)", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null, allowUnresolvedHosts: true });
    await expect(guarded("https://10.0.0.1/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("STILL refuses localhost even with allowUnresolvedHosts", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null, allowUnresolvedHosts: true });
    await expect(guarded("https://localhost/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("only an explicit DOM window flips it to allow-by-default (not a worker self-global)", async () => {
    // A WebWorker exposes `self` but NO `window`/`document` — it must NOT be treated as a
    // browser (fail closed). Stub a `self` without a window to prove detection is by
    // window+document, not by the mere absence of `process`.
    vi.stubGlobal("self", {});
    try {
      const { fetch, calls } = okFetch();
      const guarded = createGuardedFetch({ fetch, dnsLookup: null });
      await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
      expect(calls).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a DOM-shimmed server (jsdom: window !== globalThis) + dnsLookup:null STILL fails closed (#92 round-3/5 Medium)", async () => {
    // A jsdom/SSR DOM shim sets a SEPARATE `window` object, so `window !== globalThis` —
    // isBrowserContext() requires that identity, so this is NOT a browser and the DNS-less
    // public host fails closed (vs being mistaken for a browser and failing open).
    vi.stubGlobal("window", {}); // separate object → window !== globalThis
    vi.stubGlobal("document", {});
    try {
      const { fetch, calls } = okFetch();
      const guarded = createGuardedFetch({ fetch, dnsLookup: null });
      await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
      expect(calls).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------------
// `classifyIpLiteral` REPLACES `node:net#isIP` (the #92 browser-safe mechanism). It is
// security-critical: a divergence would weaken/over-tighten the SSRF classification.
// Fuzz it against the real `node:net#isIP` over a large corpus so the two stay in
// lock-step (the test file is Node-only, so it can import the real isIP for the oracle).
// ---------------------------------------------------------------------------
describe("classifyIpLiteral — matches node:net#isIP (browser-safe replacement)", () => {
  const fixedCases = [
    "93.184.216.34",
    "10.0.0.1",
    "127.0.0.1",
    "0.0.0.0",
    "255.255.255.255",
    "256.1.1.1",
    "1.2.3",
    "1.2.3.4.5",
    "01.02.03.04",
    "1.2.3.04",
    "1.2.3.4 ",
    " 1.2.3.4",
    "1.2.3.4.",
    ".1.2.3.4",
    "::1",
    "::",
    "fc00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
    "::ffff:127.0.0.1",
    "2606:2800:220:1:248:1893:25c8:1946",
    "2002:c0a8:0101::",
    "64:ff9b::0a00:0001",
    "0:0:0:0:0:ffff:0a00:0001",
    "::ffff:7f00:0001",
    "1::2::3",
    "1:2:3:4:5:6:7:8",
    "1:2:3:4:5:6:7:8:9",
    "1:2:3:4:5:6:7",
    "12345::1",
    "g::1",
    "::ffff:256.1.1.1",
    "::1.2.3.4",
    "1.2.3.4::",
    "[::1]",
    "localhost",
    "0x7f.0.0.1",
    "2130706433",
    "not-an-ip",
    "",
    "abcd:ef01:2345:6789:abcd:ef01:2345:6789",
    "ABCD::EF",
    "1:2:3:4:5:6:1.2.3.4",
    "::1.2.3.4.5",
    "fe80::1%eth0",
    "fe80::1%25eth0",
    "::1%lo",
    "fe80::1%",
    "%eth0",
    "::ffff:10.0.0.1%x",
    "fe80%::1",
    "10.0.0.1%eth0",
    "::%",
    "fe80::1%eth0%more",
  ];

  it("matches isIP on a fixed adversarial corpus", () => {
    for (const c of fixedCases) {
      expect([c, classifyIpLiteral(c)]).toEqual([c, isIP(c)]);
    }
  });

  it("matches isIP on randomly fuzzed IPv4 / IPv6 / junk strings", () => {
    const rnd = (n: number) => Math.floor(Math.random() * n);
    const samples: string[] = [];
    // Random dotted-decimal-ish strings (valid and invalid octets/lengths).
    for (let i = 0; i < 400; i += 1) {
      const parts = Array.from({ length: 1 + rnd(5) }, () => String(rnd(400)));
      samples.push(parts.join("."));
      // occasionally inject leading zeros
      samples.push(parts.map((p) => (rnd(2) ? p : `0${p}`)).join("."));
    }
    // Random colon-hex-ish strings (valid and invalid hextets / compressions).
    const hex = "0123456789abcdefABCDEF";
    for (let i = 0; i < 400; i += 1) {
      const groups = Array.from({ length: 1 + rnd(9) }, () =>
        Array.from({ length: 1 + rnd(5) }, () => hex[rnd(hex.length)]).join(""),
      );
      let s = groups.join(":");
      if (rnd(2)) {
        // inject a "::" at a random group boundary
        const idx = rnd(groups.length);
        s = `${groups.slice(0, idx).join(":")}::${groups.slice(idx).join(":")}`;
      }
      if (rnd(3) === 0) {
        s = `${s}:${rnd(300)}.${rnd(300)}.${rnd(300)}.${rnd(300)}`; // trailing v4-ish
      }
      samples.push(s);
      if (rnd(4) === 0) {
        // occasionally append a zone id (sometimes empty) to exercise the %-handling
        samples.push(`${s}%${rnd(2) ? `z${rnd(50)}` : ""}`);
      }
    }
    for (const s of samples) {
      expect([s, classifyIpLiteral(s)]).toEqual([s, isIP(s)]);
    }
  });
});

describe("SSRF guard — Request object input", () => {
  it("carries a Request's method + headers (not just its url) into the guarded fetch", async () => {
    let seenMethod: string | undefined;
    let seenHeader: string | null = null;
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      seenMethod = (init as RequestInit).method;
      seenHeader = new Headers(init?.headers ?? {}).get("x-trace");
      return new Response("ok", { status: 200, headers: { "content-type": "text/turtle" } });
    }) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    const req = new Request("https://registry.example/doc", {
      method: "POST",
      headers: { "x-trace": "abc" },
    });
    await guarded(req);
    // The Request's fields were folded into the init, not dropped.
    expect(seenMethod).toBe("POST");
    expect(seenHeader).toBe("abc");
  });

  it("still SSRF-guards the url taken from a Request object", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    const req = new Request("https://127.0.0.1/doc");
    await expect(guarded(req)).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });
});

describe("SSRF guard — body cap + timeout", () => {
  it("rejects an over-cap declared Content-Length up front", async () => {
    const fetch = (async () =>
      new Response("x", {
        status: 200,
        headers: { "content-type": "text/turtle", "content-length": "999999" },
      })) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS, maxBytes: 1024 });
    await expect(guarded("https://big.example/doc")).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects an over-cap streamed body", async () => {
    // 2 KiB body, 1 KiB cap, no Content-Length so the stream path enforces it.
    const big = "a".repeat(2048);
    const fetch = (async () =>
      new Response(big, {
        status: 200,
        headers: { "content-type": "text/turtle" },
      })) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS, maxBytes: 1024 });
    await expect(guarded("https://big.example/doc")).rejects.toBeInstanceOf(SsrfError);
  });

  it("returns a capped Response whose body is the validated bytes", async () => {
    const fetch = (async () =>
      new Response("hello world", {
        status: 200,
        headers: { "content-type": "text/turtle" },
      })) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS, maxBytes: 1024 });
    const res = await guarded("https://ok.example/doc");
    expect(await res.text()).toBe("hello world");
  });

  it("aborts when the timeout elapses", async () => {
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS, timeoutMs: 20 });
    await expect(guarded("https://slow.example/doc")).rejects.toBeInstanceOf(SsrfError);
  });
});

describe("SSRF guard — allowLoopback dev path", () => {
  it("permits http to a loopback address when allowLoopback is set", async () => {
    const dns: DnsLookup = async () => [{ address: "127.0.0.1", family: 4 }];
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: dns, allowLoopback: true });
    const res = await guarded("http://localhost:3000/doc");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("still refuses http to a PUBLIC host even under allowLoopback", async () => {
    const { fetch } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS, allowLoopback: true });
    await expect(guarded("http://public.example/doc")).rejects.toBeInstanceOf(SsrfError);
  });

  it("still refuses http to a non-loopback PRIVATE host even under allowLoopback", async () => {
    const dns: DnsLookup = async () => [{ address: "10.0.0.5", family: 4 }];
    const { fetch } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: dns, allowLoopback: true });
    await expect(guarded("http://internal.example/doc")).rejects.toBeInstanceOf(SsrfError);
  });
});

describe("SSRF guard — one-shot guardedFetch", () => {
  it("guardedFetch applies the same policy", async () => {
    await expect(
      guardedFetch("https://127.0.0.1/doc", { dnsLookup: PUBLIC_DNS }),
    ).rejects.toBeInstanceOf(SsrfError);
  });
});

describe("address classifiers (exported)", () => {
  it("isPublicAddress matches the suite classifier for representative ranges", () => {
    expect(isPublicAddress("93.184.216.34", false)).toBe(true);
    expect(isPublicAddress("10.0.0.1", false)).toBe(false);
    expect(isPublicAddress("169.254.169.254", false)).toBe(false);
    expect(isPublicAddress("127.0.0.1", false)).toBe(false);
    expect(isPublicAddress("127.0.0.1", true)).toBe(true); // loopback re-permitted
    expect(isPublicAddress("::ffff:10.0.0.1", false)).toBe(false); // mapped private
    expect(isPublicAddress("fc00::1", false)).toBe(false);
    expect(isPublicAddress("not-an-ip", false)).toBe(false);
  });

  it("isLoopbackAddress identifies loopback v4/v6", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("93.184.216.34")).toBe(false);
  });
});
