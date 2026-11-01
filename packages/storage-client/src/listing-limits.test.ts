// AUTHORED-BY Codex GPT-6
import { describe, expect, test, vi } from "vitest";
import { StorageError } from "./errors.js";
import { createLwsBackend } from "./lws.js";
import { createMemoryStorage } from "./memory.js";
import { createSolidBackend } from "./solid.js";
import type { AuthFetch } from "./types.js";

const ROOT = "https://pod.example/";
const encoder = new TextEncoder();
const factories = [
  { protocol: "solid", create: createSolidBackend, contentType: "text/turtle" },
  { protocol: "lws", create: createLwsBackend, contentType: "application/lws+json" },
] as const;

function listing(protocol: "solid" | "lws", member = ""): string {
  return protocol === "solid"
    ? member
      ? `<> <http://www.w3.org/ns/ldp#contains> <${member}> .`
      : "# empty container\n"
    : JSON.stringify({ type: "Container", items: member ? [{ id: member }] : [] });
}

describe.each(factories)("$protocol listing response byte caps", ({
  protocol,
  create,
  contentType,
}) => {
  test.each([
    undefined,
    "1",
    "9999999",
  ])("rejects oversized memberless bodies before parsing, Content-Length=%s", async (contentLength) => {
    const body = `${listing(protocol)}${" ".repeat(1024 * 1024)}`;
    const storage = create({
      root: ROOT,
      fetch: async () =>
        new Response(body, {
          headers: {
            "content-type": contentType,
            ...(contentLength === undefined ? {} : { "content-length": contentLength }),
          },
        }),
    });
    for (const result of [
      storage.list(ROOT, { maxBytes: 8 }),
      Array.fromAsync(storage.listAll(ROOT, { maxBytes: 8 })),
    ]) {
      await expect(result).rejects.toBeInstanceOf(StorageError);
      await expect(result).rejects.toMatchObject({
        code: "payload-too-large",
        method: "GET",
        url: ROOT,
        retryable: false,
        message: expect.stringContaining("8 response bytes per page"),
      });
    }
  });

  test("reports byte overflow before syntax errors and never yields a partial page", async () => {
    const storage = create({
      root: ROOT,
      fetch: async () =>
        new Response("invalid syntax!", { headers: { "content-type": contentType } }),
    });
    const iterator = storage.listAll(ROOT, { maxBytes: 1 })[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({ code: "payload-too-large" });
  });

  test("does not yield an already received member when a later chunk exceeds the cap", async () => {
    const prefix = encoder.encode(listing(protocol, "a"));
    let first = true;
    const cancel = vi.fn();
    const storage = create({
      root: ROOT,
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                controller.enqueue(first ? prefix : encoder.encode("    "));
                first = false;
              },
              cancel,
            },
            { highWaterMark: 0 },
          ),
          { headers: { "content-type": contentType } },
        ),
    });
    const iterator = storage
      .listAll(ROOT, { maxBytes: prefix.byteLength + 4 })
      [Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({ code: "payload-too-large" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  test.each([
    "pending",
    "rejecting",
  ])("cancels an endless body promptly even with a %s cancel promise", async (cancellation) => {
    let pulled = 0;
    const cancel = vi.fn(() =>
      cancellation === "pending"
        ? new Promise<void>(() => {})
        : Promise.reject(new Error("cancel failed")),
    );
    const storage = create({
      root: ROOT,
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                pulled++;
                controller.enqueue(encoder.encode("    "));
              },
              cancel,
            },
            { highWaterMark: 0 },
          ),
          { headers: { "content-type": contentType, "content-length": "0" } },
        ),
    });
    await expect(storage.list(ROOT, { maxBytes: 8 })).rejects.toMatchObject({
      code: "payload-too-large",
    });
    expect(pulled).toBe(3);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test("counts UTF-8 bytes across chunks and accepts exactly the limit", async () => {
    const bytes = encoder.encode(listing(protocol, "café"));
    const split = bytes.indexOf(0xc3) + 1;
    const storage = create({
      root: ROOT,
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes.slice(0, split));
              controller.enqueue(bytes.slice(split));
              controller.close();
            },
          }),
          // A declared size cannot override the actual streamed-byte count in either direction.
          { headers: { "content-type": contentType, "content-length": "9999999" } },
        ),
    });
    expect((await storage.list(ROOT, { maxBytes: bytes.byteLength })).items).toMatchObject([
      { url: `${ROOT}${protocol === "solid" ? "café" : "caf%C3%A9"}` },
    ]);
    expect(
      await Array.fromAsync(storage.listAll(ROOT, { maxBytes: bytes.byteLength })),
    ).toHaveLength(1);
    await expect(storage.list(ROOT, { maxBytes: bytes.byteLength - 1 })).rejects.toMatchObject({
      code: "payload-too-large",
    });
  });

  test("abort cancels a pending capped read and remains a non-retryable network error", async () => {
    const abort = new AbortController();
    const cancel = vi.fn();
    let reading!: () => void;
    const started = new Promise<void>((resolve) => {
      reading = resolve;
    });
    const storage = create({
      root: ROOT,
      fetch: async () =>
        new Response(
          new ReadableStream({
            pull() {
              reading();
            },
            cancel,
          }),
          {
            headers: { "content-type": contentType },
          },
        ),
    });
    const result = storage.list(ROOT, { maxBytes: 8, signal: abort.signal });
    await started;
    abort.abort("stop");
    await expect(result).rejects.toMatchObject({ code: "network", retryable: false });
    expect(cancel).toHaveBeenCalledOnce();
  });

  test("zero is a real limit, including a response without a body", async () => {
    const storage = create({
      root: ROOT,
      fetch: async () => new Response(null, { headers: { "content-type": contentType } }),
    });
    if (protocol === "solid") expect((await storage.list(ROOT, { maxBytes: 0 })).items).toEqual([]);
    else
      await expect(storage.list(ROOT, { maxBytes: 0 })).rejects.toMatchObject({
        code: "invalid-response",
      });
    const nonempty = create({
      root: ROOT,
      fetch: async () =>
        new Response(listing(protocol), { headers: { "content-type": contentType } }),
    });
    await expect(nonempty.list(ROOT, { maxBytes: 0 })).rejects.toMatchObject({
      code: "payload-too-large",
    });
  });

  test.each([
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    null,
    "8",
  ])("rejects invalid maxBytes=%s before fetching", async (value) => {
    const fetch = vi.fn<AuthFetch>();
    const storage = create({ root: ROOT, fetch });
    const maxBytes = value as number;
    await expect(storage.list(ROOT, { maxBytes })).rejects.toThrow(TypeError);
    await expect(Array.fromAsync(storage.listAll(ROOT, { maxBytes }))).rejects.toThrow(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

test("LWS applies maxBytes separately to every page, including supplied cursors", async () => {
  const first = listing("lws", "a");
  const second = `${listing("lws", "b")}${" ".repeat(first.length)}`;
  const storage = createLwsBackend({
    root: ROOT,
    fetch: async (input) =>
      new Response(String(input) === ROOT ? first : second, {
        headers: {
          "content-type": "application/lws+json",
          ...(String(input) === ROOT ? { link: '<?page=2>; rel="next"' } : {}),
        },
      }),
  });
  const maxBytes = encoder.encode(first).byteLength;
  const iterator = storage.listAll(ROOT, { maxBytes })[Symbol.asyncIterator]();
  expect((await iterator.next()).value).toMatchObject({ url: `${ROOT}a` });
  await expect(iterator.next()).rejects.toMatchObject({
    code: "payload-too-large",
    url: `${ROOT}?page=2`,
  });
  await expect(
    storage.list(ROOT, { maxBytes, cursor: { url: `${ROOT}?page=2` } }),
  ).rejects.toMatchObject({ code: "payload-too-large" });
  expect(
    (
      await storage.list(ROOT, {
        maxBytes: encoder.encode(second).byteLength,
        cursor: { url: `${ROOT}?page=2` },
      })
    ).items,
  ).toHaveLength(1);
});

test("a caller cannot raise the existing LWS 16 MiB JSON hard limit", async () => {
  const storage = createLwsBackend({
    root: ROOT,
    fetch: async () =>
      new Response(`${listing("lws")}${" ".repeat(16 * 1024 * 1024)}`, {
        headers: { "content-type": "application/lws+json" },
      }),
  });
  await expect(storage.list(ROOT, { maxBytes: 32 * 1024 * 1024 })).rejects.toMatchObject({
    code: "invalid-response",
    message: "JSON exceeds 16 MiB",
  });
});

describe.each(["solid", "lws"] as const)("%s memory listing byte caps", (protocol) => {
  test("counts the actual representation, including empty-container overhead and exact limits", async () => {
    const storage = createMemoryStorage({ protocol, root: ROOT, pageSize: 1 });
    const emptySize = (await (await storage.read(ROOT)).bytes()).byteLength;
    await expect(storage.list(ROOT, { maxBytes: emptySize - 1 })).rejects.toMatchObject({
      code: "payload-too-large",
    });
    expect((await storage.list(ROOT, { maxBytes: emptySize })).items).toEqual([]);
    await expect(Array.fromAsync(storage.listAll(ROOT, { maxBytes: 0 }))).rejects.toMatchObject({
      code: "payload-too-large",
    });
    await storage.create(ROOT, "one", { name: "café", contentType: "text/plain" });
    await storage.create(ROOT, "two", { name: "second", contentType: "text/plain" });
    const firstSize = (await (await storage.read(ROOT)).bytes()).byteLength;
    const page = await storage.list(ROOT, { maxBytes: firstSize });
    expect(page.items).toHaveLength(protocol === "lws" ? 1 : 2);
    await expect(storage.list(ROOT, { maxBytes: firstSize - 1 })).rejects.toMatchObject({
      code: "payload-too-large",
    });
    if (page.next) {
      const secondSize = (await (await storage.read(page.next.url)).bytes()).byteLength;
      await expect(
        storage.list(ROOT, { cursor: page.next, maxBytes: secondSize - 1 }),
      ).rejects.toMatchObject({ code: "payload-too-large", url: page.next.url });
      expect(
        (await storage.list(ROOT, { cursor: page.next, maxBytes: secondSize })).items,
      ).toHaveLength(1);
      expect(
        await Array.fromAsync(storage.listAll(ROOT, { maxBytes: Math.max(firstSize, secondSize) })),
      ).toHaveLength(2);
    }
    await expect(storage.list(ROOT, { maxBytes: Number.NaN })).rejects.toThrow(TypeError);
  });
});
