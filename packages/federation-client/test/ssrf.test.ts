// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Adversarial tests for the SSRF guard. The registry URL is a user/config-supplied
// remote origin, so the guard is the security boundary: https-only, no userinfo,
// private/loopback/link-local/metadata targets blocked (as IP literals AND via DNS
// resolution, incl. DNS-rebinding multi-record sets), redirects re-validated (no
// auto-follow to a private host), body + time capped. All fetches are stubbed — the
// guard's classification runs BEFORE the stub is ever called, so a rejected target
// must never reach the underlying fetch.

import { describe, expect, it, vi } from "vitest";
import {
  createGuardedFetch,
  type DnsLookup,
  guardedFetch,
  isLoopbackAddress,
  isPublicAddress,
  SsrfError,
} from "../src/index.js";

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

  it("refuses an unclassifiable hostname when no DNS is available (fail closed)", async () => {
    // `dnsLookup: null` simulates a non-Node runtime with no resolver; a hostname
    // (not an IP literal) cannot be classified, so it is refused.
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null, allowUnresolvedHosts: false });
    await expect(guarded("https://unknown.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("permits an unclassifiable hostname under allowUnresolvedHosts (opt-in risk)", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null, allowUnresolvedHosts: true });
    await expect(guarded("https://unknown.example/doc")).resolves.toBeInstanceOf(Response);
    expect(calls).toHaveLength(1);
  });

  it("still classifies an IP literal even when no DNS is available", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null, allowUnresolvedHosts: true });
    // allowUnresolvedHosts must NOT bypass the literal-IP check.
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
