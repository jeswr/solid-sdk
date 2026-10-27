// AUTHORED-BY Codex GPT-6.1-Sol
import { RedirectRefusedError, refuseRedirects } from "@jeswr/guarded-fetch";
import { describe, expect, it, vi } from "vitest";
import { SolidRedirectError } from "../src/index.js";
import { createSameOriginRedirectRefusingFetch, createScopedFetch } from "../src/scope.js";

const BASE = "https://pod.example/alice/";
const TARGET = `${BASE}item`;
const ORIGIN = new URL(BASE).origin;

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

    it("keeps Request fields and overrides caller redirect:follow", async () => {
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
        expect(input).not.toBe(request);
        const effective = new Request(input, init);
        expect(effective.method).toBe("POST");
        expect(await effective.text()).toBe("private fixture body");
        expect(effective.headers.get("authorization")).toBe("Bearer fixture-token");
        expect(effective.mode).toBe("same-origin");
        expect(effective.integrity).toBe("sha256-fixture");
        expect(effective.credentials).toBe("include");
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

    it("preserves body, policy fields, and effective init overrides", async () => {
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
      await factory(inner)(request, {
        method: "PUT",
        body: "override body",
        referrerPolicy: "origin",
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
