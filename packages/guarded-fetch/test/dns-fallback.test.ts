// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * CHARACTERIZATION TESTS — the DNS-capability fallback. When the DEFAULT node lookup is
 * selected (the `hasNodeDns()` heuristic is true, e.g. a browser bundle with a `process` shim)
 * but `node:dns/promises` is NOT actually importable, the guard must FALL BACK to the DNS-less
 * policy rather than misreport a resolution failure — and once node:dns is proven unavailable,
 * browser-ness is decided by DOM globals ALONE (so a real browser with a process shim is
 * treated as a browser, not rejected). Ported from federation-client `ssrf-dns-fallback.test.ts`.
 *
 * This file mocks `node:dns/promises` to THROW on import. It is isolated from guard.test.ts so
 * that mock does not affect the Node-branch tests there.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Force the dynamic `import("node:dns/promises")` to fail — simulating a runtime that merely
// LOOKS like Node (process.versions.node present) but cannot import node:dns.
vi.mock("node:dns/promises", () => {
  throw new Error("Cannot find module 'node:dns/promises'");
});

import { createGuardedFetch, SsrfError } from "../src/index.js";

function okFetch(): { fetch: typeof globalThis.fetch; calls: string[] } {
  const calls: string[] = [];
  const fetch = (async (url: string | URL | Request) => {
    calls.push(typeof url === "string" ? url : url.toString());
    return new Response("ok", { status: 200, headers: { "content-type": "text/turtle" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("guard — default node:dns import FAILS → DNS-less fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to DNS-less and FAILS CLOSED for a public host with no DOM (edge-like)", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch }); // default lookup (no dnsLookup arg)
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("falls back and ALLOWS a public host in a real browser + process shim", async () => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("document", {});
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch });
    await expect(guarded("https://registry.example/doc")).resolves.toBeInstanceOf(Response);
    expect(calls).toHaveLength(1);
  });

  it("falls back but FAILS CLOSED for a public host in a DOM-SHIMMED server (window !== globalThis)", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("falls back but STILL refuses a private IP literal (literal block is absolute)", async () => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("document", {});
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch });
    await expect(guarded("https://10.0.0.1/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("falls back but STILL refuses localhost / .local even in a real browser", async () => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("document", {});
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch });
    for (const url of ["https://localhost/doc", "https://printer.local/doc"]) {
      await expect(guarded(url)).rejects.toBeInstanceOf(SsrfError);
    }
    expect(calls).toEqual([]);
  });

  it("falls back and respects requireDnsPinning + allowUnresolvedHosts in a real browser", async () => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("document", {});
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({
      fetch,
      requireDnsPinning: true,
      allowUnresolvedHosts: true,
    });
    await expect(guarded("https://registry.example/doc")).resolves.toBeInstanceOf(Response);
    expect(calls).toHaveLength(1);
  });

  it("falls back and STILL fails closed under requireDnsPinning WITHOUT allowUnresolvedHosts", async () => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("document", {});
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, requireDnsPinning: true });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("a PUBLIC IP literal still works on the import-failure fallback (no resolution needed)", async () => {
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch });
    await expect(guarded("https://93.184.216.34/doc")).resolves.toBeInstanceOf(Response);
    expect(calls).toHaveLength(1);
  });
});
