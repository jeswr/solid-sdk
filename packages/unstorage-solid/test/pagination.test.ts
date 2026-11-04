// AUTHORED-BY Codex GPT-6.1-Sol
import { createPodClient, StorageError } from "@jeswr/storage-client";
import { describe, expect, it, vi } from "vitest";
import { listContainer } from "../src/container.js";
import solidDriver from "../src/index.js";

vi.unmock("@jeswr/storage-client");

let fixtureId = 0;

async function fixture(
  injected: boolean,
  status: number,
  firstPage: "member" | "empty" | "filtered" | "missing",
) {
  const base = `https://unstorage-pagination-${++fixtureId}.example/kv/`;
  const description = new URL("/.well-known/storage", base).href;
  const cursor = `${base}?cursor=next%2Fpage`;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    if (url === base && init?.method === "HEAD")
      return new Response(null, {
        headers: { link: `<${description}>; rel="https://www.w3.org/ns/lws#storage"` },
      });
    if (url === description)
      return Response.json({
        "@context": ["https://www.w3.org/ns/cid/v1", "https://www.w3.org/ns/lws/v1"],
        id: description,
        type: "Storage",
        service: [{ type: "StorageRoot", serviceEndpoint: base }],
      });
    if (url === base && (init?.method ?? "GET") === "GET") {
      if (firstPage === "missing") return new Response(null, { status });
      return Response.json(
        {
          type: "Container",
          items:
            firstPage === "empty"
              ? []
              : [{ id: firstPage === "filtered" ? `${base}sub/deep` : `${base}a` }],
        },
        { headers: { "content-type": "application/lws+json", link: `<${cursor}>; rel="next"` } },
      );
    }
    if (url === cursor) return new Response(null, { status });
    throw new Error(`Unexpected ${init?.method ?? "GET"} ${url}`);
  });
  const storage = injected ? (await createPodClient({ storage: base, fetch })).storage : undefined;
  return { base, cursor, fetch, storage, driver: solidDriver({ base, fetch, storage }) };
}

describe.each([false, true])("LWS pagination with injected storage: %s", (injected) => {
  describe.each([404, 410])("missing listing response (%s)", (status) => {
    it.each([
      "member",
      "empty",
      "filtered",
    ] as const)("rejects a missing cursor after a %s first page without deleting", async (firstPage) => {
      const { base, cursor, fetch, storage, driver } = await fixture(injected, status, firstPage);
      const failure = {
        message: `[unstorage-solid] list ${base} failed: ${status}`,
        cause: expect.objectContaining({ status, url: cursor }),
      };
      await expect(listContainer(base, base, storage ?? fetch)).rejects.toMatchObject(failure);
      await expect(driver.getKeys("", {})).rejects.toMatchObject(failure);
      await expect(driver.clear?.("", {})).rejects.toMatchObject(failure);
      expect(fetch.mock.calls.filter(([url]) => String(url) === cursor)).toHaveLength(3);
      expect(
        fetch.mock.calls.every(([, init]) => ["HEAD", "GET"].includes(init?.method ?? "GET")),
      ).toBe(true);
    });

    it("still treats a missing initial container as absent", async () => {
      const { base, fetch, storage, driver } = await fixture(injected, status, "missing");
      await expect(listContainer(base, base, storage ?? fetch)).resolves.toBeNull();
      await expect(driver.getKeys("", {})).resolves.toEqual([]);
      await expect(driver.clear?.("", {})).resolves.toBeUndefined();
      expect(fetch.mock.calls.every(([url]) => !String(url).includes("?cursor="))).toBe(true);
    });
  });
});

it.each([
  404, 410,
])("rejects a %s reported against the container after an entry was yielded", async (status) => {
  const { base, storage } = await fixture(true, status, "member");
  if (!storage) throw new Error("Expected injected storage");
  vi.spyOn(storage, "listAll").mockImplementation(async function* () {
    yield {
      url: `${base}sub/deep`,
      kind: "resource",
      contentType: null,
      modified: null,
      size: null,
      types: [],
    };
    throw new StorageError("not-found", { method: "GET", url: base, status });
  });
  await expect(listContainer(base, base, storage)).rejects.toThrow(`failed: ${status}`);
});
