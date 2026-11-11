// AUTHORED-BY Claude Opus 5.5
import { expect, it, vi } from "vitest";

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

import { saveMimeType, saveNatively } from "../src/lib/native/save-file";

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
