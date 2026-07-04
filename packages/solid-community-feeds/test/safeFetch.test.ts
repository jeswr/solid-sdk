// AUTHORED-BY Claude Sonnet
/**
 * `safeFetch` is now a thin adapter over `@jeswr/guarded-fetch` (see the module
 * doc in `src/safeFetch.ts`). The exhaustive private/loopback/link-local/IPv6/
 * alternate-encoding/DNS-rebinding/redirect-to-private test matrix for the SHARED
 * guard core lives in `@jeswr/guarded-fetch`'s own test suite — not duplicated
 * here. This file keeps:
 *   - the `assertSafeUrl` cases (still exercised — they ALSO prove this package's
 *     EXTRA hostname denylist entries + the forced DNS-less wiring, which are
 *     specific to this package, not to guarded-fetch's own default policy);
 *   - the `safeFetch` request-behaviour cases (headers, redirect-refusal, body
 *     cap, timeout, network/HTTP-status mapping, JSON parsing) — proving the
 *     adapter wiring, not re-testing the guard's internals.
 */
import { describe, expect, it, vi } from "vitest";
import {
  assertSafeUrl,
  type FetchLike,
  SafeFetchError,
  safeFetch,
  safeFetchJson,
} from "../src/safeFetch.js";
import { stubFetch } from "./fixtures.js";

/**
 * `assertSafeUrl` now does REAL DNS-resolved validation — a hostname that resolves
 * to a private IP MUST be rejected (the SSRF regression roborev caught). The tests
 * inject a stub resolver (`opts.dnsLookup`) so a hostname case is DETERMINISTIC +
 * hermetic (no live network): `publicResolver` for a legitimately-public host,
 * `loopbackResolver`/`privateResolver` for the block cases. Literal-IP and
 * denylisted-name cases short-circuit before any resolution, so their resolver is
 * never consulted.
 */
const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];
const loopbackResolver = async () => [{ address: "127.0.0.1", family: 4 }];
const privateResolver = async () => [{ address: "10.0.0.5", family: 4 }];

describe("assertSafeUrl — SSRF guards (via @jeswr/guarded-fetch)", () => {
  it("accepts a plain https public URL", async () => {
    expect(
      (await assertSafeUrl("https://matrix.org/_matrix", { dnsLookup: publicResolver })).hostname,
    ).toBe("matrix.org");
  });

  it("REJECTS a hostname that resolves to a private IP (the DNS-rebinding/SSRF case)", async () => {
    // The regression roborev caught: a public-LOOKING hostname whose DNS answer is
    // a private/internal IP must be refused — assertSafeUrl must resolve + block it,
    // not wave it through on a DNS-less syntactic check.
    try {
      await assertSafeUrl("https://sneaky-public-name.example/", { dnsLookup: privateResolver });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SafeFetchError).code).toBe("blocked-host");
    }
  });

  it("REJECTS a hostname that resolves to loopback (127.0.0.1)", async () => {
    try {
      await assertSafeUrl("https://rebind.example/", { dnsLookup: loopbackResolver });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SafeFetchError).code).toBe("blocked-host");
    }
  });

  it("rejects http://", async () => {
    await expect(assertSafeUrl("http://example.com")).rejects.toThrowError(SafeFetchError);
    try {
      await assertSafeUrl("http://example.com");
    } catch (e) {
      expect((e as SafeFetchError).code).toBe("scheme");
    }
  });

  it.each([
    "file:///etc/passwd",
    "data:text/plain,hi",
    "ftp://x",
    "gopher://x",
  ])("rejects non-https scheme %s", async (url) => {
    await expect(assertSafeUrl(url)).rejects.toThrowError(SafeFetchError);
  });

  it("rejects credentials embedded in URL", async () => {
    try {
      await assertSafeUrl("https://user:pass@example.com");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SafeFetchError).code).toBe("credentials");
    }
  });

  it.each([
    "https://127.0.0.1/",
    "https://10.0.0.5/",
    "https://172.16.0.1/",
    "https://172.31.255.1/",
    "https://192.168.1.1/",
    "https://169.254.169.254/", // cloud metadata
    "https://0.0.0.0/",
    "https://100.64.0.1/", // CGNAT
    "https://224.0.0.1/", // multicast
    "https://[::1]/", // ipv6 loopback
    "https://[fe80::1]/", // ipv6 link-local
    "https://[fc00::1]/", // ipv6 unique-local
    "https://[fd12::1]/",
    "https://[ff02::1]/", // ipv6 multicast
    "https://[::ffff:127.0.0.1]/", // ipv4-mapped loopback
    "https://[::ffff:10.0.0.1]/", // ipv4-mapped private
  ])("blocks private/reserved literal IP %s", async (url) => {
    try {
      await assertSafeUrl(url);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SafeFetchError).code).toBe("blocked-host");
    }
  });

  it.each([
    "https://8.8.8.8/",
    "https://1.1.1.1/",
    "https://172.32.0.1/",
  ])("allows public literal IP %s", async (url) => {
    await expect(assertSafeUrl(url)).resolves.not.toThrow();
  });

  it.each([
    "https://localhost/",
    "https://localhost:8080/x",
    "https://service.local/",
    "https://api.internal/",
    "https://db.intranet/",
    "https://box.lan/",
    "https://router.home.arpa/",
    "https://1.0.0.127.in-addr.arpa/",
    // bare single-label / special-use names (no leading dot) — this package's
    // EXTRA hostnameDenylist entries (beyond guarded-fetch's cloud-focused default).
    "https://local/",
    "https://internal/",
    "https://intranet/",
    "https://lan/",
    "https://home.arpa/",
    "https://in-addr.arpa/",
    "https://ip6.arpa/",
  ])("blocks local/internal hostname %s", async (url) => {
    // A denylisted name throws BEFORE any resolution; localhost/*.local/bare-`local`
    // are refused via the resolver returning a loopback address. Injecting the
    // resolver keeps every case deterministic + offline.
    try {
      await assertSafeUrl(url, { dnsLookup: loopbackResolver });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SafeFetchError).code).toBe("blocked-host");
    }
  });

  it.each([
    "https://matrix.org/",
    "https://forum.solidproject.org/",
    "https://example.com/",
  ])("allows a public DNS hostname %s (resolving to a public IP)", async (url) => {
    await expect(assertSafeUrl(url, { dnsLookup: publicResolver })).resolves.not.toThrow();
  });

  it.each([
    "https://localhost/",
    "https://foo.localhost/",
    "https://something.local/",
    "https://local/",
  ])(
    "REJECTS special-use hostname %s pre-resolution even when the injected resolver returns a PUBLIC IP " +
      "(roborev regression: assertSafeUrl's DNS-resolving branch must not accept these on resolver say-so)",
    async (url) => {
      // This is the exact gap the roborev finding named: assertSafeUrl always runs
      // guarded-fetch's DNS-RESOLVING branch, which bypasses guarded-fetch's own
      // DNS-less special-name checks for localhost/*.localhost/local/*.local. If
      // localhost/local were only ever rejected because the test resolver returns a
      // loopback address (as the "blocks local/internal hostname" cases above do),
      // a resolver that answered with a PUBLIC address for one of these names would
      // slip through. Proving these fail with `publicResolver` injected demonstrates
      // the block is the PRE-resolution `hostnameDenylist` check (this package's
      // EXTRA_HOSTNAME_DENYLIST `.localhost` / `.local` entries), not resolver luck.
      try {
        await assertSafeUrl(url, { dnsLookup: publicResolver });
        throw new Error("should have thrown");
      } catch (e) {
        expect((e as SafeFetchError).code).toBe("blocked-host");
      }
    },
  );

  it("rejects a malformed URL", async () => {
    await expect(assertSafeUrl("not a url")).rejects.toThrowError(SafeFetchError);
  });
});

describe("safeFetch — request behaviour (adapter over @jeswr/guarded-fetch)", () => {
  it("returns body on 2xx and sends headers through the guard", async () => {
    const { fetch, calls } = stubFetch([
      { match: () => true, body: { ok: true }, bodyText: '{"ok":true}' },
    ]);
    const res = await safeFetch(
      "https://matrix.org/x",
      { method: "GET", headers: { Authorization: "Bearer secret" } },
      { fetch },
    );
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"ok":true}');
    expect(calls[0]?.headers?.Authorization).toBe("Bearer secret");
  });

  it("refuses to follow a redirect (redirect-refusal preserved via maxRedirects: 0)", async () => {
    const { fetch } = stubFetch([
      {
        match: () => true,
        status: 302,
        responseHeaders: { location: "https://x.test/other" },
      },
    ]);
    try {
      await safeFetch("https://x.test/", {}, { fetch });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SafeFetchError).code).toBe("redirect");
    }
  });

  it("maps non-2xx to an http error with status", async () => {
    const { fetch } = stubFetch([{ match: () => true, status: 404, statusText: "Not Found" }]);
    try {
      await safeFetch("https://x.test/", {}, { fetch });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SafeFetchError).code).toBe("http");
      expect((e as SafeFetchError).status).toBe(404);
    }
  });

  it("maps a thrown network error", async () => {
    const { fetch } = stubFetch([{ match: () => true, throwNetwork: true }]);
    try {
      await safeFetch("https://x.test/", {}, { fetch });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SafeFetchError).code).toBe("network");
    }
  });

  it("enforces the body size cap", async () => {
    const big = "x".repeat(100);
    const { fetch } = stubFetch([{ match: () => true, bodyText: big }]);
    try {
      await safeFetch("https://x.test/", {}, { fetch, maxBytes: 10 });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SafeFetchError).code).toBe("too-large");
    }
  });

  it("times out via the guard's own AbortController", async () => {
    const slowFetch = vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      }) as never;
    });
    try {
      await safeFetch("https://x.test/", {}, { fetch: slowFetch as never, timeoutMs: 5 });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SafeFetchError).code).toBe("timeout");
    }
  });

  it("rejects a declared-oversize body via content-length before buffering", async () => {
    const { fetch } = stubFetch([
      {
        match: () => true,
        bodyText: "small",
        responseHeaders: { "content-length": "999999" },
      },
    ]);
    try {
      await safeFetch("https://x.test/", {}, { fetch, maxBytes: 100 });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SafeFetchError).code).toBe("too-large");
      expect((e as Error).message).toContain("Content-Length");
    }
  });

  it("keeps the timeout active during the body read", async () => {
    // fetch resolves headers immediately, but the body stream never yields until
    // the SAME AbortSignal the guard passed to this stub fires (mirroring how a
    // real fetch's body stream is tied to the request's AbortSignal).
    const fetch: FetchLike = async (_url, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => {
            controller.error(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        },
      });
      return new Response(stream, {
        status: 200,
        statusText: "OK",
      }) as unknown as Awaited<ReturnType<FetchLike>>;
    };
    try {
      await safeFetch("https://x.test/", {}, { fetch, timeoutMs: 5 });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SafeFetchError).code).toBe("timeout");
    }
  });

  it("streams the body and aborts mid-stream once over maxBytes (no full buffer)", async () => {
    let chunksYielded = 0;
    const fetch: FetchLike = async () => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          chunksYielded += 1;
          // each chunk is 8 bytes; cap is 10 → over after the 2nd chunk
          controller.enqueue(new Uint8Array(8));
        },
      });
      return new Response(stream, {
        status: 200,
        statusText: "OK",
      }) as unknown as Awaited<ReturnType<FetchLike>>;
    };
    try {
      await safeFetch("https://x.test/", {}, { fetch, maxBytes: 10 });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SafeFetchError).code).toBe("too-large");
    }
    // It stopped early — did NOT drain all 100 potential chunks.
    expect(chunksYielded).toBeLessThan(100);
  });

  it("streams and decodes a body within the cap (multi-chunk)", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hel"));
        controller.enqueue(new TextEncoder().encode("lo"));
        controller.close();
      },
    });
    const fetch: FetchLike = async () =>
      new Response(stream, {
        status: 200,
        statusText: "OK",
      }) as unknown as Awaited<ReturnType<FetchLike>>;
    const res = await safeFetch("https://x.test/", {}, { fetch, maxBytes: 1000 });
    expect(res.body).toBe("hello");
  });

  it("refuses a blocked-host URL before fetching", async () => {
    const fetch = vi.fn();
    try {
      await safeFetch("https://169.254.169.254/latest", {}, { fetch: fetch as never });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SafeFetchError).code).toBe("blocked-host");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("safeFetchJson", () => {
  it("parses JSON", async () => {
    const { fetch } = stubFetch([{ match: () => true, bodyText: '{"a":1}' }]);
    expect(await safeFetchJson<{ a: number }>("https://x.test/", {}, { fetch })).toEqual({
      a: 1,
    });
  });
  it("throws on malformed JSON", async () => {
    const { fetch } = stubFetch([{ match: () => true, bodyText: "not json" }]);
    await expect(safeFetchJson("https://x.test/", {}, { fetch })).rejects.toThrowError(
      SafeFetchError,
    );
  });
});
