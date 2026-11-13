// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";

vi.mock("undici", () => {
  throw new Error("Pinning transport is unavailable");
});

import { createGuardedFetch } from "../src/index.js";

afterEach(() => vi.unstubAllGlobals());

it("fails closed without undici and never falls back to the unpinned global fetch", async () => {
  const fetch = vi.fn(async () => new Response("unsafe fallback"));
  vi.stubGlobal("fetch", fetch);
  await expect(
    createGuardedFetch({ dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }] })(
      "https://registry.example/",
    ),
  ).rejects.toThrow(/DNS-pinning transport unavailable/);
  expect(fetch).not.toHaveBeenCalled();
});

it("does not load the Node transport in a browser", async () => {
  vi.stubGlobal("process", undefined);
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("document", {});
  const fetch = vi.fn(async () => new Response("browser"));
  expect(await (await createGuardedFetch({ fetch })("https://registry.example/")).text()).toBe(
    "browser",
  );
});

it("retains DNS-less edge refusal and its explicit unresolved-host acceptance", async () => {
  vi.stubGlobal("process", undefined);
  const fetch = vi.fn(async () => new Response("edge"));
  await expect(createGuardedFetch({ fetch })("https://registry.example/")).rejects.toThrow(
    /no DNS resolver/,
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(
    await (
      await createGuardedFetch({ fetch, allowUnresolvedHosts: true })("https://registry.example/")
    ).text(),
  ).toBe("edge");
});

it("retains injected-resolver policy outside Node without loading a Node transport", async () => {
  vi.stubGlobal("process", undefined);
  const fetch = vi.fn(async () => new Response("edge resolver"));
  await createGuardedFetch({ fetch, dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }] })(
    "https://registry.example/",
  );
  expect(fetch).toHaveBeenCalledOnce();
});
