// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * CHARACTERIZATION TESTS — the SSRF / DNS-rebinding POLICY CORE (the default `.` entry). This
 * file is the AUDIT ARTIFACT for the guard: it ports every security test from all four
 * consolidated copies (federation-client `ssrf.test.ts` + `ssrf-dns-fallback.test.ts`,
 * solid-community-feeds `safeFetch.test.ts`, solid-agent-notify `security/guardedFetch.test.ts`,
 * prod-solid-server `@pss/guarded-fetch` `ssrf.test.ts`) PLUS the union of attack vectors:
 * private/loopback/link-local/IPv6-ULA/IPv4-mapped/decimal-and-octal-IP/0.0.0.0/metadata,
 * redirect-to-private, DNS-rebind-on-second-resolution, userinfo-smuggling, non-https,
 * oversize-body, timeout, port gate, cloud-internal hostname denylist, content-type allowlist,
 * browser branch, edge/worker fail-closed, and the node:dns import-failure fallback.
 *
 * All fetches are STUBBED — the guard's classification runs BEFORE the stub is ever called, so a
 * rejected target must never reach the underlying fetch (asserted via `calls`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertSafeUrl,
  createGuardedFetch,
  DEFAULT_HOSTNAME_DENYLIST,
  type DnsLookup,
  GuardError,
  guardedFetch,
  isDeniedHostname,
  normalizeHostForClassification,
  SsrfError,
} from "../src/index.js";

const PUBLIC_DNS: DnsLookup = async () => [{ address: "93.184.216.34", family: 4 }];

/**
 * Assert a target is REFUSED by the guard — i.e. the promise rejects with EITHER an
 * {@link SsrfError} (the security boundary) or a {@link GuardError} (the policy boundary, e.g.
 * a disallowed port). Both are guard refusals that never reach the underlying fetch; some
 * vectors (e.g. `localhost:8443`) can be refused on more than one ground depending on the
 * order the gates run, so the security-relevant assertion is "refused", not "by which error".
 */
async function expectRefused(p: Promise<unknown>): Promise<void> {
  await expect(p).rejects.toSatisfy(
    (e: unknown) => e instanceof SsrfError || e instanceof GuardError,
  );
}

/** A fetch stub that records calls and returns a 200 OK Turtle response. */
function okFetch(): { fetch: typeof globalThis.fetch; calls: string[] } {
  const calls: string[] = [];
  const fetch = (async (url: string | URL | Request) => {
    calls.push(typeof url === "string" ? url : url.toString());
    return new Response("ok", { status: 200, headers: { "content-type": "text/turtle" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("guard — scheme + userinfo", () => {
  it("rejects a non-https (http) URL by default", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    await expect(guarded("http://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("rejects non-http(s) schemes (file:, data:, gopher:, ftp:)", async () => {
    const { fetch } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    for (const url of ["file:///etc/passwd", "data:text/plain,hi", "gopher://x/", "ftp://x/"]) {
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

describe("guard — port gate (production)", () => {
  it("rejects a non-default https port in production (GuardError)", async () => {
    const guarded = createGuardedFetch({ dnsLookup: PUBLIC_DNS });
    await expect(guarded("https://8.8.8.8:8080/doc")).rejects.toBeInstanceOf(GuardError);
    await expect(guarded("https://registry.example:8443/doc")).rejects.toBeInstanceOf(GuardError);
  });
  it("accepts the default https port (explicit :443 and implicit)", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    await guarded("https://registry.example:443/doc");
    await guarded("https://registry.example/doc");
    expect(calls).toHaveLength(2);
  });
  it("allows arbitrary ports when enforcePortGate is disabled", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS, enforcePortGate: false });
    await guarded("https://registry.example:8443/doc");
    expect(calls).toHaveLength(1);
  });
});

describe("guard — IP-literal targets (no DNS needed)", () => {
  const cases: Array<[string, string]> = [
    ["loopback v4", "https://127.0.0.1/doc"],
    ["loopback v4 (other octet)", "https://127.5.6.7/doc"],
    ["RFC 1918 10/8", "https://10.0.0.5/doc"],
    ["RFC 1918 172.16/12", "https://172.16.0.1/doc"],
    ["RFC 1918 172.31/12 upper", "https://172.31.255.1/doc"],
    ["RFC 1918 192.168/16", "https://192.168.1.1/doc"],
    ["link-local / cloud metadata", "https://169.254.169.254/latest/meta-data/"],
    ["CGNAT 100.64/10", "https://100.64.0.1/doc"],
    ["0.0.0.0/8", "https://0.0.0.0/doc"],
    ["multicast", "https://224.0.0.1/doc"],
    ["IPv6 loopback", "https://[::1]/doc"],
    ["IPv6 ULA fc00::/7", "https://[fc00::1]/doc"],
    ["IPv6 ULA fd12", "https://[fd12::1]/doc"],
    ["IPv6 link-local fe80::/10", "https://[fe80::1]/doc"],
    ["IPv6 multicast", "https://[ff02::1]/doc"],
    ["IPv4-mapped IPv6 loopback", "https://[::ffff:127.0.0.1]/doc"],
    ["IPv4-mapped IPv6 (compressed) → 10.0.0.1", "https://[::ffff:10.0.0.1]/doc"],
  ];
  for (const [name, url] of cases) {
    it(`rejects ${name}: ${url}`, async () => {
      const { fetch, calls } = okFetch();
      const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
      await expect(guarded(url)).rejects.toBeInstanceOf(SsrfError);
      expect(calls).toEqual([]);
    });
  }

  it("allows a public IP literal", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    const res = await guarded("https://93.184.216.34/doc");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("refuses alternate-encoded loopback literals (decimal/hex/octal/short-form)", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    for (const url of [
      "https://2130706433/doc", // 127.0.0.1 decimal
      "https://0x7f000001/doc", // 127.0.0.1 hex
      "https://0177.0.0.1/doc", // 127.0.0.1 octal
      "https://127.1/doc", // 127.0.0.1 short-form
    ]) {
      await expect(guarded(url)).rejects.toBeInstanceOf(SsrfError);
    }
    expect(calls).toEqual([]);
  });
});

describe("guard — DNS resolution + rebinding (Node branch)", () => {
  it("rejects a hostname that resolves to a private address", async () => {
    const dns: DnsLookup = async () => [{ address: "127.0.0.1", family: 4 }];
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: dns });
    await expect(guarded("https://evil.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("rejects a multi-record set where ANY record is private (rebinding mitigation)", async () => {
    const dns: DnsLookup = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: dns });
    await expect(guarded("https://rebind.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("rejects a multi-record set with a private metadata IP (public + metadata)", async () => {
    const dns: DnsLookup = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
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

  it("an INJECTED lookup that throws is a genuine resolution FAILURE — never a DNS-less fallback", async () => {
    // The default-Node-lookup → DNS-less fallback is scoped to the DEFAULT lookup only. An
    // injected lookup throwing — even with a message that looks like an import failure — must
    // STILL fail closed, not be reinterpreted as "this isn't really Node, allow the public host".
    const dns: DnsLookup = async () => {
      throw new Error("node:dns/promises is not importable");
    };
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: dns });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("resolves DNS exactly ONCE per hop", async () => {
    const dns = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    const { fetch } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: dns });
    await guarded("https://good.example/doc");
    expect(dns).toHaveBeenCalledTimes(1);
  });

  it("allows a host that resolves entirely to public addresses (v4 + v6)", async () => {
    const dns: DnsLookup = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ];
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: dns });
    await expect(guarded("https://good.example/doc")).resolves.toBeInstanceOf(Response);
    expect(calls).toHaveLength(1);
  });

  it("still classifies an IP literal even when no DNS is available", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null });
    await expect(guarded("https://127.0.0.1/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });
});

describe("guard — cloud-internal hostname denylist", () => {
  it("DEFAULT_HOSTNAME_DENYLIST is exported and frozen", () => {
    expect(Object.isFrozen(DEFAULT_HOSTNAME_DENYLIST)).toBe(true);
    expect(DEFAULT_HOSTNAME_DENYLIST).toContain("metadata.google.internal");
  });

  it("isDeniedHostname denies exact + dot-anchored-suffix cloud-internal names, case/trailing-dot tolerant", () => {
    const list = DEFAULT_HOSTNAME_DENYLIST;
    for (const h of [
      "metadata.google.internal",
      "x.metadata.google.internal",
      "foo.internal",
      "kubernetes.default.svc.cluster.local",
      "anything.vercel-internal.com",
      "Metadata.Google.Internal",
      "FOO.INTERNAL.",
    ]) {
      expect(isDeniedHostname(h, list)).toBe(true);
    }
    // localhost / *.local are NOT in the default denylist (they are handled by the
    // host-classification branches so the allowLoopback dev path is reachable). A normal
    // public hostname is never denied.
    expect(isDeniedHostname("localhost", list)).toBe(false);
    expect(isDeniedHostname("service.local", list)).toBe(false);
    expect(isDeniedHostname("alice.solidcommunity.net", list)).toBe(false);
    expect(isDeniedHostname("example.com", list)).toBe(false);
  });

  it("refuses a denied hostname BEFORE DNS (denylist short-circuits the resolver)", async () => {
    const dns = vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]);
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: dns });
    await expect(guarded("https://metadata.google.internal/")).rejects.toBeInstanceOf(SsrfError);
    expect(dns).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("a custom denylist overrides the default; [] disables the name denylist", async () => {
    // Custom: deny `corp.example`; a default-denied name (foo.internal) now resolves public.
    const dns: DnsLookup = async () => [{ address: "8.8.8.8", family: 4 }];
    const denied = createGuardedFetch({ dnsLookup: dns, hostnameDenylist: ["corp.example"] });
    await expect(denied("https://api.corp.example/")).rejects.toBeInstanceOf(SsrfError);
    const { fetch, calls } = okFetch();
    const empty = createGuardedFetch({ fetch, dnsLookup: dns, hostnameDenylist: [] });
    // With the denylist disabled, `foo.internal` is no longer name-denied — but the IP
    // classifier still applies (it resolves to a public IP here, so it is allowed).
    await expect(empty("https://foo.internal/")).resolves.toBeInstanceOf(Response);
    expect(calls).toHaveLength(1);
  });
});

describe("guard — content-type allowlist (when configured)", () => {
  it("rejects a final 2xx whose content-type is not in the allowlist (GuardError)", async () => {
    const fetch = (async () =>
      new Response("<html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({
      fetch,
      dnsLookup: PUBLIC_DNS,
      allowedContentTypes: ["text/turtle", "application/ld+json"],
    });
    await expect(guarded("https://x.example/doc")).rejects.toBeInstanceOf(GuardError);
  });

  it("rejects a missing content-type when an allowlist is configured", async () => {
    const fetch = (async () => new Response("data", { status: 200 })) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({
      fetch,
      dnsLookup: PUBLIC_DNS,
      allowedContentTypes: ["text/turtle"],
    });
    await expect(guarded("https://x.example/doc")).rejects.toBeInstanceOf(GuardError);
  });

  it("accepts an allowed content-type (ignoring parameters)", async () => {
    const fetch = (async () =>
      new Response("ttl", {
        status: 200,
        headers: { "content-type": "text/turtle; charset=utf-8" },
      })) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({
      fetch,
      dnsLookup: PUBLIC_DNS,
      allowedContentTypes: ["text/turtle"],
    });
    const res = await guarded("https://x.example/doc");
    expect(res.status).toBe(200);
  });

  it("body-irrelevant statuses (204/304) bypass the allowlist", async () => {
    const f204 = (async () => new Response(null, { status: 204 })) as typeof globalThis.fetch;
    const g204 = createGuardedFetch({
      fetch: f204,
      dnsLookup: PUBLIC_DNS,
      allowedContentTypes: ["text/turtle"],
    });
    expect((await g204("https://x.example/empty")).status).toBe(204);
  });
});

describe("guard — redirects", () => {
  function redirectingFetch(location: string): { fetch: typeof globalThis.fetch; calls: string[] } {
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

  it("does NOT auto-follow: issues redirect:manual to the underlying fetch", async () => {
    const { fetch } = redirectingFetch("https://other.example/doc");
    const spy = vi.fn(fetch);
    const guarded = createGuardedFetch({
      fetch: spy as typeof globalThis.fetch,
      dnsLookup: PUBLIC_DNS,
    });
    await guarded("https://registry.example/doc");
    for (const call of spy.mock.calls) {
      expect((call[1] as RequestInit).redirect).toBe("manual");
    }
  });

  it("re-validates a redirect target and REFUSES a redirect to a private host", async () => {
    const { fetch, calls } = redirectingFetch("https://169.254.169.254/latest/meta-data/");
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual(["https://registry.example/doc"]);
  });

  it("BLOCKS a redirect whose HOSTNAME resolves private (re-runs the guard per hop)", async () => {
    const dns: DnsLookup = async (host) =>
      host === "internal.example"
        ? [{ address: "10.1.2.3", family: 4 }]
        : [{ address: "93.184.216.34", family: 4 }];
    const { fetch } = redirectingFetch("https://internal.example/");
    const guarded = createGuardedFetch({ fetch, dnsLookup: dns });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
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
    let n = 0;
    const fetch = (async () => {
      n += 1;
      return new Response(null, { status: 302, headers: { location: `https://h${n}.example/x` } });
    }) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS, maxRedirects: 2 });
    await expect(guarded("https://start.example/x")).rejects.toBeInstanceOf(SsrfError);
  });

  it("strips credential headers on a CROSS-ORIGIN redirect (no Authorization leak)", async () => {
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
    expect(headersSeen[0]?.get("authorization")).toBe("Bearer secret");
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
        return new Response(null, {
          status: 307,
          headers: { location: "https://registry.example/other" },
        });
      }
      return new Response("ok", { status: 200, headers: { "content-type": "text/turtle" } });
    }) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    await guarded("https://registry.example/doc", { headers: { authorization: "Bearer secret" } });
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
    expect(seen[0]?.method).toBe("POST");
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
    const seen: Array<{ hasBody: boolean; auth: string | null }> = [];
    let hop = 0;
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const i = (init ?? {}) as RequestInit;
      seen.push({
        hasBody: i.body !== undefined && i.body !== null,
        auth: new Headers(i.headers ?? {}).get("authorization"),
      });
      hop += 1;
      if (hop === 1) {
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
    expect(seen[1]?.hasBody).toBe(false);
    expect(seen[1]?.auth).toBeNull();
  });

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
    expect(res.url).toBe("https://other.example/final");
  });
});

describe("guard — null-body response statuses", () => {
  it("handles a 204 No Content without throwing", async () => {
    const fetch = (async () => new Response(null, { status: 204 })) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    const res = await guarded("https://registry.example/empty");
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("handles a 304 Not Modified without throwing (etag preserved)", async () => {
    const fetch = (async () =>
      new Response(null, { status: 304, headers: { etag: '"abc"' } })) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS });
    const res = await guarded("https://registry.example/cached");
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe('"abc"');
  });
});

describe("guard — requireDnsPinning posture (DNS-rebinding fail-closed)", () => {
  it("refuses a HOSTNAME through the default fetch when requireDnsPinning is set", async () => {
    const guarded = createGuardedFetch({ dnsLookup: PUBLIC_DNS, requireDnsPinning: true });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
  });

  it("FAILS BEFORE the DNS query — does NOT call the injected lookup when pinning rejects", async () => {
    let lookupCalls = 0;
    const dns: DnsLookup = async () => {
      lookupCalls += 1;
      return [{ address: "93.184.216.34", family: 4 }];
    };
    const guarded = createGuardedFetch({ dnsLookup: dns, requireDnsPinning: true });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(lookupCalls).toBe(0);
  });

  it("STILL refuses a hostname under requireDnsPinning with a plain (non-pinning) fetch", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS, requireDnsPinning: true });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
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
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS, requireDnsPinning: true });
    await expect(guarded("https://93.184.216.34/doc")).resolves.toBeInstanceOf(Response);
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// BROWSER branch: the DNS-less guard. `dnsLookup: null` forces the no-resolver branch — the
// SAME branch a browser bundle (no node:dns) takes automatically.
// ---------------------------------------------------------------------------
describe("guard — BROWSER branch (no node:dns)", () => {
  function stubBrowser() {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("document", {});
  }
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  function browserGuard() {
    stubBrowser();
    const { fetch, calls } = okFetch();
    return { guarded: createGuardedFetch({ fetch, dnsLookup: null }), calls };
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
    // SsrfError for the name itself; `localhost:8443` may be refused by the port gate first
    // (GuardError) — either way it is REFUSED and never reaches the fetch.
    for (const url of [
      "https://localhost/doc",
      "https://localhost:8443/doc",
      "https://api.localhost/doc",
      "https://printer.local/doc",
      "https://LOCALHOST/doc",
      "https://host.local./doc",
    ]) {
      await expectRefused(guarded(url));
    }
    expect(calls).toEqual([]);
  });

  it("rejects private / loopback / link-local / metadata IP LITERALS in the host", async () => {
    const { guarded, calls } = browserGuard();
    for (const url of [
      "https://127.0.0.1/doc",
      "https://10.0.0.5/doc",
      "https://172.16.0.1/doc",
      "https://192.168.1.1/doc",
      "https://169.254.169.254/latest/meta-data/",
      "https://100.64.0.1/doc",
      "https://0.0.0.0/doc",
      "https://[::1]/doc",
      "https://[fc00::1]/doc",
      "https://[fe80::1]/doc",
      "https://[::ffff:10.0.0.1]/doc",
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
    const guarded = createGuardedFetch({ fetch, dnsLookup: null });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual(["https://registry.example/doc"]);
  });

  it("still caps the body on the browser branch", async () => {
    stubBrowser();
    const big = "a".repeat(2048);
    const fetch = (async () =>
      new Response(big, {
        status: 200,
        headers: { "content-type": "text/turtle" },
      })) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: null, maxBytes: 1024 });
    await expect(guarded("https://big.example/doc")).rejects.toBeInstanceOf(SsrfError);
  });

  it("permits an http://localhost dev registry under allowLoopback (loopback name)", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null, allowLoopback: true });
    const res = await guarded("http://localhost:3000/doc");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("REFUSES http: to a PUBLIC-looking host even under allowLoopback", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null, allowLoopback: true });
    await expect(guarded("http://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("REFUSES .local / *.local mDNS names even under allowLoopback (and in a browser)", async () => {
    stubBrowser();
    for (const flag of [{ allowLoopback: true }, { allowLoopback: false }]) {
      for (const url of [
        "https://printer.local/doc",
        "https://host.local./doc",
        "http://printer.local/doc",
        "https://local/doc",
      ]) {
        const { fetch, calls } = okFetch();
        const guarded = createGuardedFetch({ fetch, dnsLookup: null, ...flag });
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

    it("FAILS CLOSED for a localhost target under requireDnsPinning + allowLoopback", async () => {
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
// EDGE / WORKER runtime: "no node:dns" is ALSO true in a non-browser server runtime. There an
// unresolved public-looking hostname is a real SSRF escalation — fail closed by default.
// ---------------------------------------------------------------------------
describe("guard — DNS-less NON-browser runtime fails closed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("FAILS CLOSED for a public-looking host (no DOM window → treated as edge/worker)", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
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

  it("a WebWorker self-global (no window/document) is NOT a browser (fail closed)", async () => {
    vi.stubGlobal("self", {});
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("a DOM-shimmed server (jsdom: window !== globalThis) STILL fails closed", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });
});

describe("guard — Request object input", () => {
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

describe("guard — body cap + timeout", () => {
  it("rejects an over-cap declared Content-Length up front", async () => {
    const fetch = (async () =>
      new Response("x", {
        status: 200,
        headers: { "content-type": "text/turtle", "content-length": "999999" },
      })) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS, maxBytes: 1024 });
    await expect(guarded("https://big.example/doc")).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects an over-cap streamed body (no Content-Length)", async () => {
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

  it("aborts when the timeout elapses (keeps the timer active through the body read)", async () => {
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS, timeoutMs: 20 });
    await expect(guarded("https://slow.example/doc")).rejects.toBeInstanceOf(SsrfError);
  });

  it("honours a caller AbortSignal (external abort surfaces as a refusal)", async () => {
    // A faithful fetch stub: reject immediately if the signal is ALREADY aborted (real fetch
    // does this), else reject when it fires. The caller aborts before the guard reaches the
    // fetcher, so the already-aborted branch is what surfaces the refusal.
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new Error("aborted"));
          return;
        }
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as typeof globalThis.fetch;
    const guarded = createGuardedFetch({ fetch, dnsLookup: PUBLIC_DNS, timeoutMs: 10_000 });
    const ac = new AbortController();
    const p = guarded("https://slow.example/doc", { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(SsrfError);
  });
});

describe("guard — allowLoopback dev path (Node branch)", () => {
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

describe("guard — one-shot guardedFetch + assertSafeUrl + helpers", () => {
  it("guardedFetch applies the same policy", async () => {
    await expect(
      guardedFetch("https://127.0.0.1/doc", { dnsLookup: PUBLIC_DNS }),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it("assertSafeUrl validates a URL without issuing a request", async () => {
    await expect(
      assertSafeUrl("https://93.184.216.34/doc", { dnsLookup: PUBLIC_DNS }),
    ).resolves.toBeUndefined();
    await expect(
      assertSafeUrl("https://169.254.169.254/", { dnsLookup: PUBLIC_DNS }),
    ).rejects.toBeInstanceOf(SsrfError);
    await expect(
      assertSafeUrl("http://example.com/", { dnsLookup: PUBLIC_DNS }),
    ).rejects.toBeInstanceOf(SsrfError);
    await expect(
      assertSafeUrl("https://user:pass@example.com/", { dnsLookup: PUBLIC_DNS }),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it("normalizeHostForClassification canonicalises alternate IPv4 encodings", () => {
    expect(normalizeHostForClassification("2130706433")).toBe("127.0.0.1");
    expect(normalizeHostForClassification("0x7f000001")).toBe("127.0.0.1");
    expect(normalizeHostForClassification("0177.0.0.1")).toBe("127.0.0.1");
    expect(normalizeHostForClassification("127.1")).toBe("127.0.0.1");
    expect(normalizeHostForClassification("0x7f.0.0.1")).toBe("127.0.0.1");
    expect(normalizeHostForClassification("[::1]")).toBe("::1");
    expect(normalizeHostForClassification("Alice.Example")).toBe("alice.example");
    expect(normalizeHostForClassification("127.0.0.1.evil.com")).toBe("127.0.0.1.evil.com");
    expect(normalizeHostForClassification("a b c")).toBe("a b c");
  });
});
