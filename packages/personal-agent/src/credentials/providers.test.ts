// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { call, GOOGLE } from "./providers.js";
import { HelperError } from "./store.js";

const LIMIT = 256 * 1024;
const invoke = (response: Response) =>
  call(async () => response, GOOGLE.token, {}, "token exchange");

describe("credential provider response buffering", () => {
  it.each([
    [false, undefined],
    [true, undefined],
    [false, { "content-length": "1" }],
  ] as const)("cancels as soon as streamed bytes exceed the limit (cancel rejects: %s, headers: %j)", async (rejectCancel, headers) => {
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
    const response = new Response(stream, { headers });
    const buffer = vi.spyOn(response, "arrayBuffer");
    await expect(invoke(response)).rejects.toMatchObject({
      code: "unavailable",
      message: "token exchange: answer too large",
    });
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

  it("counts encoded bytes rather than characters", async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify("£".repeat(LIMIT / 2))));
        },
        cancel,
      }),
    );
    await expect(invoke(response)).rejects.toThrow(/answer too large/);
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it("accepts exactly the byte limit and preserves the status", async () => {
    const body = `{"ok":true}${" ".repeat(LIMIT - 11)}`;
    expect(Buffer.byteLength(body)).toBe(LIMIT);
    const bytes = new TextEncoder().encode(body);
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 1000));
          controller.enqueue(bytes.subarray(1000));
          controller.close();
        },
        cancel,
      }),
      { status: 400 },
    );
    await expect(invoke(response)).resolves.toEqual({
      status: 400,
      body: { ok: true },
    });
    expect(cancel).not.toHaveBeenCalled();
    expect(response.body?.locked).toBe(false);
  });

  it("decodes multibyte UTF-8 split between chunks", async () => {
    const bytes = new TextEncoder().encode('{"message":"£☀"}');
    const stream = new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    await expect(invoke(new Response(stream))).resolves.toEqual({
      status: 200,
      body: { message: "£☀" },
    });
  });

  it("maps stream failures to a body-free error and releases the reader", async () => {
    const stream = new ReadableStream({
      pull(controller) {
        controller.error(new Error("synthetic private provider body"));
      },
    });
    const error = await invoke(new Response(stream)).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(HelperError);
    expect(error).toMatchObject({
      code: "unavailable",
      message: "token exchange: the answer could not be read",
    });
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
