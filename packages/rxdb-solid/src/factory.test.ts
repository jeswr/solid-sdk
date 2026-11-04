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

  it("revalidates an expired description with 304 when constructing a new store", async () => {
    const base = "https://rxdb-revalidation.example/items/";
    const description = "https://rxdb-revalidation.example/description";
    const document = `${base}doc.a.json`;
    const etag = '"description-v1"';
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (url === base && init?.method === "HEAD") {
        return new Response(null, {
          headers: {
            link: `${STORAGE_LINK}, <${description}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`,
          },
        });
      }
      if (url === description && init?.method === "GET") {
        const conditional = new Headers(init.headers).get("if-none-match") === etag;
        return new Response(conditional ? null : "", {
          status: conditional ? 304 : 200,
          headers: { "content-type": "text/turtle", etag, "cache-control": "max-age=60" },
        });
      }
      if (url === base && init?.method === "OPTIONS") return new Response(null, { status: 204 });
      if (url === document && init?.method === "GET")
        return new Response("hello", { headers: { "content-type": "text/plain", etag: '"e"' } });
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    });
    try {
      const original = new SolidDocStore({ container: base, fetch });
      expect((await original.getDoc("doc.a.json"))?.body).toBe("hello");

      now.mockReturnValue(62_000);
      const refreshed = new SolidDocStore({ container: base, fetch });
      expect(await refreshed.getDoc("doc.a.json")).toMatchObject({ body: "hello", etag: '"e"' });
      const cached = new SolidDocStore({ container: base, fetch });
      expect((await cached.getDoc("doc.a.json"))?.body).toBe("hello");

      const descriptionCalls = fetch.mock.calls.filter(([url]) => String(url) === description);
      expect(descriptionCalls).toHaveLength(2);
      expect(new Headers(descriptionCalls[0]?.[1]?.headers).has("if-none-match")).toBe(false);
      expect(new Headers(descriptionCalls[1]?.[1]?.headers).get("if-none-match")).toBe(etag);
      expect(fetch.mock.calls.filter(([, init]) => init?.method === "HEAD")).toHaveLength(1);
      expect(fetch.mock.calls.filter(([url]) => String(url) === document)).toHaveLength(3);
      expect(fetch.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
    } finally {
      now.mockRestore();
    }
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
