// AUTHORED-BY Codex GPT-6.1-Sol
import { createPodClient } from "@jeswr/storage-client";
import { describe, expect, it, vi } from "vitest";
import { SolidDocStore } from "./store.js";

vi.unmock("@jeswr/storage-client");

let fixtureId = 0;

async function fixture(
  injected: boolean,
  status: number,
  firstPage: "member" | "empty" | "metadata" | "foreign" | "missing",
) {
  const container = `https://rxdb-pagination-${++fixtureId}.example/items/`;
  const description = new URL("/.well-known/storage", container).href;
  const cursor = `${container}?cursor=next%2Fpage`;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    if (url === container && init?.method === "HEAD")
      return new Response(null, {
        headers: { link: `<${description}>; rel="https://www.w3.org/ns/lws#storage"` },
      });
    if (url === description)
      return Response.json({
        "@context": ["https://www.w3.org/ns/cid/v1", "https://www.w3.org/ns/lws/v1"],
        id: description,
        type: "Storage",
        service: [{ type: "StorageRoot", serviceEndpoint: container }],
      });
    if (url === container && (init?.method ?? "GET") === "GET") {
      if (firstPage === "missing") return new Response(null, { status });
      const name =
        firstPage === "metadata"
          ? "meta.json"
          : firstPage === "foreign"
            ? "foreign.txt"
            : "doc.a.json";
      return Response.json(
        {
          type: "Container",
          items: firstPage === "empty" ? [] : [{ id: `${container}${name}` }],
        },
        { headers: { "content-type": "application/lws+json", link: `<${cursor}>; rel="next"` } },
      );
    }
    if (url === cursor) return new Response(null, { status });
    throw new Error(`Unexpected ${init?.method ?? "GET"} ${url}`);
  });
  const storage = injected
    ? (await createPodClient({ storage: container, fetch })).storage
    : undefined;
  return { cursor, fetch, store: new SolidDocStore({ container, fetch, storage }) };
}

describe.each([false, true])("LWS pagination with injected storage: %s", (injected) => {
  describe.each([404, 410])("missing listing response (%s)", (status) => {
    it.each([
      "member",
      "empty",
      "metadata",
      "foreign",
    ] as const)("rejects a missing cursor after a %s first page", async (firstPage) => {
      const { cursor, fetch, store } = await fixture(injected, status, firstPage);
      await expect(store.listDocUrls()).rejects.toMatchObject({ status, url: cursor });
      expect(fetch.mock.calls.filter(([url]) => String(url) === cursor)).toHaveLength(1);
      expect(
        fetch.mock.calls.every(([, init]) => ["HEAD", "GET"].includes(init?.method ?? "GET")),
      ).toBe(true);
    });

    it("still treats a missing initial container as absent", async () => {
      const { cursor, fetch, store } = await fixture(injected, status, "missing");
      await expect(store.listDocUrls()).resolves.toEqual([]);
      expect(fetch.mock.calls.some(([url]) => String(url) === cursor)).toBe(false);
    });
  });
});
