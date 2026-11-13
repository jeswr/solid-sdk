// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { ResponseBodyLimitError, readBoundedText } from "../src/index.js";

describe("readBoundedText", () => {
  it.each([
    -1,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid budget %s before consuming the body", async (limit) => {
    const response = new Response("value");
    await expect(readBoundedText(response, limit)).rejects.toThrow(TypeError);
    expect(response.bodyUsed).toBe(false);
  });

  it.each([null, ""])("accepts an empty body (%s) at a zero budget", async (body) => {
    expect(await readBoundedText(new Response(body), 0)).toBe("");
  });

  it("counts bytes across chunks and decodes split UTF-8 at the exact limit", async () => {
    const bytes = new TextEncoder().encode("Aé🌱");
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
          controller.close();
        },
      }),
      { headers: { "content-length": "1" } },
    );
    expect(await readBoundedText(response, bytes.length)).toBe("Aé🌱");
    expect(response.body?.locked).toBe(false);
  });

  it.each([
    undefined,
    "1",
    "invalid",
  ])("caps actual bytes despite Content-Length %s, cancels and unlocks the stream", async (length) => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([65, 65]));
          controller.enqueue(new Uint8Array([65, 65]));
        },
        cancel,
      }),
      { headers: length === undefined ? {} : { "content-length": length } },
    );
    await expect(readBoundedText(response, 3)).rejects.toThrow(ResponseBodyLimitError);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(response.body?.locked).toBe(false);
  });

  it("rejects an advertised oversized body without pulling it", async () => {
    const pull = vi.fn();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), {
      headers: { "content-length": "4" },
    });
    await expect(readBoundedText(response, 3)).rejects.toThrow(RangeError);
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    await expect(
      readBoundedText(new Response(null, { headers: { "content-length": "4" } }), 3),
    ).rejects.toThrow(RangeError);
  });

  it.each([
    [255],
    [0xc3],
    [0xc0, 0xaf],
    [0xed, 0xa0, 0x80],
  ])("rejects malformed or incomplete UTF-8 %j", async (...bytes) => {
    await expect(readBoundedText(new Response(new Uint8Array(bytes)), 10)).rejects.toThrow(
      TypeError,
    );
  });

  it("refuses an already aborted read even with no body", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    controller.abort(reason);
    await expect(readBoundedText(new Response(null), 0, controller.signal)).rejects.toBe(reason);
    const cancel = vi.fn();
    await expect(
      readBoundedText(new Response(new ReadableStream({ cancel })), 10, controller.signal),
    ).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("settles a pending read on abort even if underlying cancellation stalls", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream({ cancel }));
    const result = readBoundedText(response, 10, controller.signal);
    const rejected = expect(result).rejects.toBe(reason);
    controller.abort(reason);
    await rejected;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(response.body?.locked).toBe(false);
  });

  it("preserves stream failures and absorbs failed cancellation", async () => {
    const reason = new Error("stream failed");
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          controller.error(reason);
        },
      }),
    );
    await expect(readBoundedText(response, 10)).rejects.toBe(reason);
    const cancel = vi.fn().mockRejectedValue(reason);
    await expect(
      readBoundedText(new Response(new ReadableStream({ cancel })), 0, AbortSignal.abort(reason)),
    ).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalled();
  });

  it("removes the abort listener after a successful read", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    expect(await readBoundedText(new Response("ok"), 2, controller.signal)).toBe("ok");
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    controller.abort();
  });
});
