// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it, vi } from "vitest";
import {
  assertSafeUrl,
  type FetchLike,
  SafeFetchError,
  safeFetch,
  safeFetchJson,
} from "../src/safeFetch.js";
import { stubFetch } from "./fixtures.js";

describe("assertSafeUrl — SSRF guards", () => {
  it("accepts a plain https public URL", () => {
    expect(assertSafeUrl("https://matrix.org/_matrix").hostname).toBe("matrix.org");
  });

  it("rejects http://", () => {
    expect(() => assertSafeUrl("http://example.com")).toThrowError(SafeFetchError);
    try {
      assertSafeUrl("http://example.com");
    } catch (e) {
      expect((e as SafeFetchError).code).toBe("scheme");
    }
  });

  it.each([
    "file:///etc/passwd",
    "data:text/plain,hi",
    "ftp://x",
    "gopher://x",
  ])("rejects non-https scheme %s", (url) => {
    expect(() => assertSafeUrl(url)).toThrowError(SafeFetchError);
  });

  it("rejects credentials embedded in URL", () => {
    try {
      assertSafeUrl("https://user:pass@example.com");
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
  ])("blocks private/reserved literal IP %s", (url) => {
    try {
      assertSafeUrl(url);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SafeFetchError).code).toBe("blocked-host");
    }
  });

  it.each([
    "https://8.8.8.8/",
    "https://1.1.1.1/",
    "https://172.32.0.1/",
  ])("allows public literal IP %s", (url) => {
    expect(() => assertSafeUrl(url)).not.toThrow();
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
    // bare single-label / special-use names (no leading dot)
    "https://local/",
    "https://internal/",
    "https://intranet/",
    "https://lan/",
    "https://home.arpa/",
    "https://in-addr.arpa/",
    "https://ip6.arpa/",
  ])("blocks local/internal hostname %s", (url) => {
    try {
      assertSafeUrl(url);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SafeFetchError).code).toBe("blocked-host");
    }
  });

  it.each([
    "https://matrix.org/",
    "https://forum.solidproject.org/",
    "https://example.com/",
  ])("allows a public DNS hostname %s", (url) => {
    expect(() => assertSafeUrl(url)).not.toThrow();
  });

  it("rejects a malformed URL", () => {
    expect(() => assertSafeUrl("not a url")).toThrowError(SafeFetchError);
  });
});

describe("safeFetch — request behaviour", () => {
  it("returns body on 2xx and sends manual redirect + headers", async () => {
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

  it("treats a 30x as a redirect error (no auto-follow)", async () => {
    const { fetch } = stubFetch([{ match: () => true, status: 302 }]);
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

  it("times out via AbortController", async () => {
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
      expect((e as Error).message).toContain("declared");
    }
  });

  it("keeps the timeout active during the body read", async () => {
    // fetch resolves headers immediately, but .text() never resolves until abort.
    const fetch = vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        text: () =>
          new Promise<string>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            });
          }),
      };
    });
    try {
      await safeFetch("https://x.test/", {}, { fetch: fetch as never, timeoutMs: 5 });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SafeFetchError).code).toBe("timeout");
      expect((e as Error).message).toContain("body");
    }
  });

  it("streams the body and aborts mid-stream once over maxBytes (no full buffer)", async () => {
    let chunksYielded = 0;
    const fetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null }, // no content-length → pre-check can't catch it
      text: async () => {
        throw new Error("text() must NOT be called when a stream is available");
      },
      body: (async function* () {
        // each chunk is 8 bytes; cap is 10 → over after the 2nd chunk
        for (let i = 0; i < 100; i++) {
          chunksYielded++;
          yield new Uint8Array(8);
        }
      })(),
    });
    try {
      await safeFetch("https://x.test/", {}, { fetch, maxBytes: 10 });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SafeFetchError).code).toBe("too-large");
    }
    // It stopped early — did NOT drain all 100 chunks.
    expect(chunksYielded).toBeLessThan(100);
  });

  it("streams and decodes a body within the cap (string + byte chunks)", async () => {
    const fetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      text: async () => {
        throw new Error("text() must NOT be called when a stream is available");
      },
      body: (async function* () {
        yield new TextEncoder().encode("hel");
        yield "lo";
      })(),
    });
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
