// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import { call, GOOGLE } from "./providers.js";
import { HelperError } from "./store.js";

const LIMIT = 256 * 1024;
const enc = new TextEncoder();

function streamed(chunks: Uint8Array[], headers?: RequestInit["headers"], rejectCancel = false) {
  let consumed = 0;
  const cancel = vi.fn(() => {
    if (rejectCancel) throw new Error("synthetic cancellation failure");
  });
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const next = chunks[consumed++];
        if (next) controller.enqueue(next);
        else controller.close();
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  return { response: new Response(body, { headers }), cancel, consumed: () => consumed };
}

describe("credential provider response streaming", () => {
  it.each([
    undefined,
    { "content-length": "1" },
  ])("cancels immediately at the byte limit regardless of declared length (%j)", async (headers) => {
    const stream = streamed(
      [
        new Uint8Array(LIMIT / 2),
        new Uint8Array(LIMIT / 2),
        new Uint8Array(1),
        enc.encode("unread"),
      ],
      headers,
    );
    await expect(
      call(async () => stream.response, GOOGLE.token, {}, "token exchange"),
    ).rejects.toMatchObject({ code: "unavailable", message: "token exchange: answer too large" });
    expect(stream.consumed()).toBe(3);
    expect(stream.cancel).toHaveBeenCalledTimes(1);
    expect(stream.response.body?.locked).toBe(false);
  });

  it("reports the size error even if cancelling an oversized chunk fails", async () => {
    const stream = streamed([new Uint8Array(LIMIT + 1)], undefined, true);
    await expect(
      call(async () => stream.response, GOOGLE.token, {}, "token exchange"),
    ).rejects.toThrow("token exchange: answer too large");
    expect(stream.cancel).toHaveBeenCalledTimes(1);
    expect(stream.response.body?.locked).toBe(false);
  });

  it("accepts JSON exactly at the limit", async () => {
    const value = "x".repeat(LIMIT - 2);
    const bytes = enc.encode(JSON.stringify(value));
    const stream = streamed([bytes.subarray(0, 1000), bytes.subarray(1000)]);
    expect(await call(async () => stream.response, GOOGLE.token, {}, "token exchange")).toEqual({
      status: 200,
      body: value,
    });
    expect(stream.cancel).not.toHaveBeenCalled();
    expect(stream.response.body?.locked).toBe(false);
  });

  it("decodes UTF-8 split across chunk boundaries", async () => {
    const bytes = enc.encode(JSON.stringify({ value: "£☀" }));
    const stream = streamed([...bytes].map((byte) => new Uint8Array([byte])));
    expect(await call(async () => stream.response, GOOGLE.token, {}, "token exchange")).toEqual({
      status: 200,
      body: { value: "£☀" },
    });
  });

  it("counts encoded bytes rather than characters", async () => {
    const stream = streamed([enc.encode(JSON.stringify("£".repeat(LIMIT / 2)))]);
    await expect(
      call(async () => stream.response, GOOGLE.token, {}, "token exchange"),
    ).rejects.toThrow(/answer too large/);
    expect(stream.cancel).toHaveBeenCalledTimes(1);
  });

  it("sanitizes stream errors and releases the reader", async () => {
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          controller.error(new Error("synthetic response detail"));
        },
      }),
    );
    const error = await call(async () => response, GOOGLE.token, {}, "token exchange").catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(HelperError);
    expect(error).toMatchObject({
      code: "unavailable",
      message: "token exchange: the answer could not be read",
    });
    expect(response.body?.locked).toBe(false);
  });

  it.each([null, "invalid JSON"])("handles empty or invalid JSON safely (%j)", async (body) => {
    await expect(
      call(async () => new Response(body), GOOGLE.token, {}, "token exchange"),
    ).rejects.toThrow("token exchange: unreadable answer (HTTP 200)");
  });
});
