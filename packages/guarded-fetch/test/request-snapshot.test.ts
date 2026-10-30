// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { createGuardedFetch, createPodScopedFetch, refuseRedirects } from "../src/index.js";
import { normalizeRequest } from "../src/redirect.js";

const BASE = "https://pod.example/alice/";
const TARGET = `${BASE}item`;
const factories = {
  refusal: (fetch: typeof globalThis.fetch) => refuseRedirects(fetch),
  scope: (fetch: typeof globalThis.fetch) => createPodScopedFetch(BASE, { fetch }),
  ssrf: (fetch: typeof globalThis.fetch) =>
    createGuardedFetch({ fetch, dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }] }),
};

for (const [name, factory] of Object.entries(factories)) {
  describe(`${name}: native request snapshots`, () => {
    it("uses the internal URL even when the caller shadows url", async () => {
      const request = new Request("https://foreign.example/steal");
      Object.defineProperty(request, "url", { get: () => TARGET });
      const inner = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Request(input, init).url).toBe("https://foreign.example/steal");
        return new Response();
      });
      if (name === "scope") {
        await expect(factory(inner)(request)).rejects.toThrow(/escapes pod/);
        expect(inner).not.toHaveBeenCalled();
      } else {
        await factory(inner)(request);
        expect(inner).toHaveBeenCalledOnce();
      }
    });

    it("snapshots a mutable URL before the transport awaits", async () => {
      const url = new URL(TARGET);
      const inner = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        await Promise.resolve();
        expect(new Request(input, init).url).toBe(TARGET);
        return new Response();
      });
      const pending = factory(inner)(url);
      url.href = "https://foreign.example/steal";
      await pending;
    });

    it.each([
      false,
      true,
    ])("matches main's inherited fields and explicit overrides (init override %s)", async (override) => {
      const controller = new AbortController();
      const request = new Request(TARGET, {
        method: "POST",
        body: "private body",
        headers: { authorization: "Bearer fixture" },
        signal: controller.signal,
        credentials: "include",
        mode: "same-origin",
        cache: "no-store",
        integrity: "sha256-fixture",
        keepalive: true,
        referrer: `${BASE}referrer`,
        referrerPolicy: "no-referrer",
        redirect: "follow",
      });
      const inner = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const effective = new Request(input, init);
        expect(effective.url).toBe(TARGET);
        expect(effective.method).toBe(override ? "PUT" : "POST");
        expect(effective.headers.get("authorization")).toBe("Bearer fixture");
        expect(effective.credentials).toBe("include");
        // Main inherits these policies only in refuseRedirects, which forwards a Request.
        // The URL+init guards carry them only when explicitly supplied in init.
        const inheritsPolicies = name === "refusal";
        expect(effective.mode).toBe(override || inheritsPolicies ? "same-origin" : "cors");
        expect(effective.cache).toBe(
          override ? "reload" : inheritsPolicies ? "no-store" : "default",
        );
        expect(effective.integrity).toBe(override || inheritsPolicies ? "sha256-fixture" : "");
        expect(effective.keepalive).toBe(override || inheritsPolicies);
        // Fetch resets referrer fields when a Request is combined with a non-empty init, as
        // main's refuseRedirects did with its { ...init, redirect: "manual" }.
        expect(effective.referrer).toBe(override ? `${BASE}referrer` : "about:client");
        expect(effective.referrerPolicy).toBe(override ? "origin" : "");
        expect(effective.redirect).toBe("manual");
        expect(await effective.text()).toBe(override ? "override body" : "private body");
        controller.abort();
        expect(effective.signal.aborted).toBe(true);
        return new Response();
      });
      await factory(inner)(
        request,
        override
          ? {
              method: "PUT",
              body: "override body",
              mode: "same-origin",
              cache: "reload",
              integrity: "sha256-fixture",
              keepalive: true,
              referrer: `${BASE}referrer`,
              referrerPolicy: "origin",
              redirect: "follow",
            }
          : undefined,
      );
    });

    it("preserves streamed bodies and duplex", async () => {
      const request = new Request(TARGET, {
        method: "PUT",
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("stream"));
            controller.close();
          },
        }),
        duplex: "half",
      } as RequestInit);
      const inner = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const effective = new Request(input, init);
        expect(await effective.text()).toBe("stream");
        expect((effective as Request & { duplex: string }).duplex).toBe("half");
        return new Response();
      });
      await factory(inner)(request);
    });
  });
}

it("SSRF-checks the internal target before transport", async () => {
  const request = new Request("https://127.0.0.1/steal");
  Object.defineProperty(request, "url", { value: TARGET });
  const inner = vi.fn(async () => new Response());
  await expect(factories.ssrf(inner)(request)).rejects.toThrow();
  expect(inner).not.toHaveBeenCalled();
});

it.each([false, true])("inherits exactly main's init keys (Request body %s)", async (withBody) => {
  const controller = new AbortController();
  const request = new Request(TARGET, {
    method: withBody ? "POST" : "GET",
    ...(withBody ? { body: "payload" } : {}),
    headers: { "x-test": "original" },
    signal: controller.signal,
    mode: "same-origin",
    cache: "no-store",
    integrity: "sha256-fixture",
    keepalive: true,
    referrer: `${BASE}referrer`,
    referrerPolicy: "no-referrer",
  });
  const shadow = vi.fn(() => {
    throw new Error("caller property read");
  });
  for (const field of ["url", "method", "headers", "credentials", "redirect", "signal", "body"]) {
    Object.defineProperty(request, field, { get: shadow });
  }
  const normalized = normalizeRequest(request, undefined);
  expect(normalized.url).toBe(TARGET);
  expect(Object.keys(normalized.init ?? {}).sort()).toEqual(
    [
      "method",
      "headers",
      "credentials",
      "redirect",
      "signal",
      ...(withBody ? ["body", "duplex"] : []),
    ].sort(),
  );
  expect(shadow).not.toHaveBeenCalled();
  Reflect.get(Request.prototype, "headers", request).set("x-test", "mutated");
  expect(new Headers(normalized.init?.headers).get("x-test")).toBe("original");
  if (withBody) expect(await new Request(TARGET, normalized.init).text()).toBe("payload");
  controller.abort();
  expect(normalized.init?.signal?.aborted).toBe(true);
});

it("overlays the explicit init after snapshotting without adding generated body headers", () => {
  const form = new FormData();
  form.set("message", "payload");
  const init = { method: "POST", body: form, cache: "reload" } as const;
  const normalized = normalizeRequest(new Request(TARGET), init);
  expect(normalized.init?.body).toBe(form);
  expect(normalized.init?.cache).toBe("reload");
  expect(new Headers(normalized.init?.headers).has("content-type")).toBe(false);
  expect(normalized.init).not.toHaveProperty("duplex");
});
