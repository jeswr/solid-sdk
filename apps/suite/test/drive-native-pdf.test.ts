// AUTHORED-BY Claude Opus 5.5
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { click, h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  readLimited: vi.fn<(url: string, limit: number) => Promise<Blob | undefined>>(),
  download: vi.fn(),
  openPdf: vi.fn<(plugin: unknown, name: string, bytes: Uint8Array) => Promise<void>>(),
  plugin: { pluginName: "SuiteFiles" },
}));
vi.mock("../src/apps/drive/state/drive-context", () => ({
  useDrive: () => ({ client: { readLimited: mocks.readLimited } }),
}));
vi.mock("../src/apps/drive/state/ui", () => ({
  useDriveActions: () => ({ download: mocks.download }),
}));
vi.mock("@jeswr/suite-native/capacitor", () => ({ filesPlugin: mocks.plugin }));
vi.mock("@jeswr/suite-native", () => ({ openPdf: mocks.openPdf }));

import { NativePdfHandoff, PDF_PREVIEW_LIMIT } from "../src/apps/drive/components/native-pdf";

const item = (size?: number) => ({
  url: "https://pod.example/drive/report.pdf",
  name: "report.pdf",
  kind: "file" as const,
  contentType: "application/pdf",
  ...(size === undefined ? {} : { size }),
});
const pdf = new Blob(["%PDF-1.7\n"], { type: "application/pdf" });

beforeEach(() => {
  mocks.readLimited.mockResolvedValue(pdf);
  mocks.openPdf.mockResolvedValue();
});
afterEach(() => vi.clearAllMocks());

const button = (host: HTMLElement, label: string) => {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
  if (!found) throw new Error(`no ${label} button in ${host.textContent}`);
  return found;
};

it("hands the bounded bytes and name to the platform viewer", async () => {
  const view = await mount(h(NativePdfHandoff, { item: item(9) }));
  expect(view.host.textContent).toContain("report.pdf");
  await click(button(view.host, "Open PDF"));
  expect(mocks.readLimited).toHaveBeenCalledWith(item().url, PDF_PREVIEW_LIMIT);
  expect(mocks.openPdf).toHaveBeenCalledWith(mocks.plugin, "report.pdf", expect.any(Uint8Array));
  expect(new TextDecoder().decode(mocks.openPdf.mock.calls[0]?.[2])).toBe("%PDF-1.7\n");
  // Ready to open again once the viewer has it.
  expect(button(view.host, "Open PDF").disabled).toBe(false);
});

it("refuses a file over the cap from its listing size without reading it", async () => {
  const view = await mount(h(NativePdfHandoff, { item: item(PDF_PREVIEW_LIMIT + 1) }));
  expect(view.host.textContent).toContain("Too large to preview; download it instead");
  expect(mocks.readLimited).not.toHaveBeenCalled();
  await click(button(view.host, "Download"));
  expect(mocks.download).toHaveBeenCalledWith(item(PDF_PREVIEW_LIMIT + 1));
});

it("refuses when the bounded read stops at the cap", async () => {
  mocks.readLimited.mockResolvedValue(undefined);
  const view = await mount(h(NativePdfHandoff, { item: item() }));
  await click(button(view.host, "Open PDF"));
  expect(view.host.textContent).toContain("Too large to preview");
  expect(mocks.openPdf).not.toHaveBeenCalled();
});

it.each([
  ["no-viewer", "No PDF viewer is installed; download it instead"],
  ["too-large", "Too large to preview; download it instead"],
  ["not-pdf", "Can't preview this file"],
  [undefined, "Can't preview this file"],
])("explains a %s refusal and offers the download", async (code, message) => {
  mocks.openPdf.mockRejectedValue(Object.assign(new Error("refused"), { code }));
  const view = await mount(h(NativePdfHandoff, { item: item(9) }));
  await click(button(view.host, "Open PDF"));
  expect(view.host.querySelector('[role="status"]')?.textContent).toBe(message);
  expect(button(view.host, "Download")).toBeDefined();
});

it("reports a failed read", async () => {
  mocks.readLimited.mockRejectedValue(null);
  const view = await mount(h(NativePdfHandoff, { item: item(9) }));
  await click(button(view.host, "Open PDF"));
  expect(view.host.textContent).toContain("Can't preview this file");
});

it("disables the button while the file is on its way", async () => {
  let finish!: () => void;
  mocks.openPdf.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const view = await mount(h(NativePdfHandoff, { item: item(9) }));
  await click(button(view.host, "Open PDF"));
  expect(button(view.host, "Opening").disabled).toBe(true);
  finish();
});
