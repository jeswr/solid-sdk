// AUTHORED-BY Codex GPT-6.1-Sol
import { Request as UndiciRequest } from "undici";
import { describe, expect, it, vi } from "vitest";
import {
  createGuardedFetch,
  createPodScopedFetch,
  refuseRedirects,
  snapshotFetchInput,
} from "../src/index.js";
import { normalizeRequest } from "../src/redirect.js";

const BASE = "https://pod.example/alice/";
const TARGET = `${BASE}item`;
const implementations = {
  native: (input: RequestInfo | URL, init?: RequestInit): Request => new Request(input, init),
  undici: (input: RequestInfo | URL, init?: RequestInit): Request =>
    new UndiciRequest(input as never, init as never) as unknown as Request,
};
const wrappers = {
  scope: (fetch: typeof globalThis.fetch) => createPodScopedFetch(BASE, { fetch }),
  ssrf: (fetch: typeof globalThis.fetch) =>
    createGuardedFetch({ fetch, dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }] }),
  refusal: (fetch: typeof globalThis.fetch) => refuseRedirects(fetch),
  snapshot:
    (fetch: typeof globalThis.fetch): typeof globalThis.fetch =>
    async (input, init) => {
      const snapshot = snapshotFetchInput(input, init);
      return fetch(snapshot.input, snapshot.init);
    },
};

for (const [implementation, construct] of Object.entries(implementations)) {
  for (const [name, wrap] of Object.entries(wrappers)) {
    describe(`${name}: ${implementation} replacement bodies`, () => {
      it.each([
        "fresh",
        "consumed",
        "locked",
      ])("reuses a %s POST Request twice without touching its discarded body", async (state) => {
        const input = construct(TARGET, {
          method: "POST",
          body: "original",
          headers: { "x-test": "preserved" },
        });
        if (state === "consumed") await input.text();
        const reader = state === "locked" ? input.body?.getReader() : undefined;
        const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = construct(input, init);
          expect(request.url).toBe(TARGET);
          expect(request.method).toBe("POST");
          expect(request.headers.get("x-test")).toBe("preserved");
          expect(await request.text()).toBe("x");
          return new Response("ok");
        });
        const fetch = wrap(transport);
        try {
          for (let call = 0; call < 2; call += 1) {
            expect(await (await fetch(input, { body: "x" })).text()).toBe("ok");
            expect(input.bodyUsed).toBe(state === "consumed");
            expect(input.body?.locked).toBe(state !== "fresh");
          }
          expect(transport).toHaveBeenCalledTimes(2);
        } finally {
          reader?.releaseLock();
        }
        if (state !== "consumed") expect(await input.text()).toBe("original");
      });

      for (const method of ["GET", "HEAD"]) {
        it.each([
          undefined,
          "POST",
        ])(`matches main for a ${method} Request and replacement body (init method %s)`, async (override) => {
          const input = construct(TARGET, { method });
          const init = { ...(override ? { method: override } : {}), body: "x" };
          const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const request = construct(input, init);
            expect(request.method).toBe("POST");
            expect(await request.text()).toBe("x");
            return new Response("ok");
          });
          // Main's effective GET/HEAD with a body rejects; an explicit POST succeeds.
          if (override) {
            expect(await (await wrap(transport)(input, init)).text()).toBe("ok");
            expect(transport).toHaveBeenCalledOnce();
          } else {
            await expect(wrap(transport)(input, init)).rejects.toThrow();
          }
          expect(input.bodyUsed).toBe(false);
        });
      }
    });
  }

  it.each([
    undefined,
    null,
  ])(`${implementation}: retains body transfer when init.body is %s`, async (body) => {
    const input = construct(TARGET, { method: "POST", body: "original" });
    const normalized = normalizeRequest(input, { body });
    expect(input.bodyUsed).toBe(true);
    expect(normalized.init).toHaveProperty("duplex", "half");
    if (body === null) expect(normalized.init?.body).toBeNull();
  });

  it(`${implementation}: snapshots metadata without reading shadowed fields or inheriting placeholder body/duplex`, async () => {
    const input = construct(TARGET, { method: "POST" });
    const shadow = vi.fn(() => {
      throw new Error("caller property read");
    });
    for (const field of ["url", "method", "headers", "body", "duplex", "constructor"]) {
      Object.defineProperty(input, field, { get: shadow });
    }
    const body = new FormData();
    body.set("message", "payload");
    const normalized = normalizeRequest(input, { body });
    expect(normalized.url).toBe(TARGET);
    expect(normalized.init?.body).toBe(body);
    expect(normalized.init).not.toHaveProperty("duplex");
    expect(new Headers(normalized.init?.headers).has("content-type")).toBe(false);
    expect(shadow).not.toHaveBeenCalled();
    const request = new Request(normalized.url, normalized.init);
    expect([...(await request.formData()).entries()]).toEqual([["message", "payload"]]);
  });

  it(`${implementation}: leaves a replacement stream untouched until transport`, async () => {
    const input = construct(TARGET, { method: "POST", body: "original" });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("stream"));
        controller.close();
      },
    });
    const normalized = normalizeRequest(input, { body, duplex: "half" } as RequestInit);
    expect(normalized.init?.body).toBe(body);
    expect(body.locked).toBe(false);
    expect(input.bodyUsed).toBe(false);
    expect(await new Request(normalized.url, normalized.init).text()).toBe("stream");
    expect(await input.text()).toBe("original");
  });

  it.each([
    "POST",
    "GET",
    "HEAD",
  ])(`${implementation}: keeps an empty replacement for effective method %s without using the input body`, async (method) => {
    const input = construct(TARGET, { method: "POST", body: "original" });
    const normalized = normalizeRequest(input, { method, body: "" });
    expect(normalized.init?.body).toBe("");
    expect(normalized.init).not.toHaveProperty("duplex");
    expect(input.bodyUsed).toBe(false);
    if (method === "POST") {
      expect(await new Request(normalized.url, normalized.init).text()).toBe("");
    } else {
      expect(() => new Request(normalized.url, normalized.init)).toThrow(TypeError);
    }
    expect(await input.text()).toBe("original");
  });
}
