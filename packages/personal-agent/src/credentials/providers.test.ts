// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { call, GOOGLE } from "./providers.js";

const LIMIT = 256 * 1024;
const invoke = (response: Response) =>
  call(async () => response, GOOGLE.token, {}, "token exchange");

describe("credential provider response buffering", () => {
  it.each([
    false,
    true,
  ])("cancels as soon as streamed bytes exceed the limit (cancel rejects: %s)", async (rejectCancel) => {
    let pulls = 0;
    const cancel = vi.fn(() => {
      if (rejectCancel) throw new Error("synthetic response body must stay private");
    });
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls++;
          controller.enqueue(new Uint8Array(pulls === 1 ? LIMIT : 1));
          if (pulls === 3) controller.close();
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const response = new Response(stream);
    const buffer = vi.spyOn(response, "arrayBuffer");
    await expect(invoke(response)).rejects.toThrow("token exchange: answer too large");
    expect(pulls).toBe(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(buffer).not.toHaveBeenCalled();
    expect(stream.locked).toBe(false);
  });

  it("rejects and cancels a single oversized chunk", async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(LIMIT + 1));
        },
        cancel,
      }),
    );
    await expect(invoke(response)).rejects.toThrow(/answer too large/);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("accepts exactly the byte limit and preserves the status", async () => {
    const body = `{"ok":true}${" ".repeat(LIMIT - 11)}`;
    expect(Buffer.byteLength(body)).toBe(LIMIT);
    await expect(invoke(new Response(body, { status: 400 }))).resolves.toEqual({
      status: 400,
      body: { ok: true },
    });
  });

  it("decodes multibyte UTF-8 split between chunks", async () => {
    const bytes = new TextEncoder().encode('{"message":"£"}');
    const split = bytes.indexOf(0xc2) + 1;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    });
    await expect(invoke(new Response(stream))).resolves.toEqual({
      status: 200,
      body: { message: "£" },
    });
  });

  it("maps stream failures to a body-free error and releases the reader", async () => {
    const stream = new ReadableStream({
      pull(controller) {
        controller.error(new Error("synthetic private provider body"));
      },
    });
    await expect(invoke(new Response(stream))).rejects.toThrow(
      "token exchange: the answer could not be read",
    );
    expect(stream.locked).toBe(false);
  });

  it("maps an already locked response body to the read error", async () => {
    const response = new Response("{}");
    const reader = response.body?.getReader();
    await expect(invoke(response)).rejects.toThrow("token exchange: the answer could not be read");
    reader?.releaseLock();
  });

  it.each([
    new Response(null),
    new Response("not JSON"),
  ])("maps empty or malformed JSON to the existing error", async (response) => {
    await expect(invoke(response)).rejects.toThrow("token exchange: unreadable answer (HTTP 200)");
  });
});
