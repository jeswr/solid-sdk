// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { RedirectRefusedError, refuseRedirects } from "@jeswr/guarded-fetch";
import { describe, expect, it, vi } from "vitest";
import { SolidRedirectError } from "../src/index.js";
import { createSameOriginRedirectRefusingFetch, createScopedFetch } from "../src/scope.js";

const BASE = "https://pod.example/alice/";
const TARGET = `${BASE}item`;
const ORIGIN = new URL(BASE).origin;
// Exercise the installed transport dependency without adding an unstorage dependency.
const {
  Request: UndiciRequest,
  fetch: undiciFetch,
  MockAgent,
} = createRequire(new URL("../node_modules/@jeswr/guarded-fetch/dist/node.js", import.meta.url))(
  "undici",
);

// Frozen bfa358b8 response predicate: every readable 3xx with Location except 304.
function legacyRefuses(res: Response): boolean {
  return (
    res.type === "opaqueredirect" ||
    (res.status >= 300 && res.status < 400 && res.status !== 304 && res.headers.has("location"))
  );
}

const factories = {
  shared: (inner: typeof fetch) => refuseRedirects(inner),
  data: (inner: typeof fetch) => createScopedFetch(BASE, inner),
  watch: (inner: typeof fetch) => createSameOriginRedirectRefusingFetch(ORIGIN, inner),
};

for (const [name, factory] of Object.entries(factories)) {
  describe(`${name}: redirect differential`, () => {
    for (const location of [undefined, "", "https://evil.example/steal"]) {
      it.each(
        Array.from({ length: 102 }, (_, i) => 299 + i),
      )(`never passes a legacy refusal: status %d, Location=${location}`, async (status) => {
        const headers = location === undefined ? {} : { location };
        const res = new Response(null, { status, headers });
        const inner = vi.fn(async () => res);
        const wrapped = factory(inner);
        if (legacyRefuses(res) || [301, 302, 303, 307, 308].includes(status)) {
          await expect(wrapped(TARGET)).rejects.toBeInstanceOf(RedirectRefusedError);
          expect(res.bodyUsed).toBe(false);
        } else {
          expect(await wrapped(TARGET)).toBe(res);
        }
        expect(inner).toHaveBeenCalledExactlyOnceWith(TARGET, { redirect: "manual" });
      });
    }
  });
}

for (const [name, factory] of Object.entries(factories).filter(([name]) => name !== "shared")) {
  describe(`${name}: shared refusal integration`, () => {
    it("retains public instanceof identity, cancels the body, and redacts Location userinfo", async () => {
      const cancel = vi.fn();
      const res = new Response(new ReadableStream({ cancel }), {
        status: 302,
        headers: { location: "https://fixture-user:fixture-pass@evil.example/steal" },
      });
      const inner = vi.fn(async () => res);
      const error = await factory(inner)(TARGET).catch((error: unknown) => error);
      expect(SolidRedirectError).toBe(RedirectRefusedError);
      expect(error).toBeInstanceOf(SolidRedirectError);
      expect(error).toMatchObject({ url: TARGET, status: 302 });
      expect(String(error)).not.toContain("fixture-pass");
      expect(String(error)).not.toContain("fixture-user");
      expect(cancel).toHaveBeenCalledOnce();
      expect(inner).toHaveBeenCalledOnce();
    });

    it("matches main's explicit-init-only forwarding for Request inputs", async () => {
      const request = new Request(TARGET, {
        method: "POST",
        body: "private fixture body",
        headers: { authorization: "Bearer fixture-token" },
        mode: "same-origin",
        credentials: "include",
        integrity: "sha256-fixture",
        redirect: "follow",
      });
      const inner = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe(TARGET);
        expect(init).toEqual({ redirect: "manual" });
        const effective = new Request(input, init);
        expect(effective.method).toBe("GET");
        expect(await effective.text()).toBe("");
        expect(effective.headers.get("authorization")).toBeNull();
        expect(effective.mode).toBe("cors");
        expect(effective.integrity).toBe("");
        expect(effective.credentials).toBe("same-origin");
        expect(effective.redirect).toBe("manual");
        return new Response(null, { status: 204 });
      });
      await factory(inner)(request, { redirect: "follow" });
      expect(inner).toHaveBeenCalledOnce();
    });

    it.each([
      "https://evil.example/steal",
      "https://pod.example/outside",
    ])("validates the internal Request target despite a shadowed url: %s", async (target) => {
      const request = new Request(target);
      Object.defineProperty(request, "url", { get: () => TARGET });
      const inner = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Request(input, init).url).toBe(target);
        return new Response();
      });
      if (name === "watch" && target.startsWith(ORIGIN)) {
        await factory(inner)(request);
        expect(inner).toHaveBeenCalledOnce();
      } else {
        await expect(factory(inner)(request)).rejects.toThrow();
        expect(inner).not.toHaveBeenCalled();
      }
    });

    it("preserves every explicit body, signal, and policy field exactly as on main", async () => {
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
      });
      const inner = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe(TARGET);
        expect(init).toEqual({ ...explicit, redirect: "manual" });
        const effective = new Request(input, init);
        expect(effective.url).toBe(TARGET);
        expect(effective.method).toBe("PUT");
        expect(await effective.text()).toBe("override body");
        expect(effective.headers.get("authorization")).toBe("Bearer fixture");
        expect(effective.credentials).toBe("include");
        expect(effective.mode).toBe("same-origin");
        expect(effective.cache).toBe("no-store");
        expect(effective.integrity).toBe("sha256-fixture");
        expect(effective.keepalive).toBe(true);
        expect(effective.referrer).toBe(`${BASE}referrer`);
        expect(effective.referrerPolicy).toBe("origin");
        expect(effective.redirect).toBe("manual");
        controller.abort();
        expect(effective.signal.aborted).toBe(true);
        return new Response();
      });
      const explicit: RequestInit = {
        method: "PUT",
        body: "override body",
        headers: { authorization: "Bearer fixture" },
        signal: controller.signal,
        credentials: "include",
        mode: "same-origin",
        cache: "no-store",
        integrity: "sha256-fixture",
        keepalive: true,
        referrer: `${BASE}referrer`,
        referrerPolicy: "origin",
        redirect: "follow",
      };
      await factory(inner)(request, explicit);
    });

    for (const [implementation, Ctor] of [
      ["native", Request],
      ["undici", UndiciRequest],
    ] as const) {
      it.each([
        "fresh",
        "consumed",
        "locked",
      ])(`reuses a %s ${implementation} POST Request twice with an explicit body`, async (state) => {
        const request = new Ctor(TARGET, { method: "POST", body: "original" });
        if (state === "consumed") await request.text();
        const reader = state === "locked" ? request.body?.getReader() : undefined;
        const explicit = { method: "PUT", body: "x" };
        const inner = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          expect(input).toBe(TARGET);
          expect(init).toEqual({ ...explicit, redirect: "manual" });
          expect(await new Request(input, init).text()).toBe("x");
          return new Response("ok");
        });
        const fetch = factory(inner);
        try {
          for (let call = 0; call < 2; call += 1) {
            expect(await (await fetch(request, explicit)).text()).toBe("ok");
            expect(request.bodyUsed).toBe(state === "consumed");
            expect(request.body?.locked).toBe(state !== "fresh");
          }
          expect(inner).toHaveBeenCalledTimes(2);
        } finally {
          reader?.releaseLock();
        }
        if (state !== "consumed") expect(await request.text()).toBe("original");
      });

      for (const method of ["GET", "HEAD"]) {
        it.each([
          undefined,
          "POST",
        ])(`matches main for a ${implementation} ${method} input with an init body (init method %s)`, async (override) => {
          const input = new Ctor(TARGET, { method });
          const explicit = { ...(override ? { method: override } : {}), body: "x" };
          const inner = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            expect(input).toBe(TARGET);
            expect(init).toEqual({ ...explicit, redirect: "manual" });
            const request = new Request(input, init);
            expect(request.method).toBe("POST");
            expect(await request.text()).toBe("x");
            return new Response("ok");
          });
          if (override) {
            expect(await (await factory(inner)(input, explicit)).text()).toBe("ok");
          } else {
            await expect(factory(inner)(input, explicit)).rejects.toThrow(TypeError);
          }
          expect(inner).toHaveBeenCalledOnce();
          expect(input.bodyUsed).toBe(false);
        });
      }
    }

    for (const [pair, RequestImpl, fetchImpl] of [
      ["undici Request + native fetch", UndiciRequest, globalThis.fetch],
      ["native Request + undici fetch", Request, undiciFetch],
    ] as const) {
      it.each([false, true])(`accepts ${pair} (explicit init %s)`, async (withInit) => {
        const agent = new MockAgent();
        agent.disableNetConnect();
        agent
          .get(ORIGIN)
          .intercept({
            path: "/alice/item",
            method: withInit ? "PUT" : "GET",
            ...(withInit ? { body: "override body", headers: { "x-test": "preserved" } } : {}),
          })
          .reply(200, "ok");
        // Node's bundled undici uses the older dispatcher callbacks. Feed its actual
        // fetch a consuming dispatcher rather than the installed undici 8 MockAgent.
        const nativeDispatcher = {
          dispatch(
            options: { method: string; path: string; body?: AsyncIterable<Uint8Array> },
            handler: {
              onConnect(abort: () => void): void;
              onHeaders(status: number, headers: string[], resume: () => void, text: string): void;
              onData(chunk: Uint8Array): void;
              onComplete(trailers: string[]): void;
              onError(error: Error): void;
            },
          ) {
            handler.onConnect(() => {});
            void (async () => {
              expect(options.path).toBe("/alice/item");
              expect(options.method).toBe(withInit ? "PUT" : "GET");
              const chunks: Uint8Array[] = [];
              for await (const chunk of options.body ?? []) chunks.push(chunk);
              expect(Buffer.concat(chunks).toString()).toBe(withInit ? "override body" : "");
              handler.onHeaders(200, [], () => {}, "OK");
              handler.onData(Buffer.from("ok"));
              handler.onComplete([]);
            })().catch((error: Error) => handler.onError(error));
            return true;
          },
        };
        const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          expect(input).toBe(TARGET);
          return fetchImpl(input, {
            ...init,
            dispatcher: fetchImpl === globalThis.fetch ? nativeDispatcher : agent,
          });
        });
        const request = new RequestImpl(TARGET, { method: "POST", body: "ignored on main" });
        try {
          const response = await factory(transport)(
            request,
            withInit
              ? {
                  method: "PUT",
                  body: "override body",
                  headers: { "x-test": "preserved" },
                  redirect: "follow",
                }
              : undefined,
          );
          expect(await response.text()).toBe("ok");
          expect(transport).toHaveBeenCalledOnce();
          if (fetchImpl !== globalThis.fetch) agent.assertNoPendingInterceptors();
        } finally {
          await agent.close();
        }
      });
    }

    it.each([
      TARGET,
      "https://POD.example:443/alice/./item",
      new URL(TARGET),
    ])("matches main's URL string plus explicit init for %s", async (input) => {
      const explicit = { method: "HEAD", headers: { authorization: "Bearer fixture" } };
      const inner = vi.fn(async () => new Response());
      await factory(inner)(input, explicit);
      expect(inner).toHaveBeenCalledExactlyOnceWith(String(input), {
        ...explicit,
        redirect: "manual",
      });
    });

    it("snapshots mutable URL inputs before an authenticated fetch can await", async () => {
      const target = new URL(TARGET);
      const inner = vi.fn(async (input: RequestInfo | URL) => {
        await Promise.resolve();
        expect(input).toBe(TARGET);
        return new Response(null, { status: 204 });
      });
      const pending = factory(inner)(target);
      target.href = "https://evil.example/steal";
      await pending;
      expect(inner).toHaveBeenCalledOnce();
    });

    it("still refuses opaque browser redirects", async () => {
      const inner = vi.fn(async () => ({ type: "opaqueredirect", status: 0 }) as Response);
      await expect(factory(inner)(TARGET)).rejects.toBeInstanceOf(SolidRedirectError);
      expect(inner).toHaveBeenCalledOnce();
    });

    it.each([
      "https://evil.example/alice/item",
      "https://fixture-user:fixture-pass@pod.example/alice/item",
      "https://pod.example/alice/..%2fsecret",
      "https://pod.example/alice/..%5Csecret",
      "file:///alice/item",
      "item",
      "http://",
    ])("rejects an invalid or foreign target before fetching: %s", async (url) => {
      const inner = vi.fn(async () => new Response());
      await expect(factory(inner)(url)).rejects.toThrow();
      expect(inner).not.toHaveBeenCalled();
    });
  });
}
