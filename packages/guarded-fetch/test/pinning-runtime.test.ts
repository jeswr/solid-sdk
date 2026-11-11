// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSafeUrl, createGuardedFetch, SsrfError } from "../src/index.js";

const publicDns = async () => [{ address: "1.1.1.1", family: 4 }];
afterEach(() => vi.unstubAllGlobals());

for (const runtime of ["Bun", "Deno"]) {
  describe(`${runtime} cannot use Node DNS pinning`, () => {
    function stubRuntime() {
      if (runtime === "Bun")
        vi.stubGlobal("process", { ...process, versions: { ...process.versions, bun: "1.3" } });
      else vi.stubGlobal("Deno", { version: { deno: "2" } });
    }
    it.each([
      undefined,
      null,
      publicDns,
    ])("fails closed before sending with resolver %s", async (dnsLookup) => {
      stubRuntime();
      const fetch = vi.fn(async () => new Response("unsafe"));
      vi.stubGlobal("fetch", fetch);
      await expect(
        createGuardedFetch({ dnsLookup, allowUnresolvedHosts: true })("https://public.example/"),
      ).rejects.toThrow(/pinning.*unavailable/i);
      expect(fetch).not.toHaveBeenCalled();
    });
    it("accepts the explicit opt-out", async () => {
      stubRuntime();
      const fetch = vi.fn(async () => new Response("explicit residual"));
      await createGuardedFetch({ fetch, dnsLookup: publicDns, requireDnsPinning: false })(
        "https://public.example/",
      );
      expect(fetch).toHaveBeenCalledOnce();
    });
    it("accepts an attested pinning transport", async () => {
      stubRuntime();
      const pinningFetch = vi.fn(async () => new Response("caller pin"));
      await createGuardedFetch({ pinningFetch, dnsLookup: publicDns })("https://public.example/");
      expect(pinningFetch).toHaveBeenCalledOnce();
    });
  });
}

it("assertSafeUrl accepts custom fetch guardOptions without requiring a transport", async () => {
  const fetch = vi.fn();
  await expect(
    assertSafeUrl("https://public.example/", {
      fetch,
      dnsLookup: publicDns,
      requireDnsPinning: true,
    }),
  ).resolves.toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});

it("assertSafeUrl skips pinning gates with DNS disabled, while retaining DNS-less policy", async () => {
  await expect(
    assertSafeUrl("https://public.example/", {
      dnsLookup: null,
      allowUnresolvedHosts: true,
      requireDnsPinning: true,
    }),
  ).resolves.toBeUndefined();
  await expect(assertSafeUrl("https://public.example/", { dnsLookup: null })).rejects.toThrow(
    /no DNS resolver/,
  );
  await expect(
    assertSafeUrl("https://169.254.169.254/", { fetch: vi.fn(), requireDnsPinning: true }),
  ).rejects.toBeInstanceOf(SsrfError);
});
