// AUTHORED-BY Codex GPT-6.1-Sol
import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { parseRdf, RdfFetchError } from "../src/index.js";

const encode = (text: string) => new TextEncoder().encode(text);

describe("stream failure teardown", () => {
  it.each([
    "text/turtle",
    "application/ld+json",
  ])("observes both promises when a %s source fails", async (mediaType) => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const failure = new Error("body stream failed");
    const rejection = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(failure);
      },
    });
    try {
      await parseRdf(stream, mediaType).catch((error: unknown) => {
        rejection(error);
        expect(error).toBeInstanceOf(RdfFetchError);
        expect((error as RdfFetchError).cause).toBe(failure);
      });
      await setImmediate();
      expect(rejection).toHaveBeenCalledTimes(1);
      expect(unhandled).not.toHaveBeenCalled();
      expect(stream.locked).toBe(false);
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it.each([
    "text/turtle",
    "application/ld+json",
  ])("cancels a stalled source after a %s parser error", async (mediaType) => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encode(mediaType === "text/turtle" ? "bad turtle .\n" : "{ invalid json"),
        );
      },
      cancel,
    });
    await expect(parseRdf(stream, mediaType)).rejects.toBeInstanceOf(RdfFetchError);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });

  it("settles the store if acquiring the body reader throws", async () => {
    const stream = new ReadableStream<Uint8Array>();
    const reader = stream.getReader();
    try {
      await expect(parseRdf(stream, "text/turtle")).rejects.toBeInstanceOf(RdfFetchError);
    } finally {
      reader.releaseLock();
    }
  });

  it("handles backpressure while parsing a large chunk", async () => {
    const text = '<https://example.org/s> <https://example.org/p> "value" .\n'.repeat(2000);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encode(text));
        controller.close();
      },
    });
    expect((await parseRdf(stream, "text/turtle")).size).toBe(1);
  });

  it("handles non-Error stream failures", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error("failed");
      },
    });
    await expect(parseRdf(stream, "text/turtle")).rejects.toMatchObject({
      name: "RdfFetchError",
      cause: "failed",
    });
  });
});
