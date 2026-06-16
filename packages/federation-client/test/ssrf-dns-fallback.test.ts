// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Regression tests for the DNS-capability fallback (#92 round-3 + round-4 Medium): when
// the DEFAULT node lookup is selected (hasNodeDns() heuristic true, e.g. a browser bundle
// with a `process` shim) but `node:dns/promises` is NOT actually importable, the guard
// must FALL BACK to the DNS-less policy rather than misreport a resolution failure — and
// once node:dns is proven unavailable, browser-ness is decided by DOM globals ALONE (so a
// real browser with a process shim is treated as a browser, not rejected).
//
// This file mocks `node:dns/promises` to THROW on import (vitest intercepts the opaque
// dynamic import). It is isolated from ssrf.test.ts so that mock does not affect the
// Node-branch tests there.

import { afterEach, describe, expect, it, vi } from "vitest";

// Force the dynamic `import("node:dns/promises")` to fail — simulating a runtime that
// merely LOOKS like Node (process.versions.node present) but cannot import node:dns.
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

describe("SSRF guard — default node:dns import FAILS → DNS-less fallback (#92 round-3/4)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to DNS-less and FAILS CLOSED for a public host with no DOM (edge-like)", async () => {
    // process.versions.node is present (Node test runtime), so the DEFAULT node lookup is
    // selected; the mock makes its node:dns import throw NodeDnsUnavailableError → DNS-less
    // fallback. No DOM globals here → treated as edge → public host fails closed.
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch }); // default lookup (no dnsLookup arg)
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("falls back and ALLOWS a public host in a real browser + process shim (round-4)", async () => {
    // The KEY round-4 case: process.versions.node present (shim) AND a REAL browser
    // (window === globalThis). The default node lookup is selected, its import fails, and
    // the fallback must classify by isBrowserContext() (which is process-independent), so
    // the public host is ALLOWED — not rejected by a stale process-based decision.
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("document", {});
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch });
    await expect(guarded("https://registry.example/doc")).resolves.toBeInstanceOf(Response);
    expect(calls).toHaveLength(1);
  });

  it("falls back but FAILS CLOSED for a public host in a DOM-SHIMMED server (window !== globalThis)", async () => {
    // A jsdom/SSR DOM shim sets a SEPARATE window object → NOT a real browser → fail closed
    // even on the import-failure fallback (roborev #92 round-5 Medium).
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

  it("falls back and respects requireDnsPinning + allowUnresolvedHosts in a real browser (round-5)", async () => {
    // Browser + process shim + node:dns import fails + requireDnsPinning + allowUnresolved:
    // the strict-pinning gate must NOT pre-reject before the fallback; the DNS-less policy
    // then honours allowUnresolvedHosts and allows the public host (roborev #92 round-5).
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
    // No DOM globals, but an IP literal needs no resolver and is allowed in both runtimes.
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch });
    await expect(guarded("https://93.184.216.34/doc")).resolves.toBeInstanceOf(Response);
    expect(calls).toHaveLength(1);
  });
});
