// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import solidDriver from "../src/index.js";

vi.unmock("@jeswr/storage-client");
const ROOT = "https://unstorage-factory.example/kv/";
const STORAGE_LINK = '<http://www.w3.org/ns/pim/space#Storage>; rel="type"';

describe("legacy fetch construction through the public factory", () => {
  it("retains driver and transaction headers during discovery and data reads", async () => {
    const seen: {
      url: string;
      method: string;
      headers: Headers;
      redirect: RequestRedirect | undefined;
    }[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = String(input);
      seen.push({
        url,
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        redirect: init?.redirect,
      });
      if (url === ROOT && init?.method === "HEAD")
        return new Response(null, {
          headers: { link: STORAGE_LINK, "updates-via": "wss://notifications.example/updates" },
        });
      if (init?.method === "OPTIONS") return new Response(null, { status: 204 });
      return new Response("value", { headers: { "content-type": "text/plain", etag: '"e"' } });
    };
    const driver = solidDriver({
      base: ROOT,
      fetch,
      headers: { "x-driver": "yes", "x-override": "default" },
    });
    expect(await driver.getItem?.("a", { headers: { "x-override": "transaction" } })).toBe("value");
    expect(seen.some(({ method }) => method === "HEAD")).toBe(true);
    expect(seen.at(-1)?.url).toBe(`${ROOT}a`);
    for (const { headers, redirect } of seen) {
      expect(headers.get("x-driver")).toBe("yes");
      expect(headers.get("x-override")).toBe("transaction");
      expect(redirect).toBe("manual");
    }
  });

  it("never sends headers to a foreign description and gracefully degrades watch", async () => {
    const base = "https://unstorage-poisoned.example/kv/";
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      calls.push(String(input));
      return new Response(null, {
        headers: {
          link: `${STORAGE_LINK}, <https://evil.example/description>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`,
        },
      });
    };
    const onWatchDegrade = vi.fn();
    const driver = solidDriver({
      base,
      fetch,
      watch: true,
      headers: { "x-driver": "yes" },
      onWatchDegrade,
    });
    const unwatch = await driver.watch?.(vi.fn());
    expect(calls).toEqual([base]);
    expect(onWatchDegrade).toHaveBeenCalledWith("notification setup failed");
    unwatch?.();
  });
});
