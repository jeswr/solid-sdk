// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test, vi } from "vitest";
import { readJsonLines } from "./json-lines.js";

test("JSON lines bound complete records as well as partial buffers", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`${"x".repeat(1_048_577)}\n`));
    },
  });
  const reader = stream.getReader();
  await expect(readJsonLines(reader, () => true, vi.fn())).rejects.toThrow("line too large");
  expect(stream.locked).toBe(false);
  await stream.cancel();
});

test("JSON lines stop delivery after cancellation during a read or from a frame observer", async () => {
  let current = true;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const emit = vi.fn();
  const read = readJsonLines(stream.getReader(), () => current, emit);
  current = false;
  controller.enqueue(new TextEncoder().encode("{}\n"));
  await read;
  expect(emit).not.toHaveBeenCalled();
  expect(stream.locked).toBe(false);
  await stream.cancel();
  current = true;
  const next = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode("{}\n{}\n"));
    },
  });
  const close = vi.fn(() => {
    current = false;
  });
  await readJsonLines(next.getReader(), () => current, close);
  expect(close).toHaveBeenCalledTimes(1);
  await next.cancel();
});

test("JSON lines retain byte-split UTF-8/JSON, skip invalid and blank lines, and flush the final record", async () => {
  const text = `\nmalformed\r\n${JSON.stringify({ id: "café", type: "Update" })}\r\n${JSON.stringify({ id: "last" })}`;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of new TextEncoder().encode(text)) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const frames: unknown[] = [];
  await readJsonLines(
    stream.getReader(),
    () => true,
    (frame) => frames.push(frame),
  );
  expect(frames).toEqual([{ id: "café", type: "Update" }, { id: "last" }]);
  expect(stream.locked).toBe(false);
});

test.each([
  "oversized",
  "utf8",
  "read",
])("JSON lines reject %s without retaining the reader lock", async (mode) => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (mode === "oversized") controller.enqueue(new TextEncoder().encode("x".repeat(1_048_577)));
      if (mode === "utf8") controller.enqueue(Uint8Array.of(255));
      if (mode === "read") controller.error(new Error("read failed"));
    },
  });
  await expect(readJsonLines(stream.getReader(), () => true, vi.fn())).rejects.toThrow();
  expect(stream.locked).toBe(false);
  if (mode !== "read") await stream.cancel();
});
