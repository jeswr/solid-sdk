// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import { MAX_FILE_BYTES } from "../core/file-import.js";
import { fileImport, memoryFile } from "../core/testing.js";
import { garminFileAdapter } from "./file-adapter.js";

it("caps actual Garmin upload bytes even when the host's declared file size is wrong", async () => {
  const block = new Uint8Array(1024 * 1024).fill(32);
  const cancel = vi.fn();
  const file = {
    ...memoryFile("Activities.csv", ""),
    text: vi.fn(async () => {
      throw new Error("Must use bounded stream");
    }),
    stream: () =>
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            controller.enqueue(block);
          },
          cancel,
        },
        { highWaterMark: 0 },
      ),
  };
  expect(MAX_FILE_BYTES).toBe(64 * 1024 * 1024);
  await expect(fileImport(garminFileAdapter, file)).rejects.toThrow("64 MiB import limit");
  expect(file.text).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledOnce();
});
