// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test, vi } from "vitest";
import { createMemoryCache } from "./cache.js";
import { resolveStorageDescription } from "./resolve.js";
import { sparqLwsCid } from "./testing.js";

const RESOURCE = "https://lws.example/data/file";
const LINK = `<${sparqLwsCid.id}>; rel="https://www.w3.org/ns/lws#storage"`;
const LIMIT = 1_048_576;

function resolve(response: Response) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
  return resolveStorageDescription(RESOURCE, {
    fetch,
    cache: createMemoryCache(),
    seedHeaders: new Headers({ Link: LINK }),
  });
}

test("accepts a description at exactly 1 MiB", async () => {
  const body = JSON.stringify(sparqLwsCid).padEnd(LIMIT, " ");
  expect(await resolve(new Response(body))).toMatchObject({ id: sparqLwsCid.id });
});

test("rejects a declared oversized body before reading it and cancels the source", async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }), {
    headers: { "Content-Length": String(LIMIT + 1) },
  });
  await expect(resolve(response)).rejects.toMatchObject({
    code: "description-invalid",
    message: "Description exceeds 1 MiB",
  });
  expect(cancel).toHaveBeenCalledOnce();
});

test.each([
  undefined,
  "1",
])("caps streamed bytes with missing or dishonest Content-Length (%s)", async (length) => {
  const cancel = vi.fn();
  let chunks = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        chunks++;
        controller.enqueue(new Uint8Array(LIMIT / 2));
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  const response = new Response(body, { headers: length ? { "Content-Length": length } : {} });
  await expect(resolve(response)).rejects.toMatchObject({ code: "description-invalid" });
  expect(chunks).toBe(3);
  expect(cancel).toHaveBeenCalledOnce();
});

test("counts UTF-8 octets and retains the limit error when cancellation fails", async () => {
  const bytes = new TextEncoder().encode("é".repeat(LIMIT / 2 + 1));
  expect(bytes.byteLength).toBeGreaterThan(LIMIT);
  const cancel = vi.fn(async () => {
    throw new Error("cancel failed");
  });
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
    },
    cancel,
  });
  await expect(resolve(new Response(body))).rejects.toMatchObject({ code: "description-invalid" });
  expect(cancel).toHaveBeenCalledOnce();
});

test("decodes split UTF-8 sequences correctly", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...sparqLwsCid, label: "é" }));
  const offset = bytes.indexOf(0xc3) + 1;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, offset));
      controller.enqueue(bytes.slice(offset));
      controller.close();
    },
  });
  expect(await resolve(new Response(body))).toMatchObject({ id: sparqLwsCid.id });
});

test("reports a body transport failure as network even when cancelling the errored stream fails", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.error(new TypeError("disconnected"));
    },
  });
  await expect(resolve(new Response(body))).rejects.toMatchObject({
    code: "network",
    url: sparqLwsCid.id,
  });
});

test("keeps the HTTP error when cancelling an error response fails", async () => {
  const response = new Response(
    new ReadableStream({
      cancel() {
        throw new Error("closed");
      },
    }),
    { status: 500 },
  );
  await expect(resolve(response)).rejects.toMatchObject({
    code: "description-unreachable",
    status: 500,
  });
});
