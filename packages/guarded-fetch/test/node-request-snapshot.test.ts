// AUTHORED-BY Codex GPT-6.1-Sol
import { beforeEach, expect, it, vi } from "vitest";

const { transport } = vi.hoisted(() => ({ transport: vi.fn() }));
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: async (input: string, init: RequestInit) => {
      // Exercise the installed undici Request constructor, whose brand differs
      // from Node's global Request, without opening a socket.
      const request = new actual.Request(input, init as never);
      transport(request);
      return new Response(await request.text());
    },
  };
});

import { createNodeGuardedFetch } from "../src/node.js";

beforeEach(() => {
  transport.mockClear();
});

it.each([
  false,
  true,
])("adapts a native Request to undici with policies and body (keepalive %s)", async (keepalive) => {
  const controller = new AbortController();
  const request = new Request("https://pod.example/item", {
    method: "POST",
    body: "private body",
    headers: { authorization: "Bearer fixture" },
    credentials: "include",
    mode: "same-origin",
    cache: "no-store",
    integrity: "sha256-fixture",
    keepalive,
    referrer: "https://pod.example/referrer",
    referrerPolicy: "no-referrer",
    signal: controller.signal,
  });
  Object.defineProperty(request, "url", { value: "https://foreign.example/shadow" });
  const fetch = createNodeGuardedFetch({
    resolveAll: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  const response = await fetch(request);
  expect(await response.text()).toBe("private body");
  expect(transport).toHaveBeenCalledOnce();
  const effective = transport.mock.calls[0]?.[0];
  expect(effective.url).toBe("https://pod.example/item");
  expect(effective.method).toBe("POST");
  expect(effective.headers.get("authorization")).toBe("Bearer fixture");
  expect(effective.credentials).toBe("include");
  expect(effective.mode).toBe("same-origin");
  expect(effective.cache).toBe("no-store");
  expect(effective.integrity).toBe("sha256-fixture");
  expect(effective.keepalive).toBe(keepalive);
  expect(effective.referrer).toBe("https://pod.example/referrer");
  expect(effective.referrerPolicy).toBe("no-referrer");
  expect(effective.redirect).toBe("manual");
});

it("refuses a shadowed native Request to a private IP before the undici transport", async () => {
  const request = new Request("https://127.0.0.1/steal");
  Object.defineProperty(request, "url", { value: "https://pod.example/item" });
  await expect(createNodeGuardedFetch()(request)).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});
