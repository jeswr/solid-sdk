// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { createLwsBackend } from "./lws.js";
import { createMemoryStorage } from "./memory.js";
import { createSolidBackend } from "./solid.js";
import type { CreateOptions } from "./types.js";

const root = "https://pod.test/alice/";

describe.each(["solid", "memory"])("%s exact creates", (backend) => {
  function setup() {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(null, { status: 201, headers: { etag: '"v1"' } }),
    );
    const storage =
      backend === "memory" ? createMemoryStorage({ root }) : createSolidBackend({ fetch, root });
    return { storage, fetch };
  }
  it.each([
    "system:inbox.ttl",
    "opaque%ff.ttl",
    "encoded%3Aname.ttl",
  ])("preserves %s and sends only create preconditions", async (name) => {
    const { storage, fetch } = setup();
    const url = `${root}${name}`;
    expect(
      await storage.create(root, "content", { exactUrl: url, contentType: "text/plain" }),
    ).toMatchObject({ url, created: true });
    if (backend === "memory") {
      expect(await (await storage.read(url)).text()).toBe("content");
      await expect(
        storage.create(root, "replace", { exactUrl: url, contentType: "text/plain" }),
      ).rejects.toMatchObject({ code: "conflict" });
    } else {
      expect(fetch.mock.calls[0]?.[0]).toBe(url);
      const init = fetch.mock.calls[0]?.[1];
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).get("if-none-match")).toBe("*");
      expect(new Headers(init?.headers).has("if-match")).toBe(false);
    }
  });
  it("creates a container at its exact URL", async () => {
    const { storage } = setup();
    expect(
      await storage.create(root, null, { exactUrl: `${root}raw:container/`, kind: "container" }),
    ).toMatchObject({ url: `${root}raw:container/` });
  });
  it.each([
    { exactUrl: `${root}child`, name: "other" },
    { exactUrl: `${root}child`, kind: "container" },
    { exactUrl: `${root}child/` },
    { exactUrl: `${root}child?query` },
    { exactUrl: `${root}child#fragment` },
    { exactUrl: `${root}child?` },
    { exactUrl: `${root}child#` },
    { exactUrl: `${root}nested/child` },
    { exactUrl: `${root}nested/child/`, kind: "container" },
    { exactUrl: "https://foreign.test/child" },
    { exactUrl: `${root}../sibling/child` },
    { exactUrl: `${root}encoded%2fescape` },
    { exactUrl: `${root}%2e%2e/escape` },
    { exactUrl: "https://POD.TEST/alice/child" },
    { exactUrl: root },
  ] as CreateOptions[])("refuses invalid exact create %# before dispatch", async (opts) => {
    const { storage, fetch } = setup();
    await expect(
      storage.create(root, "content", { contentType: "text/plain", ...opts }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

it.each(["memory", "http"])("refuses exact URL creation on LWS (%s)", async (backend) => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const storage =
    backend === "memory"
      ? createMemoryStorage({ root, protocol: "lws" })
      : createLwsBackend({ root, fetch });
  await expect(
    storage.create(root, "content", { exactUrl: `${root}child`, contentType: "text/plain" }),
  ).rejects.toMatchObject({ code: "unsupported" });
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  "solid",
  "memory-solid",
  "memory-lws",
])("never treats an exact create as a service command (%s)", async (backend) => {
  const memory = createMemoryStorage({
    root,
    protocol: backend === "memory-lws" ? "lws" : "solid",
    trash: true,
  });
  const fetch = vi.fn<typeof globalThis.fetch>();
  const storage =
    backend === "solid" ? createSolidBackend({ root, fetch, features: memory.features }) : memory;
  await expect(
    storage.create(`${root}.trash/`, JSON.stringify({ resource: `${root}victim` }), {
      contentType: "application/json",
      exactUrl: `${root}.trash/child`,
    }),
  ).rejects.toMatchObject({ code: "unsupported" });
  expect(fetch).not.toHaveBeenCalled();
});

it("scopes and redacts an LWS parent before refusing exact creates", async () => {
  const storage = createLwsBackend({ root, fetch: vi.fn() });
  const error = await storage
    .create("https://user:password@foreign.test/", "content", { exactUrl: `${root}child` })
    .catch((error: unknown) => error);
  expect(error).toMatchObject({ code: "scope" });
  expect(String(error)).not.toContain("password");
});

it("creates intermediate Solid containers atomically for an exact PUT", async () => {
  const storage = createMemoryStorage({ root });
  const parent = `${root}integrations/toy/media/`;
  const url = `${parent}system:inbox.ttl`;
  await storage.create(parent, "content", { exactUrl: url, contentType: "text/plain" });
  expect((await storage.head(parent)).kind).toBe("container");
  expect(await (await storage.read(url)).text()).toBe("content");
});

it.each([
  "abort",
  "body-error",
])("does not materialize exact-create parents on %s", async (failure) => {
  const storage = createMemoryStorage({ root });
  const parent = `${root}missing/nested/`;
  const controller = new AbortController();
  const body = new ReadableStream<Uint8Array>({
    pull(stream) {
      if (failure === "abort") controller.abort();
      else stream.error(new Error("body failed"));
    },
  });
  await expect(
    storage.create(parent, body, {
      exactUrl: `${parent}child`,
      contentType: "text/plain",
      signal: controller.signal,
    }),
  ).rejects.toThrow();
  await expect(storage.head(parent)).rejects.toMatchObject({ status: 404 });
  await expect(storage.head(`${root}missing/`)).rejects.toMatchObject({ status: 404 });
});
