// AUTHORED-BY Claude Fable 5
//
// Unit + regression tests for the data-path fetch choke point (scope.ts): base
// containment of the initial target and REDIRECT REFUSAL (the credential-leak /
// SSRF guard).

import { describe, expect, it, vi } from "vitest";
import { createScopedFetch, SolidRedirectError } from "../src/scope.js";

const BASE = "https://pod.example/kv/";

describe("createScopedFetch — base containment", () => {
  it("asserts the initial target is within base before issuing the request", async () => {
    const inner = vi.fn(async () => new Response("x", { status: 200 }));
    const scoped = createScopedFetch(BASE, inner as unknown as typeof fetch);
    await expect(scoped("https://evil.example/steal")).rejects.toThrow(/escapes base origin/);
    // The request never reached the underlying fetch.
    expect(inner).not.toHaveBeenCalled();
  });

  it("passes a within-base request through and returns the response", async () => {
    const inner = vi.fn(async () => new Response("ok", { status: 200 }));
    const scoped = createScopedFetch(BASE, inner as unknown as typeof fetch);
    const res = await scoped(`${BASE}foo`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});

describe("createScopedFetch — redirect refusal", () => {
  it('forces `redirect: "manual"` on the underlying fetch', async () => {
    const inner = vi.fn(async () => new Response("ok", { status: 200 }));
    const scoped = createScopedFetch(BASE, inner as unknown as typeof fetch);
    await scoped(`${BASE}foo`, { method: "GET" });
    expect(inner).toHaveBeenCalledTimes(1);
    const init = inner.mock.calls[0]?.[1] as RequestInit;
    expect(init.redirect).toBe("manual");
  });

  it("refuses a readable 3xx redirect (Node/undici) — never follows it", async () => {
    const inner = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/harvest" },
        }),
    );
    const scoped = createScopedFetch(BASE, inner as unknown as typeof fetch);
    await expect(scoped(`${BASE}poisoned`)).rejects.toBeInstanceOf(SolidRedirectError);
    // Exactly ONE call: the guard threw instead of following the Location.
    expect(inner).toHaveBeenCalledTimes(1);
    // The single call went to the in-pod URL, NOT the evil redirect target.
    expect(inner.mock.calls[0]?.[0]).toBe(`${BASE}poisoned`);
  });

  it("refuses an in-base 3xx redirect too (fail-closed; a data request should not redirect)", async () => {
    const inner = vi.fn(
      async () => new Response(null, { status: 301, headers: { location: `${BASE}elsewhere` } }),
    );
    const scoped = createScopedFetch(BASE, inner as unknown as typeof fetch);
    await expect(scoped(`${BASE}foo`)).rejects.toBeInstanceOf(SolidRedirectError);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("refuses a browser opaque redirect (type === 'opaqueredirect', status 0)", async () => {
    const opaque = { type: "opaqueredirect", status: 0, ok: false, headers: new Headers() };
    const inner = vi.fn(async () => opaque as unknown as Response);
    const scoped = createScopedFetch(BASE, inner as unknown as typeof fetch);
    await expect(scoped(`${BASE}foo`)).rejects.toBeInstanceOf(SolidRedirectError);
  });

  it("passes a 304 Not Modified through (3xx but not a redirect)", async () => {
    const inner = vi.fn(async () => new Response(null, { status: 304 }));
    const scoped = createScopedFetch(BASE, inner as unknown as typeof fetch);
    const res = await scoped(`${BASE}foo`);
    expect(res.status).toBe(304);
  });

  it("passes a 3xx WITHOUT a Location header through (not a redirect)", async () => {
    const inner = vi.fn(async () => new Response("choices", { status: 300 }));
    const scoped = createScopedFetch(BASE, inner as unknown as typeof fetch);
    const res = await scoped(`${BASE}foo`);
    expect(res.status).toBe(300);
  });
});
