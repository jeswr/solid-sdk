// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import { fetchRdf, RdfFetchError } from "../src/index.js";

const url = "https://example.org/resource";

describe("rejected response cleanup", () => {
  it.each([
    { status: 404, contentType: "text/plain", message: "HTTP 404" },
    { status: 503, contentType: "text/turtle", message: "HTTP 503" },
    { status: 200, contentType: "text/html", message: "Unsupported RDF media type" },
    { status: 200, contentType: "invalid", message: "Invalid Content-Type header" },
  ])("cancels an unread $status / $contentType body before rejecting", async (testCase) => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const response = new Response(body, {
      status: testCase.status,
      headers: { "content-type": testCase.contentType },
    });

    await expect(fetchRdf(url, { fetch: vi.fn(async () => response) })).rejects.toThrow(
      testCase.message,
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  describe.each(["never settles", "rejects after timeout"])("when cancellation %s", (outcome) => {
    it.each([
      { status: 403, contentType: "text/plain", message: "HTTP 403" },
      { status: 200, contentType: "text/html", message: "Unsupported RDF media type" },
      { status: 200, contentType: "invalid", message: "Invalid Content-Type header" },
    ])("immediately exposes the $status / $contentType error", async (testCase) => {
      vi.useFakeTimers();
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      let failCancellation = (_reason: Error) => {};
      const pending = new Promise<void>((_resolve, reject) => {
        failCancellation = reject;
      });
      const cancel = vi.fn(() => pending);
      const response = new Response(new ReadableStream({ cancel }), {
        status: testCase.status,
        headers: { "content-type": testCase.contentType },
      });
      const rejected = vi.fn();
      const result = fetchRdf(url, { fetch: vi.fn(async () => response) }).catch(rejected);

      try {
        await vi.advanceTimersByTimeAsync(0);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(rejected).toHaveBeenCalledExactlyOnceWith(expect.any(RdfFetchError));
        expect(rejected.mock.calls[0]?.[0].message).toContain(testCase.message);
        await result;
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(vi.getTimerCount()).toBe(0);
        if (outcome === "rejects after timeout") {
          failCancellation(new Error("late cleanup failure"));
          await vi.advanceTimersByTimeAsync(0);
        }
        expect(unhandled).not.toHaveBeenCalled();
        expect(rejected).toHaveBeenCalledTimes(1);
      } finally {
        process.off("unhandledRejection", unhandled);
        vi.useRealTimers();
      }
    });
  });

  it("preserves the HTTP error when body cancellation rejects", async () => {
    const cancel = vi.fn(async () => {
      throw new Error("cleanup failed");
    });
    const response = new Response(new ReadableStream({ cancel }), { status: 500 });
    await expect(fetchRdf(url, { fetch: vi.fn(async () => response) })).rejects.toMatchObject({
      name: "RdfFetchError",
      status: 500,
      url,
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("preserves the HTTP error for an already-locked body", async () => {
    const body = new ReadableStream<Uint8Array>();
    const response = new Response(body, { status: 500 });
    const reader = body.getReader();
    try {
      await expect(fetchRdf(url, { fetch: vi.fn(async () => response) })).rejects.toMatchObject({
        name: "RdfFetchError",
        status: 500,
      });
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  });

  it("cancels the remaining body when the remote-context policy rejects", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('{"@context":"https://example.org/refused","@id":"urn:s"}'),
        );
        // Leave the response open to prove policy rejection stops further reads.
      },
      cancel,
    });
    const response = new Response(body, { headers: { "content-type": "application/ld+json" } });
    await expect(fetchRdf(url, { fetch: vi.fn(async () => response) })).rejects.toBeInstanceOf(
      RdfFetchError,
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });
});
