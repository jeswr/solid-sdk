// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { SolidDocStore } from "./store.js";

vi.unmock("@jeswr/storage-client");

const ROOT = "https://rxdb-factory.example/items/";
const STORAGE_LINK = '<http://www.w3.org/ns/pim/space#Storage>; rel="type"';

describe("legacy fetch construction through the public factory", () => {
  it("discovers once and uses the same guarded transport for document reads", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === ROOT && init?.method === "HEAD")
        return new Response(null, {
          headers: { link: STORAGE_LINK, "updates-via": "wss://notifications.example/updates" },
        });
      if (init?.method === "OPTIONS") return new Response(null, { status: 204 });
      return new Response("hello", { headers: { "content-type": "text/plain", etag: '"e"' } });
    };
    const store = new SolidDocStore({ container: ROOT, fetch });
    expect((await store.getDoc("doc.a.json"))?.body).toBe("hello");
    expect((await store.getDoc("doc.a.json"))?.etag).toBe('"e"');
    expect(calls.filter(({ init }) => init?.method === "HEAD")).toHaveLength(1);
    expect(calls.filter(({ init }) => init?.method === "GET")).toHaveLength(2);
    expect(
      calls.every(({ url, init }) => url.startsWith(ROOT) && init?.redirect === "manual"),
    ).toBe(true);
  });

  it("refuses cross-origin discovery without following a pod-controlled link", async () => {
    const base = "https://rxdb-poisoned.example/items/";
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      calls.push(String(input));
      return new Response(null, {
        headers: {
          link: `${STORAGE_LINK}, <https://evil.example/description>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`,
        },
      });
    };
    const store = new SolidDocStore({ container: base, fetch });
    await expect(store.getDoc("doc.a.json")).rejects.toThrow();
    expect(calls).toEqual([base]);
  });
});
