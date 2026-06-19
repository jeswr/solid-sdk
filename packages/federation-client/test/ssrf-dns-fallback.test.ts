// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// DNS-less / capability-fallback behaviour for the re-exported guard.
//
// HISTORY + the test-boundary this file now respects. Before this package adopted the
// consolidated `@jeswr/guarded-fetch`, the SSRF guard was inline in `src/ssrf.ts`, so a
// test could `vi.mock("node:dns/promises")` to force its INTERNAL dynamic `node:dns` import
// to throw and exercise the "looks-like-Node but node:dns is not importable → fall back to
// the DNS-less policy" path. That mechanism is now OWNED by `@jeswr/guarded-fetch` and is
// exhaustively tested in ITS OWN suite (`guarded-fetch/test/dns-fallback.test.ts`, same
// `vi.mock` approach against its own SOURCE). This package consumes guarded-fetch as a
// PRE-BUNDLED `dist/`, and `vi.mock` cannot reliably intercept a computed dynamic
// `import("node:dns/promises")` inside pre-bundled third-party code — so re-testing that
// internal import-failure path HERE would be both redundant and flaky (it falls through to
// REAL DNS). We therefore test what is meaningful AT THIS PACKAGE'S LAYER: that the
// re-exported guard, driven down the DNS-less branch via the deterministic, public
// `dnsLookup: null` seam, makes the correct allow/deny decisions — no internal-import mock,
// fully offline + deterministic.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createGuardedFetch, SsrfError } from "../src/index.js";

function okFetch(): { fetch: typeof globalThis.fetch; calls: string[] } {
  const calls: string[] = [];
  const fetch = (async (url: string | URL | Request) => {
    calls.push(typeof url === "string" ? url : url.toString());
    return new Response("ok", { status: 200, headers: { "content-type": "text/turtle" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

/** Positively identify a browser the way guarded-fetch's `isBrowserContext()` checks. */
function stubBrowser() {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("document", {});
}

describe("re-exported guard — DNS-less branch (dnsLookup: null) decisions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("FAILS CLOSED for a public host in a NON-browser DNS-less runtime (edge-like)", async () => {
    // No DOM globals → not a positively-identified browser → a public-looking hostname with
    // no resolver fails closed (an unresolved host reaching private infra is real SSRF there).
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("ALLOWS a public host in a positively-identified browser (the inherent residual)", async () => {
    stubBrowser();
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null });
    await expect(guarded("https://registry.example/doc")).resolves.toBeInstanceOf(Response);
    expect(calls).toHaveLength(1);
  });

  it("FAILS CLOSED for a public host in a DOM-SHIMMED server (window !== globalThis)", async () => {
    // A jsdom/SSR shim sets a SEPARATE window object → NOT a real browser → fail closed.
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("STILL refuses a private IP literal on the DNS-less branch (literal block is absolute)", async () => {
    stubBrowser();
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null });
    await expect(guarded("https://10.0.0.1/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("STILL refuses localhost / .local even in a real browser on the DNS-less branch", async () => {
    stubBrowser();
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null });
    for (const url of ["https://localhost/doc", "https://printer.local/doc"]) {
      await expect(guarded(url)).rejects.toBeInstanceOf(SsrfError);
    }
    expect(calls).toEqual([]);
  });

  it("a PUBLIC IP literal works on the DNS-less branch (no resolution needed)", async () => {
    stubBrowser();
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null });
    await expect(guarded("https://93.184.216.34/doc")).resolves.toBeInstanceOf(Response);
    expect(calls).toHaveLength(1);
  });

  it("respects requireDnsPinning + allowUnresolvedHosts in a real browser (DNS-less)", async () => {
    stubBrowser();
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

  it("STILL fails closed under requireDnsPinning WITHOUT allowUnresolvedHosts (DNS-less)", async () => {
    stubBrowser();
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: null, requireDnsPinning: true });
    await expect(guarded("https://registry.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });
});
