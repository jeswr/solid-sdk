// AUTHORED-BY Codex GPT-6.1-Sol
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MountEngine, SheetEngine, WorkbookService } from "../src/apps/sheets/lib/contract";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";
import { harness, snapshot } from "./sheets-workbook-helpers";
import { cellsXml, fixture } from "./sheets-xlsx-fixtures";

const mocks = vi.hoisted(() => ({
  service: null as WorkbookService | null,
  session: null as { fetch: typeof fetch; storageUrl: string; webId: string } | null,
  mount: vi.fn<MountEngine>(),
  push: vi.fn(),
  toast: { error: vi.fn() },
}));
vi.mock("@/lib/session/pod-session", () => ({
  usePodSessionState: () => ({ status: "ready", session: mocks.session }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@/components/interim-shell/suite-frame", () => ({
  SuiteFrame: ({
    children,
    context,
    actions,
    sidebar,
  }: {
    children: ReactNode;
    context: ReactNode;
    actions: ReactNode;
    sidebar: ReactNode;
  }) => h("main", {}, sidebar, context, actions, children),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<typeof import("@jeswr/suite-ui")>()),
  toast: mocks.toast,
}));
vi.mock("../src/apps/sheets/state/service", () => ({ useWorkbookService: () => mocks.service }));
vi.mock("../src/apps/sheets/lib/engine", () => ({ loadEngine: async () => mocks.mount }));

import { SheetEditor } from "../src/apps/sheets/components/sheet-editor";
import { SheetsSidebar, workbookHref } from "../src/apps/sheets/components/sheets-sidebar";
import { CellCommentStore, type CellThread } from "../src/apps/sheets/lib/comments/store";
import { readXlsx } from "../src/apps/sheets/lib/xlsx";

function button(label: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
async function choose(file?: File) {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Import file"]');
  if (!input) throw new Error("Missing import input");
  Object.defineProperty(input, "files", { value: file ? [file] : [], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(input.value).toBe("");
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("DOMParser", window.DOMParser);
  vi.stubGlobal("matchMedia", window.matchMedia);
  const pod = await harness();
  mocks.service = pod.service;
  mocks.session = { ...pod.options, storageUrl: pod.options.podRoot };
  mocks.mount.mockImplementation(async (_host, options) => {
    let loading = options.commentsLoading ?? false;
    return {
      snapshot: vi.fn(() => options.snapshot),
      load: vi.fn(),
      onChange: vi.fn(() => () => {}),
      setDark: vi.fn(),
      setReadOnly: vi.fn(),
      dispose: vi.fn(),
      exportCsv: vi.fn(() => ""),
      activeSheet: vi.fn(() => ({ id: "sheet1", name: "Data" })),
      setCommentsLoading: vi.fn((value) => {
        loading = value;
      }),
      importCsv: vi.fn<SheetEngine["importCsv"]>(() =>
        loading ? { status: "blocked", reason: "comments-loading" } : { status: "imported" },
      ),
    } satisfies SheetEngine;
  });
});
afterEach(() => vi.restoreAllMocks());

it("disables CSV import during the initial comment load", async () => {
  const comments = deferred<CellThread[]>();
  vi.spyOn(CellCommentStore.prototype, "list").mockReturnValue(comments.promise);
  const service = mocks.service as WorkbookService;
  const book = await service.create({ title: "Loading", snapshot: snapshot() });
  const ui = await mount(h(SheetEditor, { container: book.container }));
  await vi.waitFor(() => expect(mocks.mount).toHaveBeenCalled());
  await key(button("File"), "ArrowDown");
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    (element) => element.textContent === "Import CSV",
  );
  expect(item?.getAttribute("aria-disabled")).toBe("true");
  await act(async () => comments.resolve([]));
  expect(item?.getAttribute("aria-disabled")).toBeNull();
  await ui.unmount();
});

it.each([
  "list",
  "permissions",
] as const)("releases CSV import after a rejected comments %s load", async (method) => {
  const comments = deferred<never>();
  vi.spyOn(CellCommentStore.prototype, method).mockReturnValue(comments.promise);
  const service = mocks.service as WorkbookService;
  const book = await service.create({ title: "Failed comments", snapshot: snapshot() });
  const ui = await mount(h(SheetEditor, { container: book.container }));
  await vi.waitFor(() => expect(mocks.mount).toHaveBeenCalled());
  await key(button("File"), "ArrowDown");
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    (element) => element.textContent === "Import CSV",
  );
  if (!item) throw new Error("Missing CSV import item");
  expect(item.getAttribute("aria-disabled")).toBe("true");
  await act(async () => comments.reject(new Error("Comments unavailable")));
  expect(item.getAttribute("aria-disabled")).toBeNull();
  await click(item);
  expect(document.querySelector("fieldset")?.disabled).toBe(false);
  expect(button("Choose CSV file").disabled).toBe(false);
  await ui.unmount();
});

async function chooseCsv(read: Promise<string>) {
  await key(button("File"), "ArrowDown");
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    (element) => element.textContent === "Import CSV",
  );
  if (!item) throw new Error("Missing CSV import item");
  await click(item);
  const input = document.querySelector<HTMLInputElement>('input[aria-label="CSV file to import"]');
  if (!input) throw new Error("Missing CSV input");
  const file = new File(["Label\nChosen"], "chosen.csv", { type: "text/csv" });
  vi.spyOn(file, "text").mockReturnValueOnce(read);
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  Object.defineProperty(input, "value", {
    value: "chosen.csv",
    writable: true,
    configurable: true,
  });
  await act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
  return { file, input };
}

it("imports a chosen CSV while a focus refresh reloads comments", async () => {
  // Only the first comments load locks editing; a later refresh rebases late
  // anchors from the workbook revision, so an import may proceed meanwhile.
  const service = mocks.service as WorkbookService;
  const book = await service.create({ title: "Refresh", snapshot: snapshot() });
  const ui = await mount(h(SheetEditor, { container: book.container }));
  await vi.waitFor(() => expect(mocks.mount).toHaveBeenCalled());
  const engine = await mocks.mount.mock.results[0]?.value;
  const read = deferred<string>();
  await chooseCsv(read.promise);
  const comments = deferred<CellThread[]>();
  vi.spyOn(CellCommentStore.prototype, "list").mockReturnValueOnce(comments.promise);
  await act(() => window.dispatchEvent(new Event("focus")));
  await act(async () => read.resolve("Label\nChosen"));
  expect(engine?.importCsv).toHaveBeenLastCalledWith("Label\nChosen", {
    mode: "new-sheet",
    name: "chosen",
  });
  expect(engine?.importCsv).toHaveReturnedWith({ status: "imported" });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => comments.resolve([]));
  await ui.unmount();
});

it("preserves a chosen CSV and retries when the engine reports comments loading", async () => {
  const service = mocks.service as WorkbookService;
  const book = await service.create({ title: "Blocked", snapshot: snapshot() });
  const ui = await mount(h(SheetEditor, { container: book.container }));
  await vi.waitFor(() => expect(mocks.mount).toHaveBeenCalled());
  const engine = await mocks.mount.mock.results[0]?.value;
  engine?.importCsv.mockReturnValueOnce({ status: "blocked", reason: "comments-loading" });
  const read = deferred<string>();
  const { file, input } = await chooseCsv(read.promise);
  await act(async () => read.resolve("Label\nChosen"));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Comments are loading. Try importing again when they finish.",
  );
  expect(input.files?.[0]).toBe(file);
  expect(input.value).toBe("chosen.csv");
  expect(button("Retry import").disabled).toBe(false);
  await click(button("Retry import"));
  expect(engine?.importCsv).toHaveBeenLastCalledWith("Label\nChosen", {
    mode: "new-sheet",
    name: "chosen",
  });
  expect(engine?.importCsv).toHaveLastReturnedWith({ status: "imported" });
  expect(input.value).toBe("");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await ui.unmount();
});

it.each([
  "report.XLSX",
  "report.bin",
])("imports %s as Excel by extension or MIME and navigates", async (name) => {
  const ui = await mount(h(SheetsSidebar));
  const bytes = fixture({ "xl/worksheets/data.xml": cellsXml('<c r="A1"><v>42</v></c>') });
  const service = mocks.service as WorkbookService;
  const create = vi.spyOn(service, "createFromXlsx");
  await click(button("Import file"));
  expect(document.querySelector("input")?.accept).toContain(".xlsx");
  await choose(
    new File([new Uint8Array(bytes)], name, {
      type: name.endsWith("bin")
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "",
    }),
  );
  await vi.waitFor(() => expect(mocks.push).toHaveBeenCalled());
  const book = await create.mock.results[0]?.value;
  if (!book) throw new Error("Missing imported workbook");
  expect(create).toHaveBeenCalledWith({ title: name.replace(/\.xlsx$/i, ""), data: bytes });
  expect(mocks.push).toHaveBeenCalledWith(workbookHref(book.container));
  expect(book.metadata.sheets).toEqual([{ number: 1, name: "Data" }]);
  expect(book.snapshot.sheets).toMatchObject({ sheet1: { cellData: { 0: { 0: { v: 42 } } } } });
  await ui.unmount();
});

it.each([
  ["broken.xlsx", "Couldn't read this Excel file. Choose a valid .xlsx file."],
  ["macro.xlsm", "Couldn't import this Excel file"],
  ["offline.xlsx", "Couldn't import this Excel file"],
])("shows an Excel failure toast for %s", async (name, message) => {
  if (name === "offline.xlsx")
    vi.spyOn(mocks.service as WorkbookService, "createFromXlsx").mockRejectedValueOnce(
      new Error("offline"),
    );
  const ui = await mount(h(SheetsSidebar));
  await choose(new File(["invalid"], name));
  await vi.waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(message));
  expect(mocks.push).not.toHaveBeenCalled();
  await ui.unmount();
});

it("keeps CSV import, empty selection and CSV failure behavior", async () => {
  const ui = await mount(h(SheetsSidebar));
  await choose();
  expect(mocks.push).not.toHaveBeenCalled();
  await choose(new File(["Label\nvalue"], "original.csv", { type: "text/csv" }));
  await vi.waitFor(() => expect(mocks.push).toHaveBeenCalled());
  vi.spyOn(mocks.service as WorkbookService, "createFromCsv").mockRejectedValueOnce(
    new Error("offline"),
  );
  await choose(new File(["a"], "bad.csv"));
  await vi.waitFor(() =>
    expect(mocks.toast.error).toHaveBeenCalledWith("Couldn't import this CSV"),
  );
  await ui.unmount();
});

it("downloads the current engine snapshot as Excel from File", async () => {
  const service = mocks.service as WorkbookService;
  const book = await service.create({
    title: "Export / report",
    snapshot: snapshot("Title\nData", true),
  });
  const ui = await mount(h(SheetEditor, { container: book.container }));
  await vi.waitFor(() => expect(mocks.mount).toHaveBeenCalled());
  const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:excel");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  let downloaded = "";
  vi.spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloaded = this.download;
  });
  await key(button("File"), "ArrowDown");
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    (element) => element.textContent === "Download as Excel (.xlsx)",
  );
  if (!item) throw new Error("Missing Excel download item");
  await click(item);
  await vi.waitFor(() => expect(createUrl).toHaveBeenCalledOnce());
  expect(downloaded).toBe("Export - report.xlsx");
  const blob = createUrl.mock.calls[0]?.[0] as Blob;
  expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const exported = readXlsx(new Uint8Array(await blob.arrayBuffer()), { title: "Export" });
  expect(exported.sheetOrder).toEqual(["sheet1", "sheet2"]);
  expect(exported.sheets).toMatchObject({ sheet1: { name: "Data" }, sheet2: { name: "Other" } });
  await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:excel"));
  await ui.unmount();
});

// File size is metadata: reject before allocating a file buffer or calling the service.
it.each([
  "too-large.xlsx",
  "too-large.bin",
])("refuses oversized Excel file %s before reading it", async (name) => {
  const ui = await mount(h(SheetsSidebar));
  const file = new File(["tiny"], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  Object.defineProperty(file, "size", { value: 50 * 1024 * 1024 + 1 });
  const buffer = vi.spyOn(file, "arrayBuffer");
  const create = vi.spyOn(mocks.service as WorkbookService, "createFromXlsx");
  await choose(file);
  expect(mocks.toast.error).toHaveBeenCalledWith("Excel files must be 50 MiB or smaller");
  expect(buffer).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(mocks.push).not.toHaveBeenCalled();
  await ui.unmount();
});
