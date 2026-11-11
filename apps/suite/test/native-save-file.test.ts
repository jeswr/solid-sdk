// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex (GPT-6.1 Sol)
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  shareFiles: vi.fn(),
  staging: { pluginName: "SuiteShareStaging" },
  share: { pluginName: "Share" },
}));
vi.mock("@jeswr/suite-native/capacitor", () => ({
  shareStagingPlugin: mocks.staging,
  sharePlugin: mocks.share,
}));
vi.mock("@jeswr/suite-native", () => ({ shareFiles: mocks.shareFiles }));

import { saveBlob, saveMimeType, saveNatively } from "../src/lib/native/save-file";

it.each([
  ["application/pdf", "application/pdf"],
  ["Text/Plain; charset=utf-8", "text/plain"],
  ["image/svg+xml", "image/svg+xml"],
  [undefined, "application/octet-stream"],
  ["", "application/octet-stream"],
  ["not a type", "application/octet-stream"],
  ["text/html\r\nX: y", "application/octet-stream"],
] as const)("uses the bare media type of %j", (input, expected) => {
  expect(saveMimeType(input)).toBe(expected);
});

it("stages the file and opens the native share sheet", async () => {
  mocks.shareFiles.mockResolvedValue({ completed: true });
  const blob = new Blob(["hello"]);
  await expect(saveNatively(blob, "report.txt", "text/plain; charset=utf-8")).resolves.toBe(true);
  expect(mocks.shareFiles).toHaveBeenCalledWith(
    [{ blob, name: "report.txt", mimeType: "text/plain" }],
    { title: "report.txt" },
    { staging: mocks.staging, native: mocks.share },
  );
});

it("resolves false when the share sheet is dismissed", async () => {
  mocks.shareFiles.mockResolvedValue({ completed: false });
  await expect(saveNatively(new Blob(["x"]), "x.txt")).resolves.toBe(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
});

it("saves blobs natively, preserving dismissal and errors without browser downloads", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", "native");
  const url = vi.spyOn(URL, "createObjectURL");
  mocks.shareFiles
    .mockResolvedValueOnce({ completed: true })
    .mockResolvedValueOnce({ completed: false })
    .mockRejectedValueOnce(new Error("save failed"));
  const blob = new Blob(["hello"]);
  await expect(saveBlob(blob, "hello.txt", "text/plain")).resolves.toBe(true);
  expect(mocks.shareFiles).toHaveBeenCalledWith(
    [{ blob, name: "hello.txt", mimeType: "text/plain" }],
    { title: "hello.txt" },
    { staging: mocks.staging, native: mocks.share },
  );
  await expect(saveBlob(blob, "hello.txt")).resolves.toBe(false);
  await expect(saveBlob(blob, "hello.txt")).rejects.toThrow("save failed");
  expect(url).not.toHaveBeenCalled();
});

it.each([
  false,
  true,
])("revokes browser download URLs even if the click fails (%s)", async (fails) => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", "web");
  const click = vi.fn(() => {
    if (fails) throw new Error("download failed");
  });
  const anchor = { href: "", download: "", click };
  vi.stubGlobal("document", { createElement: vi.fn().mockReturnValue(anchor) });
  const url = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:export");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const blob = new Blob(["export"]);
  const saving = saveBlob(blob, "export.csv", "text/csv");
  if (fails) await expect(saving).rejects.toThrow("download failed");
  else await expect(saving).resolves.toBe(true);
  expect(url).toHaveBeenCalledWith(blob);
  expect(anchor).toMatchObject({ href: "blob:export", download: "export.csv" });
  expect(click).toHaveBeenCalledOnce();
  expect(mocks.shareFiles).not.toHaveBeenCalled();
  expect(revoke).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:export");
});
