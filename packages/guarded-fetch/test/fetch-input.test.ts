// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash } from "node:crypto";
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
          const effective = new Request(input, init);
          expect(effective.url).toBe(TARGET);
          expect(effective.redirect).toBe("manual");
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

const foreignRequests = {
  undici: (init?: RequestInit): Request =>
    new UndiciRequest(TARGET, init as never) as unknown as Request,
  "cross-realm": (init?: RequestInit): Request =>
    runInNewContext("new Request(target, init)", { Request: realm.Request, target: TARGET, init }),
};

for (const [implementation, makeRequest] of Object.entries(foreignRequests)) {
  for (const [wrapper, factory] of Object.entries(factories)) {
    describe(`${implementation} Request through ${wrapper}`, () => {
      it.each([
        "native",
        "undici",
      ])("preserves effective bodies and policies with a %s transport", async (transport) => {
        for (const override of [false, true]) {
          const agent = new MockAgent();
          agent.disableNetConnect();
          const body = override ? "override body" : "original body";
          const method = override ? "PUT" : "POST";
          agent
            .get("https://pod.example")
            .intercept({
              path: "/alice/item",
              method,
              headers: { "x-test": override ? "override" : "original" },
            })
            .reply(async ({ body: sentBody }) => {
              expect(await new Response(sentBody as BodyInit).text()).toBe(body);
              return { statusCode: 200, data: "ok" };
            });
          const integrity = `sha256-${createHash("sha256").update("ok").digest("base64")}`;
          const request = makeRequest({
            method: "POST",
            body: "original body",
            headers: { "x-test": "original" },
            credentials: "include",
            mode: "same-origin",
            cache: "no-store",
            redirect: "follow",
            referrer: `${BASE}referrer`,
            referrerPolicy: "no-referrer",
            integrity,
            keepalive: false,
          });
          const shadow = vi.fn(() => {
            throw new Error("own URL read");
          });
          Object.defineProperty(request, "url", { get: shadow });
          const inner = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            expect(input).toBe(TARGET);
            expect(Object.getPrototypeOf(init)).toBe(Object.prototype);
            expect(init?.headers).toBeInstanceOf(Headers);
            expect((init as RequestInit & { duplex: string }).duplex).toBe("half");
            const effective =
              transport === "native"
                ? new Request(input, init)
                : new UndiciRequest(input as never, init as never);
            expect(effective.url).toBe(TARGET);
            expect(effective.method).toBe(method);
            expect([...effective.headers]).toEqual([
              ["content-type", "text/plain;charset=UTF-8"],
              ["x-test", override ? "override" : "original"],
            ]);
            expect(effective.credentials).toBe(override ? "omit" : "include");
            expect(effective.mode).toBe(override ? "cors" : "same-origin");
            expect(effective.cache).toBe(override ? "reload" : "no-store");
            expect(effective.redirect).toBe("manual");
            // The foreign constructor applies Fetch's referrer reset when snapshotting.
            expect(effective.referrer).toBe(override ? `${BASE}override-referrer` : "about:client");
            expect(effective.referrerPolicy).toBe(override ? "origin" : "");
            expect(effective.integrity).toBe(integrity);
            expect(effective.keepalive).toBe(false);
            expect(await effective.clone().text()).toBe(body);
            return transport === "native"
              ? new Response("ok")
              : ((await undiciFetch(effective as never, {
                  dispatcher: agent,
                })) as unknown as Response);
          });
          try {
            const res = await factory(inner)(
              request,
              override
                ? {
                    method,
                    body,
                    headers: { "x-test": "override" },
                    credentials: "omit",
                    mode: "cors",
                    cache: "reload",
                    redirect: "follow",
                    referrer: `${BASE}override-referrer`,
                    referrerPolicy: "origin",
                  }
                : undefined,
            );
            expect(await res.text()).toBe("ok");
            expect(inner).toHaveBeenCalledOnce();
            expect(shadow).not.toHaveBeenCalled();
            if (transport === "undici") agent.assertNoPendingInterceptors();
          } finally {
            await agent.close();
          }
        }
      });

      it("carries streamed bodies and effective abort signals to a native Request", async () => {
        const original = new AbortController();
        const override = new AbortController();
        const request = makeRequest({
          method: "PUT",
          signal: original.signal,
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
          original.abort();
          expect(effective.signal.aborted).toBe(false);
          override.abort();
          expect(effective.signal.aborted).toBe(true);
          return new Response();
        });
        await factory(inner)(request, { signal: override.signal });
        expect(inner).toHaveBeenCalledOnce();
      });

      it("preserves keepalive on a bodyless request and an explicit null body override", async () => {
        const inner = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const effective = new Request(input, init);
          expect(effective.keepalive).toBe(true);
          expect(effective.body).toBeNull();
          expect(effective.method).toBe("HEAD");
          return new Response();
        });
        await factory(inner)(makeRequest({ method: "HEAD", keepalive: true }), { body: null });
        expect(inner).toHaveBeenCalledOnce();
      });
    });
  }
}

it("reads every foreign snapshot field through prototype getters and copies its headers", () => {
  const shadow = vi.fn(() => {
    throw new Error("own snapshot property read");
  });
  class ShadowedRequest extends UndiciRequest {
    constructor(input: ConstructorParameters<typeof UndiciRequest>[0], init?: RequestInit) {
      super(input, init as never);
      for (const field of [
        "url",
        "method",
        "headers",
        "body",
        "signal",
        "credentials",
        "mode",
        "cache",
        "redirect",
        "referrer",
        "referrerPolicy",
        "integrity",
        "keepalive",
        "constructor",
      ])
        Object.defineProperty(this, field, { get: shadow });
    }
  }
  const input = new ShadowedRequest(TARGET, { method: "HEAD", headers: { "x-test": "original" } });
  const snapshot = snapshotFetchInput(input as unknown as Request);
  expect(snapshot.input).toBe(TARGET);
  expect(snapshot.url).toBe(TARGET);
  expect(snapshot.init?.method).toBe("HEAD");
  expect(snapshot.init?.body).toBeNull();
  expect(snapshot.init?.credentials).toBe("same-origin");
  expect(snapshot.init?.mode).toBe("cors");
  expect(snapshot.init?.cache).toBe("default");
  expect(snapshot.init?.redirect).toBe("follow");
  expect(snapshot.init?.referrer).toBe("about:client");
  expect(snapshot.init?.referrerPolicy).toBe("");
  expect(snapshot.init?.integrity).toBe("");
  expect(snapshot.init?.keepalive).toBe(false);
  expect(snapshot.init?.signal).toBeInstanceOf(AbortSignal);
  expect(snapshot.init).not.toHaveProperty("duplex");
  const headers = snapshot.init?.headers as Headers;
  expect(Object.getPrototypeOf(headers)).toBe(Headers.prototype);
  headers.set("x-test", "changed");
  expect(Reflect.get(UndiciRequest.prototype, "headers", input).get("x-test")).toBe("original");
  expect(shadow).not.toHaveBeenCalled();
});

it("omits foreign fields with absent or undefined prototype getters, ignoring own values", () => {
  class OtherRequest {
    get url() {
      return TARGET;
    }
    get method() {
      return undefined;
    }
    get cache() {
      return undefined;
    }
    constructor() {
      Object.defineProperty(this, "headers", {
        get() {
          throw new Error("own headers read");
        },
      });
      Object.defineProperty(this, "method", { value: "DELETE" });
    }
  }
  Object.defineProperty(OtherRequest.prototype, "keepalive", { value: true });
  expect(snapshotFetchInput(new OtherRequest() as unknown as Request)).toEqual({
    input: TARGET,
    url: TARGET,
    init: {},
  });
});

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
      headers: { "x-test": "preserved" },
    })
    .reply(async ({ body }) => {
      expect(await new Response(body as BodyInit).text()).toBe("override body");
      return { statusCode: 200, data: "ok" };
    });
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
