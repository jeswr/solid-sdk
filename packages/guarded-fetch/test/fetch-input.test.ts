// AUTHORED-BY Codex GPT-6.1-Sol
import { runInNewContext } from "node:vm";
import { MockAgent, Request as UndiciRequest, fetch as undiciFetch } from "undici";
import { describe, expect, it, vi } from "vitest";
import {
  createGuardedFetch,
  createPodScopedFetch,
  refuseRedirects,
  snapshotFetchInput,
} from "../src/index.js";

const BASE = "https://pod.example/alice/";
const TARGET = `${BASE}item`;

// Node vm contexts have no URL/Request globals. Install realm-local implementations
// backed by the platform parsers, with distinct prototypes and Request brands.
const realm = runInNewContext(
  `({
    URL: class URL {
      #value;
      constructor(value) { this.#value = new NativeURL(value); }
      get href() { return this.#value.href; }
      set href(value) { this.#value.href = value; }
      toString() { return this.href; }
    },
    Request: class Request extends OtherRequest {}
  })`,
  { NativeURL: URL, OtherRequest: UndiciRequest },
);

const inputs = {
  "cross-realm URL": (url: string): URL =>
    runInNewContext("new URL(target)", { URL: realm.URL, target: url }),
  "cross-realm Request": (url: string): Request =>
    runInNewContext("new Request(target)", { Request: realm.Request, target: url }),
  "undici Request": (url: string): Request => new UndiciRequest(url) as unknown as Request,
};
const factories = {
  refusal: (fetch: typeof globalThis.fetch) => refuseRedirects(fetch),
  scope: (fetch: typeof globalThis.fetch) => createPodScopedFetch(BASE, { fetch }),
  ssrf: (fetch: typeof globalThis.fetch) =>
    createGuardedFetch({ fetch, dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }] }),
};

for (const [name, makeInput] of Object.entries(inputs)) {
  describe(name, () => {
    it("captures a distinct request or string with the real target", () => {
      const input = makeInput(TARGET);
      expect(input).not.toBeInstanceOf(Request);
      expect(input).not.toBeInstanceOf(URL);
      const snapshot = snapshotFetchInput(input);
      expect(snapshot.input).not.toBe(input);
      expect(snapshot.url).toBe(TARGET);
      if (typeof snapshot.input === "string") expect(snapshot.input).toBe(TARGET);
      else expect(snapshot.input.url).toBe(TARGET);
    });

    for (const [name, factory] of Object.entries(factories)) {
      it(`succeeds through ${name} with the captured target`, async () => {
        const input = makeInput(TARGET);
        const inner = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          expect(typeof input === "string" ? input : (input as Request).url).toBe(TARGET);
          expect(init?.redirect).toBe("manual");
          return new Response("ok");
        });
        expect(await (await factory(inner)(input)).text()).toBe("ok");
        expect(inner).toHaveBeenCalledOnce();
      });
    }

    it("validates the real target before scope/SSRF transports run", async () => {
      for (const [factory, target] of [
        [factories.scope, "https://foreign.example/steal"],
        [factories.ssrf, "https://127.0.0.1/steal"],
      ] as const) {
        const inner = vi.fn(async () => new Response());
        const input = makeInput(target);
        if (!(input instanceof realm.URL)) {
          Object.defineProperty(input, "url", { get: () => TARGET });
        }
        await expect(factory(inner)(input)).rejects.toThrow();
        expect(inner).not.toHaveBeenCalled();
      }
    });
  });
}

it("ignores shadowed native URL href/toString properties", () => {
  const input = new URL(TARGET);
  const shadow = vi.fn(() => "https://foreign.example/steal");
  Object.defineProperty(input, "href", { get: shadow });
  Object.defineProperty(input, "toString", { value: shadow });
  expect(snapshotFetchInput(input)).toEqual({ input: TARGET, url: TARGET, init: undefined });
  expect(shadow).not.toHaveBeenCalled();
});

it("captures a cross-realm URL before a subsequent mutation", async () => {
  const input = inputs["cross-realm URL"](TARGET);
  const inner = vi.fn(async (input: RequestInfo | URL) => {
    await Promise.resolve();
    expect(input).toBe(TARGET);
    return new Response();
  });
  const pending = refuseRedirects(inner)(input);
  input.href = "https://foreign.example/steal";
  await pending;
});

it.each([Request, UndiciRequest])("ignores own Request url and constructor on %s", (Ctor) => {
  const input = new Ctor(TARGET);
  const shadow = vi.fn(() => {
    throw new Error("own property read");
  });
  Object.defineProperty(input, "url", { get: shadow });
  Object.defineProperty(input, "constructor", { get: shadow });
  expect(snapshotFetchInput(input as Request).url).toBe(TARGET);
  expect(shadow).not.toHaveBeenCalled();
});

it("supports undici.Request with refuseRedirects(undici.fetch), preserving body and init", async () => {
  const agent = new MockAgent();
  agent.disableNetConnect();
  agent
    .get("https://pod.example")
    .intercept({
      path: "/alice/item",
      method: "PUT",
      body: "override body",
      headers: { "x-test": "preserved" },
    })
    .reply(200, "ok");
  const fetch = refuseRedirects(((input, init) =>
    undiciFetch(
      input as never,
      { ...init, dispatcher: agent } as never,
    )) as typeof globalThis.fetch);
  const input = new UndiciRequest(TARGET, {
    method: "POST",
    body: "original body",
    headers: { "x-test": "preserved" },
  });
  Object.defineProperty(input, "url", { value: "https://foreign.example/shadow" });
  try {
    expect(
      await (
        await fetch(input as unknown as Request, {
          method: "PUT",
          body: "override body",
          redirect: "follow",
        })
      ).text(),
    ).toBe("ok");
    agent.assertNoPendingInterceptors();
  } finally {
    await agent.close();
  }
});

it.each(
  Object.entries(factories),
)("%s stringifies other inputs exactly once", async (_name, factory) => {
  const stringify = vi.fn().mockReturnValueOnce(TARGET).mockReturnValue("https://127.0.0.1/steal");
  const inner = vi.fn(async (input: RequestInfo | URL) => {
    await Promise.resolve();
    expect(input).toBe(TARGET);
    return new Response();
  });
  await factory(inner)({ toString: stringify } as unknown as URL);
  expect(stringify).toHaveBeenCalledOnce();
});

it.each([
  "missing getter",
  "throwing constructor",
  "throwing getter",
  "non-string getter",
])("falls back to one string conversion for a foreign object with %s", (failure) => {
  class OtherRequest {
    constructor() {
      if (failure === "throwing constructor") throw new Error("cannot snapshot");
    }
    get url(): unknown {
      if (failure === "throwing getter") throw new Error("cannot read URL");
      return undefined;
    }
  }
  if (failure === "missing getter") Reflect.deleteProperty(OtherRequest.prototype, "url");
  const input = Object.create(OtherRequest.prototype);
  const stringify = vi.fn(() => TARGET);
  Object.defineProperty(input, "toString", { value: stringify });
  const init = { method: "HEAD" };
  expect(snapshotFetchInput(input, init)).toEqual({ input: TARGET, url: TARGET, init });
  expect(stringify).toHaveBeenCalledOnce();
});

it("preserves strings as-is and rejects objects without a usable string conversion", () => {
  const input = "../relative?query#fragment";
  const init = { method: "HEAD" };
  expect(snapshotFetchInput(input, init)).toEqual({ input, url: input, init });
  expect(() => snapshotFetchInput(Object.create(null))).toThrow(TypeError);
});
