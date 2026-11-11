// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";
import { saveFeedbackArchive } from "../src/feedback/download";

const saveNatively = vi.hoisted(() => vi.fn());
vi.mock("@/lib/native/save-file", () => ({ saveNatively }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("saves through the native sheet, preserving cancellation and errors without using a blob anchor", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", "native");
  saveNatively
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false)
    .mockRejectedValueOnce(new Error("save failed"));
  expect(await saveFeedbackArchive(new Uint8Array([1, 2]))).toBe(true);
  const [blob, name, mime] = saveNatively.mock.calls[0] ?? [];
  expect(name).toBe("solid-suite-feedback.zip");
  expect(mime).toBe("application/zip");
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
  expect(await saveFeedbackArchive(new Uint8Array())).toBe(false);
  await expect(saveFeedbackArchive(new Uint8Array())).rejects.toThrow("save failed");
});
it("downloads on web and revokes the object URL", async () => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", "web");
  const anchor = { href: "", download: "", click: vi.fn() };
  vi.stubGlobal("document", { createElement: vi.fn().mockReturnValue(anchor) });
  const url = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:feedback");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  expect(await saveFeedbackArchive(new Uint8Array([1]))).toBe(true);
  expect(anchor.href).toBe("blob:feedback");
  expect(anchor.download).toBe("solid-suite-feedback.zip");
  expect(anchor.click).toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(revoke).toHaveBeenCalledWith("blob:feedback");
  url.mockRestore();
  revoke.mockRestore();
});
