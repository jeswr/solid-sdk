// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import { StorageError } from "./errors.js";
import { createLwsBackend } from "./lws.js";
import { createMemoryStorage } from "./memory.js";
import { createSolidBackend } from "./solid.js";

const root = "https://example.com/pod/";
const url = `${root}entry.ttl`;
const ttl = '<urn:s> <urn:p> "é".';
const data = new TextEncoder().encode(ttl);
const headers = { "content-type": "text/turtle", "content-length": "1", etag: '"one"' };

function streamed(chunks: Uint8Array[]) {
  const cancel = vi.fn(() => new Promise<void>(() => undefined));
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    const chunk = chunks.shift();
    if (chunk) controller.enqueue(chunk);
  });
  const body = new ReadableStream({ pull, cancel }, { highWaterMark: 0 });
  return { body, pull, cancel };
}

describe.each([createSolidBackend, createLwsBackend])("bounded network reads (%#)", (create) => {
  it.each([
    "bytes",
    "text",
    "blob",
  ] as const)("cancels an oversized %s body before requesting more", async (read) => {
    const { body, pull, cancel } = streamed([data.subarray(0, 1), data.subarray(1), data]);
    const fetch = vi.fn(async () => new Response(body, { headers }));
    const result = await create({ root, fetch }).read(url, { maxBytes: data.byteLength - 1 });
    expect(result.etag).toBe('"one"');
    await expect(result[read]()).rejects.toMatchObject({
      code: "payload-too-large",
      retryable: false,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(pull).toHaveBeenCalledTimes(2);
  });

  it("enforces the cap on the live body, including zero", async () => {
    const { body, pull, cancel } = streamed([data]);
    const storage = create({ root, fetch: async () => new Response(body, { headers }) });
    const read = await storage.read(url, { maxBytes: 0 });
    await expect(read.body?.getReader().read()).rejects.toBeInstanceOf(StorageError);
    expect(pull).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("counts raw UTF-8 bytes and accepts an exact limit for bytes, ranges and RDF", async () => {
    const fetch = vi.fn(
      async (_url, init) =>
        new Response(data, {
          status: new Headers(init?.headers).has("range") ? 206 : 200,
          headers,
        }),
    );
    const storage = create({ root, fetch });
    const options = { maxBytes: data.byteLength };
    const read = await storage.read(url, {
      ...options,
      range: { start: 0, end: data.byteLength - 1 },
    });
    expect(read.status).toBe(206);
    expect(await read.bytes()).toEqual(data);
    const rdf = await storage.readRdf(url, options);
    expect(rdf.dataset.size).toBe(1);
    expect(rdf.etag).toBe('"one"');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([0, undefined])("cancels oversized RDF before parse with limit %s", async (maxBytes) => {
    const size = maxBytes ?? 16 * 1024 * 1024;
    const { body, pull, cancel } = streamed([new Uint8Array(size + 1), data]);
    const storage = create({ root, fetch: async () => new Response(body, { headers }) });
    await expect(storage.readRdf(url, { maxBytes })).rejects.toMatchObject({
      code: "payload-too-large",
    });
    expect(pull).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels a stalled bounded byte read on abort", async () => {
    const { body, cancel, pull } = streamed([]);
    const controller = new AbortController();
    const storage = create({ root, fetch: async () => new Response(body, { headers }) });
    const result = await storage.read(url, { maxBytes: 0, signal: controller.signal });
    const bytes = result.bytes();
    await vi.waitFor(() => expect(pull).toHaveBeenCalledOnce());
    controller.abort();
    await expect(bytes).rejects.toMatchObject({ code: "network", retryable: false });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("validates byte caps before transport", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const storage = create({ root, fetch });
    for (const maxBytes of [-1, 1.5, Infinity, NaN]) {
      await expect(storage.read(url, { maxBytes })).rejects.toBeInstanceOf(TypeError);
      await expect(storage.readRdf(url, { maxBytes })).rejects.toBeInstanceOf(TypeError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

it("honors limits, ranges and validators in the memory client", async () => {
  const storage = createMemoryStorage({ root });
  const created = await storage.create(root, ttl, {
    name: "entry.ttl",
    contentType: "text/turtle",
  });
  expect(await (await storage.read(url, { maxBytes: data.byteLength })).bytes()).toEqual(data);
  await expect(storage.read(url, { maxBytes: 0 })).rejects.toMatchObject({
    code: "payload-too-large",
  });
  const range = { start: 0, end: 1 };
  expect(await (await storage.read(url, { range, maxBytes: 2 })).bytes()).toEqual(
    data.subarray(0, 2),
  );
  await expect(storage.read(url, { range, maxBytes: 1 })).rejects.toMatchObject({
    code: "payload-too-large",
  });
  const cached = await storage.readRdf(url, {
    ifNoneMatch: created.etag ?? undefined,
    maxBytes: 0,
  });
  expect(cached.notModified).toBe(true);
  await expect(storage.readRdf(url, { maxBytes: data.byteLength - 1 })).rejects.toMatchObject({
    code: "payload-too-large",
  });
  expect((await storage.readRdf(url, { maxBytes: data.byteLength })).dataset.size).toBe(1);
});

it("preserves a transport failure when cancelling an already failed bounded body", async () => {
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error("read failed"));
    },
  });
  const storage = createSolidBackend({ root, fetch: async () => new Response(body, { headers }) });
  const read = await storage.read(url, { maxBytes: 1 });
  await expect(read.bytes()).rejects.toMatchObject({ code: "network", retryable: true });
});
