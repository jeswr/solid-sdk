// AUTHORED-BY Codex (GPT-6.1 Sol)
import { afterEach, expect, it, vi } from "vitest";
import { saveFeedbackArchive } from "../src/feedback/download";
import { saveBlob } from "../src/lib/native/save-file";

vi.mock("@/lib/native/save-file", () => ({ saveBlob: vi.fn() }));
afterEach(() => vi.clearAllMocks());
it("passes the ZIP bytes to the shared saver and preserves cancellation and errors", async () => {
  vi.mocked(saveBlob)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false)
    .mockRejectedValueOnce(new Error("save failed"));
  expect(await saveFeedbackArchive(new Uint8Array([1, 2]))).toBe(true);
  const [blob, name, mime] = vi.mocked(saveBlob).mock.calls[0] ?? [];
  expect(name).toBe("solid-suite-feedback.zip");
  expect(mime).toBe("application/zip");
  expect(blob?.type).toBe("application/zip");
  if (!blob) throw new Error("Missing archive blob");
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
  expect(await saveFeedbackArchive(new Uint8Array())).toBe(false);
  await expect(saveFeedbackArchive(new Uint8Array())).rejects.toThrow("save failed");
});
