// AUTHORED-BY Codex GPT-6.1-Sol
import { FormData as UndiciFormData } from "undici";
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
      return (await transport(request)) ?? new Response(await request.text());
    },
  };
});

import { createNodeGuardedFetch } from "../src/node.js";

beforeEach(() => {
  transport.mockReset();
});

it.each([
  false,
  true,
])("adapts a native Request to undici with main's fields (keepalive %s)", async (keepalive) => {
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
  expect(effective.mode).toBe("cors");
  expect(effective.cache).toBe("default");
  expect(effective.integrity).toBe("");
  expect(effective.keepalive).toBe(false);
  expect(effective.referrer).toBe("about:client");
  expect(effective.referrerPolicy).toBe("");
  expect(effective.redirect).toBe("manual");
});

it("accepts a no-cors POST Request with main's URL-plus-init defaults", async () => {
  const fetch = createNodeGuardedFetch({
    resolveAll: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  const response = await fetch(
    new Request("https://pod.example/item", {
      method: "POST",
      mode: "no-cors",
      body: "payload",
    }),
  );
  expect(await response.text()).toBe("payload");
  expect(transport).toHaveBeenCalledOnce();
  expect(transport.mock.calls[0]?.[0].mode).toBe("cors");
});

it("replays a FormData override with matching boundaries after a consuming 307", async () => {
  const form = new UndiciFormData();
  form.set("message", "payload");
  transport.mockImplementation(async (request) => {
    expect(request.method).toBe("POST");
    expect(request.redirect).toBe("manual");
    expect([...(await request.formData()).entries()]).toEqual([["message", "payload"]]);
    return transport.mock.calls.length === 1
      ? new Response(null, { status: 307, headers: { location: "/next" } })
      : new Response("ok");
  });
  const fetch = createNodeGuardedFetch({
    resolveAll: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  const response = await fetch(new Request("https://pod.example/item"), {
    method: "POST",
    body: form as unknown as BodyInit,
  });
  expect(await response.text()).toBe("ok");
  expect(transport).toHaveBeenCalledTimes(2);
  expect(transport.mock.calls.map(([request]) => request.url)).toEqual([
    "https://pod.example/item",
    "https://pod.example/next",
  ]);
});

it("refuses a shadowed native Request to a private IP before the undici transport", async () => {
  const request = new Request("https://127.0.0.1/steal");
  Object.defineProperty(request, "url", { value: "https://pod.example/item" });
  await expect(createNodeGuardedFetch()(request)).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});
