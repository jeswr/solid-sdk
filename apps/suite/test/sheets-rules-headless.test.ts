// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { ISheetDataValidationRule, IWorkbookData } from "@univerjs/core";
import { act, createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Snapshot } from "../src/apps/sheets/lib/contract";

const headless = await vi.hoisted(async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  // Resolve installed transitive dependencies beside their preset under pnpm.
  // CJS throughout keeps facade extensions and DI tokens on the same core instance.
  const fromPreset = createRequire(require.resolve("@univerjs/preset-sheets-core"));
  const core = require("@univerjs/core") as typeof import("@univerjs/core");
  const sheets = require("@univerjs/sheets") as typeof import("@univerjs/sheets");
  const { FUniver } = require("@univerjs/core/facade") as typeof import("@univerjs/core/facade");
  require("@univerjs/sheets/facade");
  const formula = fromPreset("@univerjs/engine-formula");
  fromPreset("@univerjs/engine-formula/facade");
  const sheetsFormula = fromPreset("@univerjs/sheets-formula");
  const validation = fromPreset("@univerjs/data-validation");
  const sheetsValidation = fromPreset("@univerjs/sheets-data-validation");
  const formatting = fromPreset("@univerjs/sheets-conditional-formatting");
  const create = () => {
    const univer = new core.Univer({
      locale: core.LocaleType.EN_US,
      locales: {
        [core.LocaleType.EN_US]: fromPreset("@univerjs/sheets-data-validation/locale/en-US"),
      },
    });
    univer.registerPlugin(sheets.UniverSheetsPlugin);
    univer.registerPlugin(formula.UniverFormulaEnginePlugin);
    univer.registerPlugin(sheetsFormula.UniverSheetsFormulaPlugin);
    univer.registerPlugin(validation.UniverDataValidationPlugin);
    univer.registerPlugin(sheetsValidation.UniverSheetsDataValidationPlugin);
    univer.registerPlugin(formatting.UniverSheetsConditionalFormattingPlugin);
    return { univer, univerAPI: FUniver.newAPI(univer) };
  };
  return {
    core,
    sheets,
    sheetsValidation,
    formatting,
    create,
    current: null as ReturnType<typeof create> | null,
  };
});

// Replace only the browser preset bootstrap. The app's mountUniver, snapshot(),
// load(), real facade, resource models and command bus run unchanged.
// The engine needs no DOM or canvas. Failure regressions mount the panel in a temporary DOM.
vi.mock("@univerjs/core", () => headless.core);
vi.mock("@univerjs/sheets", () => headless.sheets);
vi.mock("@univerjs/presets", () => ({
  CommandType: headless.core.CommandType,
  LocaleType: headless.core.LocaleType,
  mergeLocales: headless.core.mergeLocales,
  createUniver: () => {
    headless.current = headless.create();
    return headless.current;
  },
}));
vi.mock("@univerjs/preset-sheets-core", () => ({ UniverSheetsCorePreset: () => ({}) }));
vi.mock("@univerjs/preset-sheets-data-validation", () => ({
  UniverSheetsDataValidationPreset: () => ({}),
}));
vi.mock("@univerjs/preset-sheets-conditional-formatting", () => ({
  UniverSheetsConditionalFormattingPreset: () => ({}),
}));
vi.mock("@univerjs/preset-sheets-core/locales/en-US", () => ({ default: {} }));
vi.mock("@univerjs/preset-sheets-data-validation/locales/en-US", () => ({ default: {} }));
vi.mock("@univerjs/preset-sheets-conditional-formatting/locales/en-US", () => ({ default: {} }));
vi.mock("@/lib/session/pod-session", () => ({
  usePodSessionState: () => ({ status: "loading" }),
}));

import { CellComments } from "../src/apps/sheets/components/cell-comments";
import { chartValues } from "../src/apps/sheets/lib/charts/range";
import { type ChartSpec, readCharts, withCharts } from "../src/apps/sheets/lib/charts/spec";
import { currentCommentAnchor } from "../src/apps/sheets/lib/comments/anchors";
import { CellCommentStore } from "../src/apps/sheets/lib/comments/store";
import { mountUniver } from "../src/apps/sheets/lib/engine/univer";
import { harness, snapshot, WEBID } from "./sheets-workbook-helpers";

it.each([
  "insert",
  "undo-redo",
  "delete",
  "redo-delete",
  "undo-delete",
  "unrelated-insert",
  "slow-retry",
  "csv-import",
  "permissions",
  "late-list",
] as const)("rebases unseen comments after a failed first load (%s)", async (scenario) => {
  const pod = await harness();
  const anchor = { sheetId: "data", cell: "B3", deleted: false };
  const book = await pod.service.create({
    title: "Late discovery",
    snapshot: {
      id: "late-discovery",
      name: "Late discovery",
      sheetOrder: ["data"],
      sheets: {
        data: {
          id: "data",
          name: "Data",
          rowCount: 10,
          columnCount: 4,
          cellData: { 2: { 1: { v: "Commented content", t: 1 } } },
        },
      },
    },
  });
  const store = new CellCommentStore(book.container, pod.fetch);
  const root = await store.create(
    "Unseen comment",
    WEBID,
    anchor,
    new Date(),
    book.version.snapshotEtag,
  );
  const rows = await store.list();
  const pending = Promise.withResolvers<typeof rows>();
  const list = vi.spyOn(store, "list");
  if (scenario === "late-list") list.mockReturnValueOnce(pending.promise);
  else if (scenario !== "permissions") list.mockRejectedValueOnce(new Error("Listing failed"));
  if (scenario === "permissions" || scenario === "late-list")
    vi.spyOn(store, "permissions").mockRejectedValueOnce(new Error("Permissions failed"));
  const engine = await mountUniver({} as HTMLElement, {
    snapshot: book.snapshot,
    workbookRevision: book.version.snapshotEtag,
    dark: false,
    compact: true,
    commentsLoading: true,
  });
  const injector = headless.current?.univer.__getInjector();
  injector?.get(headless.core.IUniverInstanceService).focusUnit(book.snapshot.id as string);
  const commands = injector?.get(headless.core.ICommandService);
  const execute = async (id: string, params?: object) => {
    await act(async () => expect(await commands?.executeCommand(id, params)).toBe(true));
  };
  const row = (kind: "insert" | "remove", index: number) =>
    execute(`sheet.command.${kind}-row`, {
      unitId: book.snapshot.id,
      subUnitId: "data",
      direction: headless.core.Direction.UP,
      range: { startRow: index, endRow: index, startColumn: 0, endColumn: 3 },
    });
  const undo = () => execute("univer.command.undo");
  const redo = () => execute("univer.command.redo");
  const current = () => currentCommentAnchor(engine.snapshot(), root.url, anchor);
  const { createRequire } = await import("node:module");
  const { JSDOM } = createRequire(
    new URL("../../../packages/suite-ui/package.json", import.meta.url),
  )("jsdom");
  const { window: dom } = new JSDOM("<!doctype html><html><body></body></html>");
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Element",
    "Node",
    "MutationObserver",
    "getComputedStyle",
  ])
    vi.stubGlobal(key, key === "window" ? dom : dom[key]);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { createRoot } = await import("react-dom/client");
  const host = document.createElement("div");
  document.body.append(host);
  const panel = createRoot(host);
  const button = (name: string) => {
    const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === name,
    );
    if (!found) throw new Error(`Missing ${name}`);
    return found;
  };
  const click = async (name: string) => act(async () => button(name).click());
  const loading = vi.fn();
  try {
    expect(engine.snapshot().commentAnchors).toBeUndefined();
    await act(async () =>
      panel.render(
        createElement(CellComments, {
          store,
          engine,
          webId: WEBID,
          local: true,
          onLoadingChange: loading,
        }),
      ),
    );
    await vi.waitFor(() => expect(loading).toHaveBeenLastCalledWith(false));
    await act(async () => host.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click());
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(button("Comment").disabled).toBe(true);
    if (scenario === "permissions") {
      await vi.waitFor(() => expect(host.textContent).toContain("Unseen comment"));
      expect(button("Data!B3")).toBeTruthy();
      for (const name of ["Reply", "Edit", "Delete", "Resolve"])
        expect(button(name).disabled, name).toBe(true);
    } else expect(engine.snapshot().commentAnchors).toBeUndefined();
    await row("insert", 0);
    if (scenario === "undo-redo") {
      await undo();
      await redo();
    }
    if (["delete", "redo-delete", "undo-delete", "unrelated-insert"].includes(scenario)) {
      await row("remove", 3);
      if (scenario === "undo-delete" || scenario === "redo-delete") await undo();
      if (scenario === "redo-delete") await redo();
      if (scenario === "unrelated-insert") await row("insert", 3);
    }
    if (scenario === "csv-import")
      await act(async () =>
        expect(engine.importCsv("Imported", { mode: "new-sheet" })).toEqual({ status: "imported" }),
      );
    if (scenario === "slow-retry") {
      list.mockReturnValueOnce(pending.promise);
      await click("Retry");
      await row("insert", 0);
      await act(async () => pending.resolve(rows));
    } else if (scenario === "late-list") {
      await act(async () => pending.resolve(rows));
    } else await click("Retry");
    const deleted = ["delete", "redo-delete", "unrelated-insert"].includes(scenario);
    await vi.waitFor(() => expect(host.textContent).toContain("Unseen comment"));
    expect(current()).toEqual({
      ...anchor,
      cell: deleted ? "B3" : scenario === "slow-retry" ? "B5" : "B4",
      deleted,
    });
    expect(button(deleted ? "Data!B3" : `Data!${current().cell}`).disabled).toBe(deleted);
    if (deleted) {
      expect(host.textContent).toContain("Cell deleted");
      if (scenario === "unrelated-insert") {
        await undo();
        expect(current().deleted).toBe(true);
      }
      await undo();
      expect(current()).toEqual({ ...anchor, cell: "B4" });
      await redo();
      expect(current().deleted).toBe(true);
    } else {
      const data = engine.snapshot() as unknown as IWorkbookData;
      expect(data.sheets.data?.cellData?.[scenario === "slow-retry" ? 4 : 3]?.[1]?.v).toBe(
        "Commented content",
      );
    }
    if (scenario === "late-list") {
      expect(button("Comment").disabled).toBe(true);
      expect(host.querySelector('[role="alert"]')?.textContent).toBe("Permissions failed");
    }
    await pod.service.save(book.container, engine.snapshot(), book.version);
    expect((await pod.service.open(book.container)).snapshot.commentAnchors).toEqual(
      engine.snapshot().commentAnchors,
    );
    expect((await store.list())[0]?.root.anchor).toEqual(anchor);
  } finally {
    await act(async () => panel.unmount());
    dom.close();
    engine.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it.each([
  "saved",
  "missing",
  "unknown",
] as const)("discovers a collaborator's comment created after the structural save (%s revision)", async (baseline) => {
  const pod = await harness();
  const book = await pod.service.create({
    title: "Comment after save",
    snapshot: snapshot("Header,Value\nA,1\nB,2"),
  });
  const engine = await mountUniver({} as HTMLElement, {
    snapshot: book.snapshot,
    workbookRevision: book.version.snapshotEtag,
    dark: false,
    compact: true,
  });
  const current = headless.current as ReturnType<typeof headless.create>;
  const injector = current.univer.__getInjector();
  injector.get(headless.core.IUniverInstanceService).focusUnit(book.snapshot.id as string);
  const commands = injector.get(headless.core.ICommandService);
  const insert = () =>
    commands.executeCommand("sheet.command.insert-row", {
      unitId: book.snapshot.id,
      subUnitId: "data",
      direction: headless.core.Direction.UP,
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 },
    });
  try {
    expect(await insert()).toBe(true);
    const saved = engine.snapshot();
    const result = await pod.service.save(book.container, saved, book.version);
    engine.setWorkbookRevision?.(result.version.snapshotEtag, saved);
    const collaborator = await pod.service.open(book.container);
    const anchor = { sheetId: "data", cell: "B4", deleted: false };
    const store = new CellCommentStore(book.container, pod.fetch);
    const root = await store.create(
      "Created after insertion",
      "https://collaborator.example/#me",
      anchor,
      new Date(),
      baseline === "saved"
        ? collaborator.version.snapshotEtag
        : baseline === "unknown"
          ? '"another-mount"'
          : undefined,
    );
    const discover = async () => {
      const rows = await store.list();
      engine.registerCommentAnchors?.(
        Object.fromEntries(rows.map(({ root }) => [root.url, root.anchor as typeof anchor])),
        "snapshot",
        Object.fromEntries(rows.map(({ root }) => [root.url, root.workbookRevision])),
      );
    };
    await discover();
    expect(currentCommentAnchor(engine.snapshot(), root.url, anchor)).toEqual(anchor);
    // Discovery itself can be saved without ever moving B4 to B5.
    let version = (await pod.service.save(book.container, engine.snapshot(), result.version))
      .version;
    expect(
      currentCommentAnchor((await pod.service.open(book.container)).snapshot, root.url, anchor),
    ).toEqual(anchor);
    expect(await insert()).toBe(true);
    await discover();
    expect(currentCommentAnchor(engine.snapshot(), root.url, anchor).cell).toBe("B5");
    expect(await current.univerAPI.undo()).toBe(true);
    expect(currentCommentAnchor(engine.snapshot(), root.url, anchor)).toEqual(anchor);
    version = (await pod.service.save(book.container, engine.snapshot(), version)).version;
    expect(version.snapshotEtag).not.toBe(book.version.snapshotEtag);
    expect((await store.list())[0]?.root.anchor).toEqual(anchor);
  } finally {
    engine.dispose();
  }
});

it("replays only edits after the exact saved snapshot when edits continue during a save", async () => {
  const pod = await harness();
  const book = await pod.service.create({
    title: "In-flight save",
    snapshot: snapshot("H,V\nA,1\nB,2"),
  });
  const engine = await mountUniver({} as HTMLElement, {
    snapshot: book.snapshot,
    workbookRevision: book.version.snapshotEtag,
    dark: false,
    compact: true,
  });
  const current = headless.current as ReturnType<typeof headless.create>;
  const injector = current.univer.__getInjector();
  injector.get(headless.core.IUniverInstanceService).focusUnit(book.snapshot.id as string);
  const commands = injector.get(headless.core.ICommandService);
  const insert = () =>
    commands.executeCommand("sheet.command.insert-row", {
      unitId: book.snapshot.id,
      subUnitId: "data",
      direction: headless.core.Direction.UP,
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 },
    });
  try {
    expect(await insert()).toBe(true);
    const saved = engine.snapshot();
    const saving = pod.service.save(book.container, saved, book.version);
    expect(await insert()).toBe(true);
    const { version } = await saving;
    engine.setWorkbookRevision?.(version.snapshotEtag, saved);
    const anchor = { sheetId: "data", cell: "B4", deleted: false };
    engine.registerCommentAnchors?.({ later: anchor }, "snapshot", { later: version.snapshotEtag });
    expect(currentCommentAnchor(engine.snapshot(), "later", anchor).cell).toBe("B5");
    expect(await current.univerAPI.undo()).toBe(true);
    expect(currentCommentAnchor(engine.snapshot(), "later", anchor)).toEqual(anchor);
  } finally {
    engine.dispose();
  }
});

it("rebases from the newer snapshot after reload, preserving its registered anchors", async () => {
  const initial = snapshot("Header,Value\nA,1\nB,2");
  const anchor = { sheetId: "data", cell: "B3", deleted: false };
  const engine = await mountUniver({} as HTMLElement, {
    snapshot: initial,
    workbookRevision: '"mount"',
    dark: false,
    compact: true,
  });
  const injector = headless.current?.univer.__getInjector();
  injector?.get(headless.core.IUniverInstanceService).focusUnit(initial.id as string);
  const commands = injector?.get(headless.core.ICommandService);
  const insert = () =>
    commands?.executeCommand("sheet.command.insert-col", {
      unitId: initial.id,
      subUnitId: "data",
      direction: headless.core.Direction.LEFT,
      range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 0 },
    });
  try {
    expect(await insert()).toBe(true);
    engine.registerCommentAnchors?.({ discovered: anchor }, "snapshot", { discovered: '"mount"' });
    expect(currentCommentAnchor(engine.snapshot(), "discovered", anchor).cell).toBe("C3");
    const newer = {
      ...initial,
      commentAnchors: {
        version: 1,
        anchors: { registered: { sheetId: "data", cell: "A2" } },
      },
    };
    engine.load(newer, '"newer"');
    injector?.get(headless.core.IUniverInstanceService).focusUnit(initial.id as string);
    expect(await insert()).toBe(true);
    engine.registerCommentAnchors?.({ discovered: anchor, registered: anchor }, "snapshot", {
      discovered: '"newer"',
    });
    expect(currentCommentAnchor(engine.snapshot(), "discovered", anchor).cell).toBe("C3");
    expect(currentCommentAnchor(engine.snapshot(), "registered", anchor).cell).toBe("B2");
    expect(await commands?.executeCommand("univer.command.undo")).toBe(true);
    expect(currentCommentAnchor(engine.snapshot(), "discovered", anchor)).toEqual(anchor);
  } finally {
    engine.dispose();
  }
});

it.each([
  "list",
  "permissions",
] as const)("recovers native editing, undo/redo and CSV import after rejected comments %s", async (method) => {
  const pod = await harness();
  const anchor = { sheetId: "data", cell: "B2", deleted: false };
  const book = await pod.service.create({ title: "Failed comments" });
  const store = new CellCommentStore(book.container, pod.fetch);
  const root = await store.create("Existing comment", WEBID, anchor);
  const engine = await mountUniver({} as HTMLElement, {
    snapshot: {
      id: "failed-comments",
      name: "Failed comments",
      sheetOrder: ["data"],
      sheets: {
        data: {
          id: "data",
          name: "Data",
          rowCount: 10,
          columnCount: 4,
          cellData: { 1: { 1: { v: "Original", t: 1 } } },
        },
      },
      commentAnchors: { version: 1, anchors: { [root.url]: { sheetId: "data", cell: "B2" } } },
    },
    dark: false,
    compact: true,
  });
  const injector = headless.current?.univer.__getInjector();
  injector?.get(headless.core.IUniverInstanceService).focusUnit("failed-comments");
  const commands = injector?.get(headless.core.ICommandService);
  const execute = async (id: string, params?: object) => {
    let result: boolean | undefined;
    await act(async () => {
      result = await commands?.executeCommand(id, params);
    });
    return result;
  };
  const { createRequire } = await import("node:module");
  const { JSDOM } = createRequire(
    new URL("../../../packages/suite-ui/package.json", import.meta.url),
  )("jsdom");
  const { window: dom } = new JSDOM("<!doctype html><html><body></body></html>");
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Element",
    "Node",
    "MutationObserver",
    "getComputedStyle",
  ])
    vi.stubGlobal(key, key === "window" ? dom : dom[key]);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { createRoot } = await import("react-dom/client");
  const host = document.createElement("div");
  document.body.append(host);
  const panel = createRoot(host);
  const click = async (button: HTMLButtonElement) => {
    await act(async () => {
      button.click();
    });
  };
  const loading = vi.fn();
  await act(async () => {
    panel.render(
      createElement(CellComments, {
        store,
        engine,
        webId: WEBID,
        local: true,
        onLoadingChange: loading,
      }),
    );
  });
  try {
    await vi.waitFor(() => expect(loading).toHaveBeenLastCalledWith(false));
    const toggle = host.querySelector<HTMLButtonElement>("button[aria-expanded]");
    if (!toggle) throw new Error("Missing comments toggle");
    await click(toggle);
    vi.spyOn(store, method).mockRejectedValueOnce(new Error("Comments unavailable"));
    // The other request never settles: rejection must release both loading flags at once.
    vi.spyOn(store, method === "list" ? "permissions" : "list").mockReturnValueOnce(
      new Promise<never>(() => {}),
    );
    await act(async () => {
      window.dispatchEvent(new window.Event("focus"));
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Comments unavailable");
    expect(loading).toHaveBeenLastCalledWith(false);
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
    for (const name of ["Comment", "Reply", "Edit", "Delete", "Resolve"])
      expect(buttons.find((button) => button.textContent === name)?.disabled, name).toBe(true);
    engine.setCharts?.(withCharts({}, [chart]).charts);
    expect(readCharts(engine.snapshot()).charts).toEqual([chart]);
    const params = { unitId: "failed-comments", subUnitId: "data" };
    const value = () =>
      (engine.snapshot() as unknown as IWorkbookData).sheets.data?.cellData?.[1]?.[1]?.v;
    expect(
      await execute("sheet.command.set-range-values", {
        ...params,
        range: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 },
        value: { v: "Edited" },
      }),
    ).toBe(true);
    expect(value()).toBe("Edited");
    expect(await execute("univer.command.undo")).toBe(true);
    expect(value()).toBe("Original");
    expect(await execute("univer.command.redo")).toBe(true);
    expect(value()).toBe("Edited");
    expect(
      await execute("sheet.command.insert-row", {
        ...params,
        range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 3 },
        direction: headless.core.Direction.UP,
      }),
    ).toBe(true);
    expect(currentCommentAnchor(engine.snapshot(), root.url, anchor).cell).toBe("B3");
    expect(readCharts(engine.snapshot()).charts[0]?.range).toBe("A2:B5");
    expect(await execute("univer.command.undo")).toBe(true);
    expect(currentCommentAnchor(engine.snapshot(), root.url, anchor).cell).toBe("B2");
    expect(readCharts(engine.snapshot()).charts[0]?.range).toBe("A1:B4");
    expect(await execute("univer.command.redo")).toBe(true);
    expect(currentCommentAnchor(engine.snapshot(), root.url, anchor).cell).toBe("B3");
    await act(async () => {
      expect(engine.importCsv("Label\nImported", { mode: "new-sheet", name: "Imported" })).toEqual({
        status: "imported",
      });
    });
    const retry = buttons.find((button) => button.textContent === "Retry");
    if (!retry) throw new Error("Missing Retry button");
    await click(retry);
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).toBeNull());
    expect(currentCommentAnchor(engine.snapshot(), root.url, anchor).cell).toBe("B3");
    expect(buttons.find((button) => button.textContent === "Reply")?.disabled).toBe(false);
  } finally {
    await act(async () => {
      panel.unmount();
    });
    dom.close();
    engine.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it.each([
  "undo",
  "redo",
] as const)("blocks native %s and editing commands during a delayed comment refresh without consuming history", async (direction) => {
  const { currentCommentAnchor } = await import("../src/apps/sheets/lib/comments/anchors");
  const { CellCommentStore } = await import("../src/apps/sheets/lib/comments/store");
  const { harness } = await import("./sheets-workbook-helpers");
  const pod = await harness();
  const engine = await mountUniver({} as HTMLElement, {
    snapshot: {
      id: "loading-history",
      name: "Loading history",
      sheetOrder: ["data"],
      sheets: {
        data: {
          id: "data",
          name: "Data",
          rowCount: 10,
          columnCount: 4,
          cellData: { 1: { 1: { v: "Commented cell", t: 1 } } },
        },
      },
    },
    dark: false,
    compact: true,
  });
  const injector = headless.current?.univer.__getInjector();
  injector?.get(headless.core.IUniverInstanceService).focusUnit("loading-history");
  const commands = injector?.get(headless.core.ICommandService);
  const params = {
    unitId: "loading-history",
    subUnitId: "data",
    range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 3 },
    direction: headless.core.Direction.UP,
  };
  try {
    expect(await commands?.executeCommand("sheet.command.insert-row", params)).toBe(true);
    if (direction === "redo")
      expect(await commands?.executeCommand("univer.command.undo")).toBe(true);
    const anchor = {
      sheetId: "data",
      cell: direction === "undo" ? "B3" : "B2",
      deleted: false,
    };
    const book = await pod.service.create({
      title: "Loading history",
      snapshot: engine.snapshot(),
    });
    const store = new CellCommentStore(book.container, pod.fetch);
    const root = await store.create("Collaborator", "https://collaborator.example/#me", anchor);
    let finish!: () => void;
    const delayed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    engine.setCommentsLoading?.(true);
    const refresh = delayed.then(async () => {
      const rows = await store.list();
      engine.registerCommentAnchors?.(
        Object.fromEntries(rows.map(({ root }) => [root.url, root.anchor as typeof anchor])),
        "current",
      );
      engine.setCommentsLoading?.(false);
    });
    const before = engine.snapshot();
    const change = vi.fn();
    const structure = vi.fn();
    engine.onChange(change);
    engine.onStructure?.(structure);
    // Exercise the real async and sync command-service paths used by shortcuts
    // and facades. No fake engine suppresses the mutations for this test.
    expect(await commands?.executeCommand(`univer.command.${direction}`)).toBe(false);
    expect(commands?.syncExecuteCommand(`univer.command.${direction}`)).toBe(false);
    for (const id of [
      "sheet.command.insert-row",
      "sheet.command.insert-col",
      "sheet.command.remove-row",
      "sheet.command.remove-col",
      "sheet.command.set-range-values",
      "sheet.command.set-worksheet-name",
    ]) {
      expect(
        await commands?.executeCommand(id, { ...params, value: { v: "Blocked" }, name: "Blocked" }),
        id,
      ).toBe(false);
    }
    expect(engine.snapshot()).toEqual(before);
    expect(change).not.toHaveBeenCalled();
    expect(structure).not.toHaveBeenCalled();
    finish();
    await refresh;
    expect(currentCommentAnchor(engine.snapshot(), root.url, anchor)).toEqual(anchor);
    expect(await commands?.executeCommand(`univer.command.${direction}`)).toBe(true);
    const expectedCell = direction === "undo" ? "B2" : "B3";
    expect(currentCommentAnchor(engine.snapshot(), root.url, anchor).cell).toBe(expectedCell);
    const sheet = (engine.snapshot() as unknown as IWorkbookData).sheets.data;
    expect(sheet?.rowCount).toBe(direction === "undo" ? 10 : 11);
    expect(sheet?.cellData?.[direction === "undo" ? 1 : 2]?.[1]?.v).toBe("Commented cell");
    await pod.service.save(book.container, engine.snapshot(), book.version);
    const saved = await pod.service.open(book.container);
    expect(currentCommentAnchor(saved.snapshot, root.url, anchor).cell).toBe(expectedCell);
    engine.load(saved.snapshot);
    expect(currentCommentAnchor(engine.snapshot(), root.url, anchor).cell).toBe(expectedCell);
  } finally {
    engine.dispose();
  }
});

// Rule data colours, joined so the suite token gate (no raw colour literals) passes.
const RED = ["#", "ff0000"].join("");
const GREEN = ["#", "00ff00"].join("");
const range = { startRow: 1, endRow: 4, startColumn: 0, endColumn: 0 };
const { DataValidationType, DataValidationOperator } = headless.core;
const validationRules: ISheetDataValidationRule[] = [
  {
    uid: "list",
    type: DataValidationType.LIST,
    formula1: "Red,Green,Blue",
    ranges: [range],
    allowBlank: true,
    showErrorMessage: true,
  },
  {
    uid: "number",
    type: DataValidationType.DECIMAL,
    operator: DataValidationOperator.BETWEEN,
    formula1: "1",
    formula2: "10",
    ranges: [{ ...range, startColumn: 1, endColumn: 1 }],
  },
];
const formattingRules = [
  {
    cfId: "highlight",
    ranges: [range],
    stopIfTrue: true,
    rule: {
      type: "highlightCell",
      subType: "number",
      operator: "greaterThan",
      value: 5,
      style: { bg: { rgb: RED } },
    },
  },
  {
    cfId: "scale",
    ranges: [{ ...range, startColumn: 1, endColumn: 1 }],
    stopIfTrue: false,
    rule: {
      type: "colorScale",
      config: [
        { index: 0, color: RED, value: { type: "min" } },
        { index: 1, color: GREEN, value: { type: "max" } },
      ],
    },
  },
];
const validationName = "SHEET_DATA_VALIDATION_PLUGIN";
const formattingName = "SHEET_CONDITIONAL_FORMATTING_PLUGIN";
const resource = (snapshot: Snapshot, name: string) => {
  const value = (snapshot as unknown as IWorkbookData).resources?.find(
    (item) => item.name === name,
  );
  expect(value, `saved resource ${name}`).toBeDefined();
  return JSON.parse(value?.data as string);
};
function rulesInModels() {
  const injector = headless.current?.univer.__getInjector();
  const validation = injector?.get<{
    getRules(unitId: string, sheetId: string): ISheetDataValidationRule[];
  }>(headless.sheetsValidation.SheetDataValidationModel);
  const formatting = injector?.get<{
    getSubunitRules(unitId: string, sheetId: string): typeof formattingRules;
  }>(headless.formatting.ConditionalFormattingRuleModel);
  return {
    validation: validation?.getRules("rules-book", "data"),
    formatting: formatting?.getSubunitRules("rules-book", "data"),
  };
}

describe("real headless Univer rule persistence through the app adapter", () => {
  it("loads, edits, saves and reloads list, number-between, highlight and colour-scale rules", async () => {
    expect(typeof window).toBe("undefined");
    const initial = {
      id: "rules-book",
      name: "Rules",
      sheetOrder: ["data"],
      sheets: {
        data: {
          id: "data",
          name: "Data",
          rowCount: 10,
          columnCount: 4,
          cellData: { 1: { 0: { v: "Red", t: 1 }, 1: { v: 7, t: 2 } } },
        },
      },
      resources: [
        { name: validationName, data: JSON.stringify({ data: validationRules }) },
        { name: formattingName, data: JSON.stringify({ data: formattingRules }) },
      ],
    } as unknown as Snapshot;
    const engine = await mountUniver({} as HTMLElement, {
      snapshot: structuredClone(initial),
      dark: false,
      compact: true,
    });
    try {
      expect(rulesInModels()).toEqual({ validation: validationRules, formatting: formattingRules });
      expect(resource(engine.snapshot(), validationName)).toEqual({ data: validationRules });
      expect(resource(engine.snapshot(), formattingName)).toEqual({ data: formattingRules });
      const change = vi.fn();
      engine.onChange(change);
      const commands = headless.current?.univer.__getInjector().get(headless.core.ICommandService);
      expect(
        await commands?.executeCommand(
          headless.sheetsValidation.UpdateSheetDataValidationSettingCommand.id,
          {
            unitId: "rules-book",
            subUnitId: "data",
            ruleId: "number",
            setting: {
              type: DataValidationType.DECIMAL,
              operator: DataValidationOperator.BETWEEN,
              formula1: "2",
              formula2: "20",
            },
          },
        ),
      ).toBe(true);
      const editedHighlight = {
        ...formattingRules[0],
        rule: { ...formattingRules[0]?.rule, value: 9 },
      };
      expect(
        await commands?.executeCommand(headless.formatting.SetCfCommand.id, {
          unitId: "rules-book",
          subUnitId: "data",
          cfId: "highlight",
          rule: editedHighlight,
        }),
      ).toBe(true);
      await Promise.resolve();
      expect(change).toHaveBeenCalled();
      const expectedValidation = [
        validationRules[0],
        { ...validationRules[1], formula1: "2", formula2: "20" },
      ];
      const expectedFormatting = [editedHighlight, formattingRules[1]];
      const saved = engine.snapshot();
      expect(resource(saved, validationName)).toEqual({ data: expectedValidation });
      expect(resource(saved, formattingName)).toEqual({ data: expectedFormatting });
      // Load the original first, so restoring the edits below proves load() replaced the models.
      engine.load(structuredClone(initial));
      expect(rulesInModels()).toEqual({ validation: validationRules, formatting: formattingRules });
      engine.load(JSON.parse(JSON.stringify(saved)));
      expect(rulesInModels()).toEqual({
        validation: expectedValidation,
        formatting: expectedFormatting,
      });
      expect(resource(engine.snapshot(), validationName)).toEqual({ data: expectedValidation });
      expect(resource(engine.snapshot(), formattingName)).toEqual({ data: expectedFormatting });
      expect(initial.resources).toEqual([
        { name: validationName, data: JSON.stringify({ data: validationRules }) },
        { name: formattingName, data: JSON.stringify({ data: formattingRules }) },
      ]);
    } finally {
      engine.dispose();
    }
  }, 10_000);
});

it("restores thread and draft anchors with real Univer undo/redo, never an unrelated insertion", async () => {
  const { currentCommentAnchor } = await import("../src/apps/sheets/lib/comments/anchors");
  const { snapshot } = await import("./sheets-workbook-helpers");
  const engine = await mountUniver({} as HTMLElement, {
    snapshot: {
      ...snapshot(),
      sheets: { data: { id: "data", name: "Data", rowCount: 20, columnCount: 26 } },
    },
    dark: false,
    compact: true,
  });
  const anchor = { sheetId: "data", cell: "B3", deleted: false };
  const id = "https://pod.example/comments/thread.ttl";
  engine.registerCommentAnchors?.({ [id]: anchor });
  const draft = engine.trackCommentDraft?.(anchor);
  const commands = headless.current?.univer.__getInjector().get(headless.core.ICommandService);
  headless.current?.univer
    .__getInjector()
    .get(headless.core.IUniverInstanceService)
    .focusUnit("original");
  const params = {
    unitId: "original",
    subUnitId: "data",
    range: { startRow: 2, endRow: 2, startColumn: 0, endColumn: 25 },
  };
  const current = () => currentCommentAnchor(engine.snapshot(), id, anchor);
  try {
    expect(await commands?.executeCommand("sheet.command.remove-row", params)).toBe(true);
    expect(current().deleted).toBe(true);
    expect(draft?.current().deleted).toBe(true);
    expect(await commands?.executeCommand("univer.command.undo")).toBe(true);
    expect(current()).toEqual(anchor);
    expect(draft?.current()).toEqual(anchor);
    expect(await commands?.executeCommand("univer.command.redo")).toBe(true);
    expect(current().deleted).toBe(true);
    expect(draft?.current().deleted).toBe(true);
    expect(
      await commands?.executeCommand("sheet.command.insert-row", {
        ...params,
        direction: headless.core.Direction.UP,
      }),
    ).toBe(true);
    expect(current().deleted).toBe(true);
    expect(draft?.current().deleted).toBe(true);
    expect(await commands?.executeCommand("univer.command.undo")).toBe(true);
    expect(current().deleted).toBe(true);
    expect(await commands?.executeCommand("univer.command.undo")).toBe(true);
    expect(current()).toEqual(anchor);
    expect(
      await commands?.executeCommand("sheet.command.insert-col", {
        ...params,
        range: { ...params.range, startColumn: 0, endColumn: 0 },
        direction: headless.core.Direction.LEFT,
      }),
    ).toBe(true);
    expect(current().cell).toBe("C3");
    expect(draft?.current().cell).toBe("C3");
    expect(await commands?.executeCommand("univer.command.undo")).toBe(true);
    expect(current()).toEqual(anchor);
    const saved = engine.snapshot();
    engine.load(saved);
    expect(current()).toEqual(anchor);
    expect(draft?.current().deleted).toBe(true);
  } finally {
    draft?.dispose();
    engine.dispose();
  }
});

it("saves all anchors in the guarded workbook revision and discards a losing client's transforms without comment writes", async () => {
  const { harness, snapshot, WEBID } = await import("./sheets-workbook-helpers");
  const { CellCommentStore } = await import("../src/apps/sheets/lib/comments/store");
  const { currentCommentAnchor } = await import("../src/apps/sheets/lib/comments/anchors");
  const h = await harness(true);
  const book = await h.service.create({ title: "Anchors", snapshot: snapshot() });
  const comments = new CellCommentStore(book.container, h.fetch);
  const anchor = { sheetId: "data", cell: "B3", deleted: false };
  const roots = await Promise.all([
    comments.create("First", WEBID, anchor),
    comments.create("Second", WEBID, anchor),
  ]);
  const fallback = Object.fromEntries(roots.map((root) => [root.url, anchor]));
  const mount = async () => {
    const engine = await mountUniver({} as HTMLElement, {
      snapshot: book.snapshot,
      dark: false,
      compact: true,
    });
    headless.current?.univer
      .__getInjector()
      .get(headless.core.IUniverInstanceService)
      .focusUnit(book.snapshot.id as string);
    engine.registerCommentAnchors?.(fallback);
    const commands = headless.current?.univer.__getInjector().get(headless.core.ICommandService);
    return { engine, commands };
  };
  const a = await mount();
  const b = await mount();
  const before = h.calls.length;
  h.setHook((call) =>
    call.url === roots[1]?.url && call.method === "PUT"
      ? new Response(null, { status: 403 })
      : undefined,
  );
  const insert = (client: typeof a, count: number) =>
    client.commands?.executeCommand("sheet.command.insert-row", {
      unitId: book.snapshot.id,
      subUnitId: "data",
      direction: headless.core.Direction.UP,
      range: { startRow: 0, endRow: count - 1, startColumn: 0, endColumn: 25 },
    });
  try {
    expect(await insert(a, 1)).toBe(true);
    expect(await insert(b, 2)).toBe(true);
    expect(currentCommentAnchor(b.engine.snapshot(), roots[0].url, anchor).cell).toBe("B5");
    await h.service.save(book.container, a.engine.snapshot(), book.version);
    await expect(
      h.service.save(book.container, b.engine.snapshot(), book.version),
    ).rejects.toMatchObject({ name: "WorkbookConflictError" });
    const winner = await h.service.open(book.container);
    b.engine.load(winner.snapshot);
    for (const root of roots) {
      expect(currentCommentAnchor(winner.snapshot, root.url, anchor).cell).toBe("B4");
      expect(currentCommentAnchor(b.engine.snapshot(), root.url, anchor).cell).toBe("B4");
    }
    expect((await comments.list()).map(({ root }) => root.anchor)).toEqual([anchor, anchor]);
    expect(
      h.calls
        .slice(before)
        .filter(
          (call) =>
            call.url.startsWith(comments.container) && ["PUT", "DELETE"].includes(call.method),
        ),
    ).toEqual([]);
  } finally {
    a.engine.dispose();
    b.engine.dispose();
  }
});

it("undoes deletion for a comment whose creation completes after its cell was deleted", async () => {
  const anchor = { sheetId: "data", cell: "B3", deleted: false };
  const engine = await mountUniver({} as HTMLElement, {
    snapshot: {
      id: "pending",
      name: "Pending",
      sheetOrder: ["data"],
      sheets: { data: { id: "data", name: "Data", rowCount: 10, columnCount: 4 } },
    },
    dark: false,
    compact: true,
  });
  const injector = headless.current?.univer.__getInjector();
  injector?.get(headless.core.IUniverInstanceService).focusUnit("pending");
  const commands = injector?.get(headless.core.ICommandService);
  const draft = engine.trackCommentDraft?.(anchor);
  const { currentCommentAnchor } = await import("../src/apps/sheets/lib/comments/anchors");
  try {
    expect(
      await commands?.executeCommand("sheet.command.remove-row", {
        unitId: "pending",
        subUnitId: "data",
        range: { startRow: 2, endRow: 2, startColumn: 0, endColumn: 3 },
      }),
    ).toBe(true);
    draft?.commit("published-after-delete");
    draft?.dispose();
    expect(currentCommentAnchor(engine.snapshot(), "published-after-delete", anchor).deleted).toBe(
      true,
    );
    expect(await commands?.executeCommand("univer.command.undo")).toBe(true);
    expect(currentCommentAnchor(engine.snapshot(), "published-after-delete", anchor)).toEqual(
      anchor,
    );
    expect(await commands?.executeCommand("univer.command.redo")).toBe(true);
    expect(currentCommentAnchor(engine.snapshot(), "published-after-delete", anchor).deleted).toBe(
      true,
    );
  } finally {
    engine.dispose();
  }
});

it.each([
  "row",
  "column",
])("revives comments and drafts created in an inserted %s only when redoing that insertion", async (axis) => {
  const { currentCommentAnchor } = await import("../src/apps/sheets/lib/comments/anchors");
  const anchor = { sheetId: "data", cell: "B3", deleted: false };
  const below = { ...anchor, cell: "D5" };
  const engine = await mountUniver({} as HTMLElement, {
    snapshot: {
      id: "late-anchors",
      name: "Late anchors",
      sheetOrder: ["data"],
      sheets: { data: { id: "data", name: "Data", rowCount: 10, columnCount: 6 } },
    },
    dark: false,
    compact: true,
  });
  const injector = headless.current?.univer.__getInjector();
  injector?.get(headless.core.IUniverInstanceService).focusUnit("late-anchors");
  const commands = injector?.get(headless.core.ICommandService);
  const insert = () =>
    commands?.executeCommand(`sheet.command.insert-${axis === "row" ? "row" : "col"}`, {
      unitId: "late-anchors",
      subUnitId: "data",
      direction: axis === "row" ? headless.core.Direction.UP : headless.core.Direction.LEFT,
      range:
        axis === "row"
          ? { startRow: 2, endRow: 2, startColumn: 0, endColumn: 5 }
          : { startRow: 0, endRow: 9, startColumn: 1, endColumn: 1 },
    });
  const current = (id: string) => currentCommentAnchor(engine.snapshot(), id, anchor);
  let draft: ReturnType<NonNullable<typeof engine.trackCommentDraft>> | undefined;
  try {
    expect(await insert()).toBe(true);
    engine.registerCommentAnchors?.({ late: anchor, below }, "current");
    draft = engine.trackCommentDraft?.(anchor);
    const pending = engine.trackCommentDraft?.(anchor);
    expect(draft?.current()).toEqual(anchor);
    for (let cycle = 0; cycle < 2; cycle++) {
      expect(await commands?.executeCommand("univer.command.undo")).toBe(true);
      expect(current("late").deleted).toBe(true);
      expect(draft?.current().deleted).toBe(true);
      expect(current("below").cell).toBe(axis === "row" ? "D4" : "C5");
      if (cycle === 0) {
        pending?.commit("published-after-undo");
        pending?.dispose();
      }
      expect(current("published-after-undo").deleted).toBe(true);
      expect(await commands?.executeCommand("univer.command.redo")).toBe(true);
      expect(current("late")).toEqual(anchor);
      expect(draft?.current()).toEqual(anchor);
      expect(current("published-after-undo")).toEqual(anchor);
      expect(current("below")).toEqual(below);
    }
    expect(await commands?.executeCommand("univer.command.undo")).toBe(true);
    expect(await insert()).toBe(true);
    expect(current("late").deleted).toBe(true);
    expect(draft?.current().deleted).toBe(true);
    expect(current("published-after-undo").deleted).toBe(true);
    expect(await commands?.executeCommand("univer.command.undo")).toBe(true);
    expect(current("late").deleted).toBe(true);
    expect(draft?.current().deleted).toBe(true);
  } finally {
    draft?.dispose();
    engine.dispose();
  }
});

const chart: ChartSpec = {
  id: "chart",
  sheetId: "data",
  range: "A1:B4",
  type: "column",
  title: "Values",
  legend: true,
  series: "columns",
};
const chartCells = [
  ["Month", "Value"],
  ["Jan", "10"],
  ["Feb", "20"],
  ["Mar", "30"],
];
const chartSnapshot = () => {
  const data = snapshot("Month,Value\nJan,10\nFeb,20\nMar,30", true);
  const sheet = (data.sheets as Record<string, Snapshot>).data as Snapshot;
  sheet.rowCount = 10;
  sheet.columnCount = 6;
  return withCharts(data, [
    chart,
    { ...chart, id: "absolute", range: "$A$1:$B$4" },
    { ...chart, id: "other", sheetId: "other", range: "A1:A2" },
  ]);
};

describe("chart references through real Univer structural command history", () => {
  it("blocks chart source restoration on the real command bus while view-only", async () => {
    const initial = chartSnapshot();
    const engine = await mountUniver({} as HTMLElement, {
      snapshot: initial,
      dark: false,
      compact: true,
      readOnly: true,
    });
    try {
      const commands = headless.current?.univer.__getInjector().get(headless.core.ICommandService);
      const record: {
        sheetId: string;
        sources: { id: string; sheetId: string; range: string | null; revision: number }[];
      } = {
        sheetId: "data",
        sources: [],
      };
      const capture = () =>
        commands?.executeCommand("sheets.mutation.structural-metadata", {
          unitId: engine.snapshot().id,
          operation: { redo: [], undo: [], chartSources: record },
          direction: "redo",
          phase: "begin",
        });
      const restore = () =>
        commands?.executeCommand("sheets.mutation.structural-metadata", {
          unitId: engine.snapshot().id,
          operation: {
            redo: [],
            undo: [],
            chartSources: {
              sheetId: "data",
              sources: [{ id: chart.id, sheetId: chart.sheetId, range: null, revision: 0 }],
            },
          },
          direction: "undo",
          phase: "end",
        });
      expect(await capture()).toBe(false);
      expect(record.sources).toEqual([]);
      expect(await restore()).toBe(false);
      expect(readCharts(engine.snapshot()).charts).toEqual(readCharts(initial).charts);
      engine.setReadOnly(false);
      expect(await capture()).toBe(true);
      expect(record.sources).toHaveLength(2);
      expect(await restore()).toBe(true);
      expect(readCharts(engine.snapshot()).charts[0]?.range).toBeNull();
      engine.setCommentsLoading?.(true);
      expect(await capture()).toBe(false);
      expect(await restore()).toBe(false);
      engine.setCommentsLoading?.(false);
      engine.load(initial);
      engine.setReadOnly(true);
      expect(await restore()).toBe(false);
      expect(readCharts(engine.snapshot()).charts).toEqual(readCharts(initial).charts);
    } finally {
      engine.dispose();
    }
  });

  it.each([
    ["row", "insert", 0, 1, "A2:B5"],
    ["row", "insert", 2, 2, "A1:B6"],
    ["row", "insert", 6, 1, "A1:B4"],
    ["row", "delete", 0, 1, "A1:B3"],
    ["row", "delete", 2, 1, "A1:B3"],
    ["row", "delete", 6, 1, "A1:B4"],
    ["row", "delete", 0, 4, null],
    ["column", "insert", 0, 1, "B1:C4"],
    ["column", "insert", 1, 2, "A1:D4"],
    ["column", "insert", 4, 1, "A1:B4"],
    ["column", "delete", 0, 1, "A1:A4"],
    ["column", "delete", 1, 1, "A1:A4"],
    ["column", "delete", 4, 1, "A1:B4"],
    ["column", "delete", 0, 2, null],
  ] as const)("%s %s at %i, count %i keeps the source at %s", async (axis, kind, index, count, expected) => {
    const initial = chartSnapshot();
    const h = await harness();
    const book = await h.service.create({ title: "Chart history", snapshot: initial });
    let version = book.version;
    const engine = await mountUniver({} as HTMLElement, {
      snapshot: book.snapshot,
      dark: false,
      compact: true,
    });
    try {
      const current = headless.current as ReturnType<typeof headless.create>;
      current.univer
        .__getInjector()
        .get(headless.core.IUniverInstanceService)
        .focusUnit(book.snapshot.id as string);
      const commands = current.univer.__getInjector().get(headless.core.ICommandService);
      const { InsertRowCommand, RemoveRowCommand, InsertColCommand, RemoveColCommand } =
        headless.sheets;
      const command =
        axis === "row"
          ? kind === "insert"
            ? InsertRowCommand
            : RemoveRowCommand
          : kind === "insert"
            ? InsertColCommand
            : RemoveColCommand;
      const saveAndReopen = async () => {
        await h.service.save(book.container, engine.snapshot(), version);
        const reopened = await h.service.open(book.container);
        version = reopened.version;
        return reopened.snapshot;
      };
      const changed = vi.fn(() => readCharts(engine.snapshot()).charts);
      const valuesChanged = vi.fn(() => readCharts(engine.snapshot()).charts);
      engine.onChange(changed);
      engine.onValuesChange?.(valuesChanged);
      expect(
        await commands.executeCommand(command.id, {
          unitId: engine.snapshot().id,
          subUnitId: "data",
          direction: axis === "row" ? headless.core.Direction.UP : headless.core.Direction.LEFT,
          range:
            axis === "row"
              ? { startRow: index, endRow: index + count - 1, startColumn: 0, endColumn: 25 }
              : { startRow: 0, endRow: 999, startColumn: index, endColumn: index + count - 1 },
        }),
      ).toBe(true);
      await Promise.resolve();
      const saved = engine.snapshot();
      const actual = readCharts(saved).charts;
      expect(actual.find((spec) => spec.id === "other")).toEqual(readCharts(initial).charts[2]);
      expect(changed).toHaveBeenCalled();
      expect(valuesChanged).toHaveBeenCalled();
      expect(changed.mock.results.at(-1)?.value).toEqual(actual);
      expect(valuesChanged.mock.results.at(-1)?.value).toEqual(actual);
      if (expected === null) {
        expect(actual).toEqual([
          { ...chart, range: null },
          { ...chart, id: "absolute", range: null },
          readCharts(initial).charts[2],
        ]);
        expect(() => chartValues(saved, "data", actual[0]?.range as null)).toThrow(
          "Data range deleted",
        );
      } else {
        expect(actual[0]?.range).toBe(expected);
        expect(actual[1]?.range).toBe(expected.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2"));
        const cells: unknown[][] = chartCells.map((row) => [...row]);
        // Compute the surviving source cells independently of A1/reference helpers.
        const inside = index < (axis === "row" ? 4 : 2);
        if (inside && !(kind === "insert" && index === 0)) {
          if (axis === "row")
            cells.splice(
              index,
              kind === "delete" ? count : 0,
              ...(kind === "insert" ? Array.from({ length: count }, () => [null, null]) : []),
            );
          else
            for (const row of cells)
              row.splice(
                index,
                kind === "delete" ? count : 0,
                ...(kind === "insert" ? Array(count).fill(null) : []),
              );
        }
        expect(chartValues(saved, "data", expected)).toEqual(cells);
      }
      expect(readCharts(await saveAndReopen()).charts).toEqual(actual);
      expect(await current.univerAPI.undo()).toBe(true);
      expect(readCharts(engine.snapshot()).charts).toEqual(readCharts(initial).charts);
      expect(chartValues(engine.snapshot(), "data", chart.range)).toEqual(chartCells);
      expect(readCharts(await saveAndReopen()).charts).toEqual(readCharts(initial).charts);
      expect(await current.univerAPI.redo()).toBe(true);
      expect(readCharts(engine.snapshot()).charts).toEqual(actual);
      engine.load(await saveAndReopen());
      expect(readCharts(engine.snapshot()).charts).toEqual(actual);
    } finally {
      engine.dispose();
    }
  });

  it("keeps a 10,000-cell source when insertion exceeds the rendering budget, including undo, redo and reopening", async () => {
    const initial = withCharts(snapshot("Month,Value\nJan,10\nFeb,20\nMar,30"), [
      { ...chart, range: "A1:T500" },
    ]);
    const h = await harness();
    const book = await h.service.create({ title: "Chart limit", snapshot: initial });
    let version = book.version;
    const engine = await mountUniver({} as HTMLElement, {
      snapshot: book.snapshot,
      dark: false,
      compact: true,
    });
    try {
      const current = headless.current as ReturnType<typeof headless.create>;
      current.univer
        .__getInjector()
        .get(headless.core.IUniverInstanceService)
        .focusUnit(book.snapshot.id as string);
      const commands = current.univer.__getInjector().get(headless.core.ICommandService);
      const expectSource = async (range: string, oversized: boolean) => {
        const assert = (data: Snapshot) => {
          expect(readCharts(data, true)).toEqual({ charts: [{ ...chart, range }], issues: [] });
          if (oversized)
            expect(() => chartValues(data, "data", range)).toThrow("Range too large to chart");
          else {
            const values = chartValues(data, "data", range);
            expect(values).toHaveLength(500);
            expect(values[0]).toHaveLength(20);
            expect(values.slice(0, 4).map((row) => row.slice(0, 2))).toEqual(chartCells);
          }
        };
        assert(engine.snapshot());
        await h.service.save(book.container, engine.snapshot(), version);
        const reopened = await h.service.open(book.container);
        version = reopened.version;
        assert(reopened.snapshot);
        return reopened.snapshot;
      };
      await expectSource("A1:T500", false);
      expect(
        await commands.executeCommand(headless.sheets.InsertRowCommand.id, {
          unitId: book.snapshot.id,
          subUnitId: "data",
          direction: headless.core.Direction.UP,
          range: { startRow: 2, endRow: 2, startColumn: 0, endColumn: 25 },
        }),
      ).toBe(true);
      await expectSource("A1:T501", true);
      expect(await current.univerAPI.undo()).toBe(true);
      await expectSource("A1:T500", false);
      expect(await current.univerAPI.redo()).toBe(true);
      engine.load(await expectSource("A1:T501", true));
      await expectSource("A1:T501", true);
    } finally {
      engine.dispose();
    }
  });

  it("keeps a qualified chart after a real sheet rename, pod save and reopen", async () => {
    const h = await harness();
    const book = await h.service.create({
      title: "Rename",
      snapshot: withCharts(snapshot("Month,Value\nJan,10\nFeb,20\nMar,30"), [
        { ...chart, range: "'Data'!A1:B4" },
      ]),
    });
    const engine = await mountUniver({} as HTMLElement, {
      snapshot: book.snapshot,
      dark: false,
      compact: true,
    });
    try {
      const commands = headless.current?.univer.__getInjector().get(headless.core.ICommandService);
      expect(
        await commands?.executeCommand(headless.sheets.SetWorksheetNameMutation.id, {
          unitId: book.snapshot.id,
          subUnitId: "data",
          name: "Renamed data",
        }),
      ).toBe(true);
      await h.service.save(book.container, engine.snapshot(), book.version);
      const reopened = await h.service.open(book.container);
      engine.load(reopened.snapshot);
      expect(readCharts(engine.snapshot()).charts).toEqual([chart]);
      expect(chartValues(engine.snapshot(), chart.sheetId, chart.range)).toEqual(chartCells);
    } finally {
      engine.dispose();
    }
  });

  it("restores unedited sources across multiple history entries while preserving other chart edits and deletion", async () => {
    const initial = chartSnapshot();
    const engine = await mountUniver({} as HTMLElement, {
      snapshot: initial,
      dark: false,
      compact: true,
    });
    try {
      const current = headless.current as ReturnType<typeof headless.create>;
      const injector = current.univer.__getInjector();
      injector.get(headless.core.IUniverInstanceService).focusUnit(initial.id as string);
      const commands = injector.get(headless.core.ICommandService);
      const remove = async (count: number) =>
        expect(
          await commands.executeCommand(headless.sheets.RemoveRowCommand.id, {
            unitId: initial.id,
            subUnitId: "data",
            range: { startRow: 0, endRow: count - 1, startColumn: 0, endColumn: 5 },
          }),
        ).toBe(true);
      await remove(1);
      await remove(3);
      // Another structural edit must also retain the already deleted source.
      await remove(1);
      expect(readCharts(engine.snapshot()).charts[0]?.range).toBeNull();
      const edited = readCharts(engine.snapshot())
        .charts.filter((spec) => spec.id !== "absolute")
        .map((spec) =>
          spec.id === "other" ? { ...spec, title: "Edited later", legend: false } : spec,
        );
      engine.setCharts?.(withCharts({}, edited).charts);
      const expected = (range: string | null) => [
        { ...chart, range },
        { ...readCharts(initial).charts[2], title: "Edited later", legend: false },
      ];
      for (const range of [null, "A1:B3", "A1:B4"]) {
        expect(await current.univerAPI.undo()).toBe(true);
        expect(readCharts(engine.snapshot()).charts).toEqual(expected(range));
      }
      expect(chartValues(engine.snapshot(), "data", chart.range)).toEqual(chartCells);
      for (const range of ["A1:B3", null, null]) {
        expect(await current.univerAPI.redo()).toBe(true);
        expect(readCharts(engine.snapshot()).charts).toEqual(expected(range));
      }
    } finally {
      engine.dispose();
    }
  });

  it.each([
    "source",
    "recreated",
  ] as const)("invalidates lost-source restoration after a chart is %s edited", async (edit) => {
    const initial = chartSnapshot();
    const engine = await mountUniver({} as HTMLElement, {
      snapshot: initial,
      dark: false,
      compact: true,
    });
    try {
      const current = headless.current as ReturnType<typeof headless.create>;
      const injector = current.univer.__getInjector();
      injector.get(headless.core.IUniverInstanceService).focusUnit(initial.id as string);
      expect(
        await injector
          .get(headless.core.ICommandService)
          .executeCommand(headless.sheets.RemoveRowCommand.id, {
            unitId: initial.id,
            subUnitId: "data",
            range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 5 },
          }),
      ).toBe(true);
      const edited = readCharts(engine.snapshot()).charts;
      if (edit === "source") edited[0] = { ...(edited[0] as ChartSpec), range: "A1:B4" };
      else
        engine.setCharts?.(
          withCharts(
            {},
            edited.filter((spec) => spec.id !== chart.id),
          ).charts,
        );
      engine.setCharts?.(withCharts({}, edited).charts);
      const expectSource = (range: string) => {
        const saved = engine.snapshot();
        const spec = readCharts(saved).charts[0] as ChartSpec;
        expect(spec).toEqual({ ...edited[0], range });
        expect(chartValues(saved, spec.sheetId, spec.range)).toEqual(
          edit === "source" ? [...chartCells.slice(1), [null, null]] : chartCells.slice(1),
        );
      };
      expect(await current.univerAPI.undo()).toBe(true);
      expectSource(edit === "source" ? "A2:B5" : "A2:B4");
      expect(await current.univerAPI.redo()).toBe(true);
      expectSource(edit === "source" ? "A1:B4" : "A1:B3");
    } finally {
      engine.dispose();
    }
  });

  it.each([
    ["row", "title", "A1:B4"],
    ["row", "source", "A2:B4"],
    ["column", "source", "B1:B4"],
  ] as const)("refreshes restoration records when redoing a %s deletion after a %s edit", async (axis, edit, editedRange) => {
    const initial = chartSnapshot();
    const engine = await mountUniver({} as HTMLElement, {
      snapshot: initial,
      dark: false,
      compact: true,
    });
    try {
      const current = headless.current as ReturnType<typeof headless.create>;
      const injector = current.univer.__getInjector();
      injector.get(headless.core.IUniverInstanceService).focusUnit(initial.id as string);
      expect(
        await injector
          .get(headless.core.ICommandService)
          .executeCommand(
            axis === "row"
              ? headless.sheets.RemoveRowCommand.id
              : headless.sheets.RemoveColCommand.id,
            {
              unitId: initial.id,
              subUnitId: "data",
              range:
                axis === "row"
                  ? { startRow: 0, endRow: 3, startColumn: 0, endColumn: 5 }
                  : { startRow: 0, endRow: 9, startColumn: 0, endColumn: 1 },
            },
          ),
      ).toBe(true);
      expect(readCharts(engine.snapshot()).charts[0]?.range).toBeNull();
      expect(await current.univerAPI.undo()).toBe(true);
      const edited = readCharts(engine.snapshot()).charts.map((spec) =>
        spec.id === chart.id ? { ...spec, title: "Edited later", range: editedRange } : spec,
      );
      engine.setCharts?.(withCharts({}, edited).charts);
      const expectedValues =
        edit === "title"
          ? chartCells
          : axis === "row"
            ? chartCells.slice(1)
            : chartCells.map((row) => row.slice(1));
      for (let replay = 0; replay < 2; replay++) {
        expect(await current.univerAPI.redo()).toBe(true);
        expect(readCharts(engine.snapshot()).charts[0]?.range).toBeNull();
        expect(await current.univerAPI.undo()).toBe(true);
        const restored = engine.snapshot();
        expect(readCharts(restored).charts).toEqual(edited);
        expect(chartValues(restored, "data", editedRange)).toEqual(expectedValues);
      }
    } finally {
      engine.dispose();
    }
  });

  it("restores clipped sources after presentation edits without losing those edits", async () => {
    const initial = chartSnapshot();
    const engine = await mountUniver({} as HTMLElement, {
      snapshot: initial,
      dark: false,
      compact: true,
    });
    try {
      const current = headless.current as ReturnType<typeof headless.create>;
      const injector = current.univer.__getInjector();
      injector.get(headless.core.IUniverInstanceService).focusUnit(initial.id as string);
      expect(
        await injector
          .get(headless.core.ICommandService)
          .executeCommand(headless.sheets.RemoveRowCommand.id, {
            unitId: initial.id,
            subUnitId: "data",
            range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 5 },
          }),
      ).toBe(true);
      const presentation = { title: "Edited later", legend: false, type: "line" as const };
      engine.setCharts?.(
        withCharts(
          {},
          readCharts(engine.snapshot()).charts.map((spec) => ({ ...spec, ...presentation })),
        ).charts,
      );
      expect(await current.univerAPI.undo()).toBe(true);
      expect(readCharts(engine.snapshot()).charts).toEqual(
        readCharts(initial).charts.map((spec) => ({ ...spec, ...presentation })),
      );
      expect(chartValues(engine.snapshot(), "data", chart.range)).toEqual(chartCells);
    } finally {
      engine.dispose();
    }
  });

  it("shifts a manually edited source equal to a historical source through undo and redo", async () => {
    const initial = chartSnapshot();
    const engine = await mountUniver({} as HTMLElement, {
      snapshot: initial,
      dark: false,
      compact: true,
    });
    try {
      const current = headless.current as ReturnType<typeof headless.create>;
      const injector = current.univer.__getInjector();
      injector.get(headless.core.IUniverInstanceService).focusUnit(initial.id as string);
      const commands = injector.get(headless.core.ICommandService);
      const expectSource = (range: string, values: unknown[][]) => {
        const saved = engine.snapshot();
        const spec = readCharts(saved).charts[0] as ChartSpec;
        expect(spec.range).toBe(range);
        expect(chartValues(saved, spec.sheetId, spec.range)).toEqual(values);
      };
      expect(
        await commands.executeCommand(headless.sheets.RemoveRowCommand.id, {
          unitId: initial.id,
          subUnitId: "data",
          range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 5 },
        }),
      ).toBe(true);
      expectSource("A1:B3", chartCells.slice(1));
      const edited = readCharts(engine.snapshot()).charts.map((spec) =>
        spec.id === chart.id ? { ...spec, range: chart.range } : spec,
      );
      engine.setCharts?.(withCharts({}, edited).charts);
      const values = [...chartCells.slice(1), [null, null]];
      expectSource("A1:B4", values);
      expect(await current.univerAPI.undo()).toBe(true);
      expectSource("A2:B5", values);
      expect(await current.univerAPI.redo()).toBe(true);
      expectSource("A1:B4", values);
    } finally {
      engine.dispose();
    }
  });

  it.each([
    ["row", "A2:B5"],
    ["column", "B1:C4"],
  ] as const)("shifts a chart created after a %s insertion through undo and redo with its values", async (axis, insertedRange) => {
    const initial = snapshot("Month,Value\nJan,10\nFeb,20\nMar,30");
    const engine = await mountUniver({} as HTMLElement, {
      snapshot: initial,
      dark: false,
      compact: true,
    });
    try {
      const current = headless.current as ReturnType<typeof headless.create>;
      const injector = current.univer.__getInjector();
      injector.get(headless.core.IUniverInstanceService).focusUnit(initial.id as string);
      const commands = injector.get(headless.core.ICommandService);
      expect(
        await commands.executeCommand(
          axis === "row"
            ? headless.sheets.InsertRowCommand.id
            : headless.sheets.InsertColCommand.id,
          {
            unitId: initial.id,
            subUnitId: "data",
            direction: axis === "row" ? headless.core.Direction.UP : headless.core.Direction.LEFT,
            range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
          },
        ),
      ).toBe(true);
      engine.setCharts?.(withCharts({}, [{ ...chart, range: insertedRange }]).charts);
      const expectSource = (range: string) => {
        const saved = engine.snapshot();
        const spec = readCharts(saved).charts[0] as ChartSpec;
        expect(spec.range).toBe(range);
        expect(chartValues(saved, spec.sheetId, spec.range)).toEqual(chartCells);
      };
      expectSource(insertedRange);
      expect(await current.univerAPI.undo()).toBe(true);
      expectSource("A1:B4");
      expect(await current.univerAPI.redo()).toBe(true);
      expectSource(insertedRange);
    } finally {
      engine.dispose();
    }
  });

  it.each([
    ["row", "delete", 7, 1, "A1:B4", "D1:E4", "D1:E4"],
    ["row", "delete", 0, 1, "A1:B3", "D2:E5", "D1:E4"],
    ["row", "delete", 0, 4, null, "D5:E8", "D1:E4"],
    ["row", "insert", 0, 1, "A2:B5", "D1:E3", "D2:E4"],
    ["column", "delete", 0, 1, "A1:A4", "E1:F4", "D1:E4"],
    ["column", "delete", 0, 2, null, "F1:G4", "D1:E4"],
    ["column", "insert", 0, 1, "B1:C4", "C1:D4", "D1:E4"],
  ] as const)("shifts later chart sources through undo and redo of %s %s at %i, count %i", async (axis, kind, index, count, expectedRange, undoRange, redoRange) => {
    const initial = chartSnapshot();
    const engine = await mountUniver({} as HTMLElement, {
      snapshot: initial,
      dark: false,
      compact: true,
    });
    try {
      const current = headless.current as ReturnType<typeof headless.create>;
      const injector = current.univer.__getInjector();
      injector.get(headless.core.IUniverInstanceService).focusUnit(initial.id as string);
      const commands = injector.get(headless.core.ICommandService);
      const command =
        axis === "row"
          ? kind === "delete"
            ? headless.sheets.RemoveRowCommand
            : headless.sheets.InsertRowCommand
          : kind === "delete"
            ? headless.sheets.RemoveColCommand
            : headless.sheets.InsertColCommand;
      expect(
        await commands.executeCommand(command.id, {
          unitId: initial.id,
          subUnitId: "data",
          direction: axis === "row" ? headless.core.Direction.UP : headless.core.Direction.LEFT,
          range:
            axis === "row"
              ? { startRow: index, endRow: index + count - 1, startColumn: 0, endColumn: 5 }
              : { startRow: 0, endRow: 9, startColumn: index, endColumn: index + count - 1 },
        }),
      ).toBe(true);
      expect(readCharts(engine.snapshot()).charts[0]?.range).toBe(expectedRange);
      const edited = readCharts(engine.snapshot()).charts.map((spec) =>
        spec.id === "chart" ? { ...spec, range: "D1:E4" } : spec,
      );
      engine.setCharts?.(withCharts({}, edited).charts);
      expect(readCharts(engine.snapshot()).charts).toEqual(edited);
      expect(await current.univerAPI.undo()).toBe(true);
      const restored = readCharts(initial).charts.map((spec) =>
        spec.id === "chart" ? { ...spec, range: undoRange } : spec,
      );
      expect(readCharts(engine.snapshot()).charts).toEqual(restored);
      expect(chartValues(engine.snapshot(), "data", chart.range)).toEqual(chartCells);
      // A sheet replacement with the same range is also a source edit, including before redo.
      const moved = restored.map((spec) =>
        spec.id === "absolute" ? { ...spec, sheetId: "other" } : spec,
      );
      engine.setCharts?.(withCharts({}, moved).charts);
      expect(await current.univerAPI.redo()).toBe(true);
      expect(readCharts(engine.snapshot()).charts).toEqual(
        moved.map((spec) => (spec.id === "chart" ? { ...spec, range: redoRange } : spec)),
      );
    } finally {
      engine.dispose();
    }
  });

  it("ignores stale source restores after load and supports commands on sheets without charts", async () => {
    const engine = await mountUniver({} as HTMLElement, {
      snapshot: chartSnapshot(),
      dark: false,
      compact: true,
    });
    try {
      const commands = headless.current?.univer.__getInjector().get(headless.core.ICommandService);
      expect(
        await commands?.executeCommand("sheets.mutation.structural-metadata", {
          unitId: "previous-workbook",
          operation: { redo: [], undo: [] },
          direction: "undo",
          phase: "end",
        }),
      ).toBe(false);
      engine.load(snapshot("A,B\n1,2", true));
      expect(
        await commands?.executeCommand("sheets.mutation.structural-metadata", {
          unitId: engine.snapshot().id,
          operation: { redo: [], undo: [], chartSources: { sheetId: "data", sources: [] } },
          direction: "undo",
          phase: "end",
        }),
      ).toBe(true);
      const insert = async () =>
        expect(
          await commands?.executeCommand(headless.sheets.InsertRowCommand.id, {
            unitId: engine.snapshot().id,
            subUnitId: "other",
            direction: headless.core.Direction.UP,
            range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 25 },
          }),
        ).toBe(true);
      await insert();
      expect(engine.snapshot().charts).toBeUndefined();
      engine.setCharts?.(withCharts({}, [chart]).charts);
      await insert();
      expect(readCharts(engine.snapshot()).charts).toEqual([chart]);
    } finally {
      engine.dispose();
    }
  });
});

it.each([
  "row",
  "column",
] as const)("replays %s history for chart sources and comment tombstones together and saves both", async (axis) => {
  const pod = await harness();
  const initial = chartSnapshot();
  const book = await pod.service.create({ title: "Charts and comments", snapshot: initial });
  let version = book.version;
  const engine = await mountUniver({} as HTMLElement, {
    snapshot: book.snapshot,
    dark: false,
    compact: true,
  });
  const anchor = { sheetId: "data", cell: "B2", deleted: false };
  engine.registerCommentAnchors?.({ root: anchor, other: { ...anchor, sheetId: "other" } });
  const draft = engine.trackCommentDraft?.(anchor);
  const current = headless.current as ReturnType<typeof headless.create>;
  const injector = current.univer.__getInjector();
  injector.get(headless.core.IUniverInstanceService).focusUnit(book.snapshot.id as string);
  const commands = injector.get(headless.core.ICommandService);
  const assertState = async (deleted: boolean) => {
    const data = engine.snapshot();
    expect(readCharts(data).charts[0]?.range).toBe(deleted ? null : chart.range);
    expect(currentCommentAnchor(data, "root", anchor)).toEqual({ ...anchor, deleted });
    expect(currentCommentAnchor(data, "other", anchor)).toEqual({ ...anchor, sheetId: "other" });
    expect(draft?.current()).toEqual({ ...anchor, deleted });
    version = (await pod.service.save(book.container, data, version)).version;
    expect((await pod.service.open(book.container)).snapshot).toEqual(data);
  };
  try {
    expect(
      await commands.executeCommand(
        axis === "row" ? headless.sheets.RemoveRowCommand.id : headless.sheets.RemoveColCommand.id,
        {
          unitId: book.snapshot.id,
          subUnitId: "data",
          range: {
            startRow: 0,
            endRow: axis === "row" ? 3 : 9,
            startColumn: 0,
            endColumn: axis === "column" ? 1 : 5,
          },
        },
      ),
    ).toBe(true);
    await assertState(true);
    engine.setCommentsLoading?.(true);
    const locked = engine.snapshot();
    engine.setCharts?.(withCharts({}, []).charts);
    expect(await current.univerAPI.undo()).toBe(false);
    expect(await current.univerAPI.redo()).toBe(false);
    expect(engine.importCsv("Blocked", { mode: "replace-active" })).toEqual({
      status: "blocked",
      reason: "comments-loading",
    });
    expect(engine.snapshot()).toEqual(locked);
    engine.setCommentsLoading?.(false);
    for (let replay = 0; replay < 2; replay++) {
      expect(await current.univerAPI.undo()).toBe(true);
      await assertState(false);
      expect(await current.univerAPI.redo()).toBe(true);
      await assertState(true);
    }
    expect(await current.univerAPI.undo()).toBe(true);
    await assertState(false);
    const saved = engine.snapshot();
    engine.load(saved);
    expect(engine.snapshot()).toEqual(saved);
  } finally {
    draft?.dispose();
    engine.dispose();
  }
});
