// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { createGuardedFetch, createPodScopedFetch, refuseRedirects } from "../src/index.js";

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
    ])("preserves body, policies and abort propagation (init override %s)", async (override) => {
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
        expect(effective.mode).toBe("same-origin");
        expect(effective.cache).toBe(override ? "reload" : "no-store");
        expect(effective.integrity).toBe("sha256-fixture");
        // The refusing wrapper forwards the native snapshot; the URL+init wrappers cannot
        // pair keepalive with the stream body they hand to the transport.
        expect(effective.keepalive).toBe(name === "refusal");
        expect(effective.referrer).toBe(`${BASE}referrer`);
        expect(effective.referrerPolicy).toBe(override ? "origin" : "no-referrer");
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
              cache: "reload",
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
