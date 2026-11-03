// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { CellValueType, type IWorkbookData } from "@univerjs/core";
import { DataFactory } from "n3";
import { assert, describe, expect, it } from "vitest";
import { readRdf } from "../src/apps/docs/lib/model/rdf-io";
import { TypeIndexDataset } from "../src/apps/docs/lib/model/type-index";
import { WorkbookConflictError } from "../src/apps/sheets/lib/contract";
import { SPREADSHEET_CLASS, workbookLayout } from "../src/apps/sheets/lib/model";
import { loadWorkbook, workbookToCsv } from "../src/apps/sheets/lib/univer-spike";
import { createWorkbookService } from "../src/apps/sheets/lib/workbook";
import { CSV, harness, INDEX, NOW, ROOT, snapshot } from "./sheets-workbook-helpers";

describe("Sheets workbook service", () => {
  it("creates an engine-normalised empty sheet and reserves the index before other writes", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "  My Budget!  " });
    expect(h.service.root).toBe(ROOT);
    expect(book.container).toBe(`${ROOT}my-budget/`);
    expect(book.metadata).toMatchObject({
      title: "  My Budget!  ",
      created: NOW,
      modified: NOW,
      sheets: [{ number: 1, name: "Sheet1" }],
    });
    const engine = book.snapshot as unknown as IWorkbookData;
    expect(loadWorkbook(engine)).toEqual(engine);
    expect(engine.name).toBe("  My Budget!  ");
    const writes = h.calls.filter((c) => c.method === "PUT");
    expect(writes.map((c) => c.url.replace(book.container, ""))).toEqual([
      "index.ttl",
      "workbook.json",
      "sheets/1.csv",
      "sheets/1.jsonld",
      "index.ttl",
    ]);
    expect(writes.slice(0, 2).every((c) => c.headers.get("if-none-match") === "*")).toBe(true);
    expect(writes.slice(2, 4).every((c) => !c.headers.has("if-none-match"))).toBe(true);
    expect(writes[4]?.headers.get("if-match")).toMatch(/^"demo-/);
    expect((await h.storage.loadDescriptor(book.container, 1)).value.columns).toEqual([
      { name: "", type: "text", format: "text" },
    ]);
    expect(await h.service.open(book.container)).toEqual({
      ...book,
      version: { ...book.version, derived: {} },
    });
  });

  it("round-trips snapshot identity, typed CSV values, descriptors, and fresh ETags on save", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Data", snapshot: snapshot() });
    const edited = {
      ...book.snapshot,
      name: "Updated",
      custom: { formula: "=SUM(A1:A2)", formats: [1, null] },
    };
    const changed = new Date("2026-11-02T10:00:00Z");
    h.setDate(changed);
    const saved = await h.service.save(book.container, edited, book.version);
    // index.ttl owns the title: the snapshot's own name never overrides it.
    expect(saved.metadata.title).toBe("Data");
    const titled = await h.service.save(book.container, edited, saved.version, {
      title: "Updated",
    });
    expect(titled.metadata.title).toBe("Updated");
    expect(saved.metadata.created).toEqual(NOW);
    expect(saved.metadata.modified).toEqual(changed);
    const reopened = await h.service.open(book.container);
    expect(reopened.snapshot).toEqual(edited);
    expect(reopened.version.snapshotEtag).toBe(titled.version.snapshotEtag);
    expect(saved.version.snapshotEtag).not.toBe(book.version.snapshotEtag);
    const descriptor = (await h.storage.loadDescriptor(book.container, 1)).value;
    expect(descriptor.columns.map((c) => c.type)).toEqual(["text", "number", "date"]);
    expect((await h.storage.loadCsv(book.container, 1, descriptor.columns)).value.rows).toEqual([
      ["Text, quoted", 42.5, new Date("2026-10-25")],
    ]);
    expect(await (await h.fetch(workbookLayout(book.container).sheet(1).csv)).text()).toBe(CSV);
    for (const [url, etag] of Object.entries(titled.version.derived))
      expect((await h.fetch(url)).headers.get("etag")).toBe(etag);
  });

  it("imports all CSV fields as text, including formulas and leading zeroes", async () => {
    const h = await harness();
    const book = await h.service.createFromCsv({
      title: "Import",
      csv: "ID,Date,Formula\n001,2026-10-25,=1+1\n",
      sheetName: "Imported",
    });
    const workbook = book.snapshot as unknown as IWorkbookData;
    expect(workbook.sheets.sheet1?.cellData?.[1]).toEqual({
      0: { v: "001", t: CellValueType.STRING },
      1: { v: "2026-10-25", t: CellValueType.STRING },
      2: { v: "=1+1", t: CellValueType.STRING },
    });
    expect(book.metadata.sheets[0]?.name).toBe("Imported");
    const defaultName = await h.service.createFromCsv({ title: "Import", csv: "A\nB" });
    expect(defaultName.metadata.sheets[0]?.name).toBe("Sheet1");
  });

  it("preserves opaque plugin resources, freeze and merges in authoritative snapshots", async () => {
    const h = await harness();
    const input = snapshot();
    input.resources = [
      {
        name: "SHEET_DATA_VALIDATION_PLUGIN",
        data: JSON.stringify({
          data: [{ uid: "dv", type: "list", formula1: "Yes,No", allowBlank: true }],
        }),
      },
      {
        name: "SHEET_CONDITIONAL_FORMATTING_PLUGIN",
        data: JSON.stringify({
          data: [{ cfId: "cf", stopIfTrue: false, rule: { type: "highlightCell" } }],
        }),
      },
      { name: "FUTURE_PLUGIN", data: '{"opaque":[null,false,42]}' },
    ];
    const sheet = (input as unknown as IWorkbookData).sheets.data;
    assert(sheet);
    sheet.freeze = { startRow: 1, startColumn: -1, ySplit: 1, xSplit: 0 };
    sheet.mergeData = [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }];
    const book = await h.service.create({ title: "Rules", snapshot: input });
    expect(book.snapshot.resources).toEqual(input.resources);
    const opened = await h.service.open(book.container);
    expect(opened.snapshot).toEqual(book.snapshot);
    const edited = structuredClone(opened.snapshot);
    edited.resources = [
      {
        name: "SHEET_DATA_VALIDATION_PLUGIN",
        data: JSON.stringify({ data: [{ uid: "dv", type: "list", formula1: "Red,Green" }] }),
      },
      { name: "SHEET_CONDITIONAL_FORMATTING_PLUGIN", data: "{}" },
      { name: "FUTURE_PLUGIN", data: '{"opaque":[null,false,42]}' },
    ];
    await h.service.save(book.container, edited, opened.version);
    const stored = await (await h.fetch(workbookLayout(book.container).snapshot)).json();
    expect(stored).toEqual(edited);
    const freshService = createWorkbookService(h.options);
    const reloaded = await freshService.open(book.container);
    expect(reloaded.snapshot).toEqual(edited);
    expect((reloaded.snapshot as unknown as IWorkbookData).sheets.data).toMatchObject({
      freeze: sheet.freeze,
      mergeData: sheet.mergeData,
    });
    const copy = await freshService.copy(book.container, "Rules copy");
    expect(copy.snapshot.resources).toEqual(edited.resources);
  });

  it("allocates collisions through -2 and -3, caps long slugs, and has an ASCII fallback", async () => {
    const h = await harness();
    const input = { title: "One!", snapshot: snapshot() };
    expect((await h.service.create(input)).container).toBe(`${ROOT}one/`);
    expect((await h.service.create(input)).container).toBe(`${ROOT}one-2/`);
    expect((await h.service.create(input)).container).toBe(`${ROOT}one-3/`);
    expect((await h.service.create({ ...input, title: "🌿" })).container).toBe(
      `${ROOT}spreadsheet/`,
    );
    expect((await h.service.create({ ...input, title: "A".repeat(100) })).container).toBe(
      `${ROOT}${"a".repeat(60)}/`,
    );
  });

  it("lists newest first and skips missing, forbidden, malformed indexes and ordinary files", async () => {
    const h = await harness();
    expect(await h.service.list()).toEqual([]);
    const first = await h.service.create({ title: "First", snapshot: snapshot() });
    h.setDate(new Date("2026-11-03"));
    const second = await h.service.create({ title: "Second", snapshot: snapshot() });
    await h.pod.fetch(`${ROOT}malformed/index.ttl`, {
      method: "PUT",
      body: "malformed RDF",
      headers: { "content-type": "text/turtle" },
    });
    await h.pod.fetch(`${ROOT}missing/`, { method: "PUT" });
    await h.pod.fetch(`${ROOT}forbidden/`, { method: "PUT" });
    await h.pod.fetch(`${ROOT}readme.txt`, { method: "PUT", body: "Read me" });
    h.setHook((c) =>
      c.url === `${ROOT}forbidden/index.ttl` ? new Response(null, { status: 403 }) : undefined,
    );
    const rows = await h.service.list();
    expect(rows.map((r) => r.container)).toEqual([second.container, first.container]);
    expect(rows[1]).toEqual({
      container: first.container,
      title: "First",
      modified: NOW,
      created: NOW,
      creator: first.metadata.creator,
      sheetCount: 1,
    });
  });

  it("writes derived resources unconditionally after open and creates newly added sheets", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Lazy", snapshot: snapshot() });
    const opened = await h.service.open(book.container);
    h.calls.length = 0;
    const saved = await h.service.save(book.container, snapshot(CSV, true), opened.version, {
      title: "Explicit",
    });
    expect(saved.metadata.title).toBe("Explicit");
    const csv = workbookLayout(book.container).sheet(1).csv;
    expect(
      h.calls
        .filter((c) => c.url === csv)
        .map((c) => [c.method, c.headers.get("if-none-match"), c.headers.get("if-match")]),
    ).toEqual([["PUT", null, null]]);
    expect(Object.keys(saved.version.derived)).toHaveLength(4);
  });

  it("detects stale snapshot/index versions and force-saves using current validators", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Conflict", snapshot: snapshot() });
    const latest = await h.service.save(book.container, book.snapshot, book.version);
    await expect(
      h.service.save(book.container, book.snapshot, book.version),
    ).rejects.toBeInstanceOf(WorkbookConflictError);
    await h.service.rename(book.container, "Theirs", latest.version);
    await expect(
      h.service.save(book.container, book.snapshot, latest.version),
    ).rejects.toBeInstanceOf(WorkbookConflictError);
    const before = await h.service.open(book.container);
    h.calls.length = 0;
    const saved = await h.service.save(book.container, book.snapshot, book.version, {
      force: true,
      title: "Mine",
    });
    const layout = workbookLayout(book.container);
    const puts = h.calls.filter((c) => c.method === "PUT");
    expect(puts.find((c) => c.url === layout.snapshot)?.headers.get("if-match")).toBe(
      before.version.snapshotEtag,
    );
    expect(puts.find((c) => c.url === layout.index)?.headers.get("if-match")).toBe(
      before.version.indexEtag,
    );
    expect(saved.metadata.title).toBe("Mine");
  });

  it("renames only the index and rejects stale renames", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Rename", snapshot: snapshot() });
    h.calls.length = 0;
    const result = await h.service.rename(book.container, "New name", book.version);
    expect(result.version.snapshotEtag).toBe(book.version.snapshotEtag);
    expect(result.version.derived).toEqual(book.version.derived);
    expect(h.calls.filter((c) => c.method === "PUT").map((c) => c.url)).toEqual([
      workbookLayout(book.container).index,
    ]);
    await expect(h.service.rename(book.container, "Stale", book.version)).rejects.toBeInstanceOf(
      WorkbookConflictError,
    );
    expect((await h.service.open(book.container)).metadata.title).toBe("New name");
  });

  it("deletes stale sheet resources after sheet removal and retains previous title without a snapshot name", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Shrink", snapshot: snapshot(CSV, true) });
    const reduced = snapshot();
    delete reduced.name;
    const saved = await h.service.save(book.container, reduced, book.version);
    expect(saved.metadata.title).toBe("Shrink");
    const stale = workbookLayout(book.container).sheet(2);
    expect(h.pod.has(stale.csv)).toBe(false);
    expect(h.pod.has(stale.descriptor)).toBe(false);
    expect(Object.keys(saved.version.derived)).toHaveLength(2);
  });

  it("copies snapshots under a fresh ID without changing source content", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Source", snapshot: snapshot() });
    const copy = await h.service.copy(book.container, "Copy");
    expect(copy.snapshot).toEqual({ ...book.snapshot, id: copy.snapshot.id, name: "Copy" });
    expect(copy.snapshot.id).not.toBe(book.snapshot.id);
    expect(workbookToCsv(copy.snapshot as unknown as IWorkbookData, "data")).toBe(CSV);
    expect((await h.service.open(book.container)).snapshot).toEqual(book.snapshot);
  });

  it("registers the Sheets container once, across service instances, and skips missing indexes", async () => {
    const h = await harness(true);
    await Promise.all([
      h.service.create({ title: "One", snapshot: snapshot() }),
      h.service.create({ title: "Two", snapshot: snapshot() }),
    ]);
    const dataset = (await readRdf(INDEX, h.fetch)).dataset;
    expect(new TypeIndexDataset(dataset, DataFactory).locate(SPREADSHEET_CLASS)).toEqual([
      { forClass: SPREADSHEET_CLASS, instance: undefined, container: ROOT },
    ]);
    const fresh = createWorkbookService(h.options);
    await fresh.create({ title: "Three", snapshot: snapshot() });
    expect(h.calls.filter((c) => c.method === "PUT" && c.url === INDEX)).toHaveLength(1);
    const noIndex = await harness();
    await noIndex.service.create({ title: "No index", snapshot: snapshot() });
    expect(noIndex.calls.some((c) => c.method === "PUT" && !c.url.startsWith(ROOT))).toBe(false);
  });

  it("removes all nested contents depth-first, tolerates 404s, and keeps siblings", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Delete", snapshot: snapshot() });
    const keep = await h.service.create({ title: "Keep", snapshot: snapshot() });
    await h.pod.fetch(`${book.container}assets/nested/data.bin`, { method: "PUT", body: "Extra" });
    const vanished = workbookLayout(book.container).snapshot;
    h.setHook(async (c) => {
      if (c.method === "DELETE" && c.url === vanished) {
        await h.pod.fetch(vanished, { method: "DELETE" });
        return new Response(null, { status: 404 });
      }
    });
    await h.service.remove(book.container);
    const state = h.pod.snapshot();
    expect(
      [...state.resources, ...state.containers].some(([url]) => url.startsWith(book.container)),
    ).toBe(false);
    assert(h.pod.has(keep.container));
    await h.service.remove(book.container);
  });
});
