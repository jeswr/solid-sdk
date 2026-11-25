// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import * as Y from "yjs";
import {
  axes,
  cells,
  checkpoint,
  reconcileAxis,
  seedSheets,
  sheetStates,
  snapshotAxes,
  spliceAxis,
  styleValue,
} from "../src/apps/sheets/lib/collaboration/model";
import type { Snapshot } from "../src/apps/sheets/lib/contract";

it("seeds sparse legacy workbooks, retains style definitions, and preserves checkpoint identities when copying", () => {
  const doc = new Y.Doc();
  const snapshot: Snapshot = {
    sheetOrder: ["absent", "data"],
    styles: { bold: { bl: 1 }, empty: null },
    sheets: { data: { cellData: { 0: { 0: { v: "Cell", s: "bold" }, 1: null } } } },
  };
  doc.transact(() => seedSheets(doc, snapshot));
  const state = sheetStates(doc).get("data");
  if (!state) throw new Error("Missing data sheet");
  expect(axes(state).rowIds).toHaveLength(1000);
  expect(axes(state).colIds).toHaveLength(26);
  expect([...cells(state).values()]).toEqual([{ v: "Cell", s: "bold" }]);
  expect(doc.getMap("styles").toJSON()).toEqual({ bold: { bl: 1 } });
  doc.transact(() => seedSheets(doc, snapshot));
  const saved = checkpoint(doc);
  const copy = new Y.Doc();
  copy.transact(() => seedSheets(copy, { ...snapshot, collaboration: saved }));
  expect(checkpoint(copy).sheets).toEqual(saved.sheets);
  expect(snapshotAxes({ collaboration: saved }, "data", state)).toEqual(saved.sheets.data);
  expect(snapshotAxes({}, "data", state)).toEqual(saved.sheets.data);
  const blank = new Y.Doc();
  blank.transact(() => seedSheets(blank, { sheetOrder: ["empty"], sheets: { empty: {} } }));
  expect(sheetStates(blank).size).toBe(1);
  doc.destroy();
  copy.destroy();
  blank.destroy();
});

it("normalizes concurrent moves without duplicating identities and removes every occurrence when a row is deleted", () => {
  const a = new Y.Doc();
  a.getArray<string>("rows").push(["a", "b", "c", "d"]);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const rowsA = a.getArray<string>("rows"),
    rowsB = b.getArray<string>("rows");
  a.transact(() => {
    spliceAxis(rowsA, 1, 1, []);
    spliceAxis(rowsA, 0, 0, ["b"]);
  });
  b.transact(() => {
    spliceAxis(rowsB, 1, 1, []);
    spliceAxis(rowsB, 3, 0, ["b"]);
  });
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const unique = [...new Set(rowsA.toArray())];
  expect([...new Set(rowsB.toArray())]).toEqual(unique);
  expect(unique).toHaveLength(4);
  spliceAxis(rowsA, unique.indexOf("b"), 1, []);
  expect(rowsA.toArray()).not.toContain("b");
  const operations: unknown[] = [];
  reconcileAxis(["a", "b", "c", "d"], ["b", "c", "a", "e", "f"], (edit) => operations.push(edit));
  expect(operations).toEqual([
    { kind: "delete", index: 3, count: 1 },
    { kind: "move", index: 1, count: 2, destination: 0 },
    { kind: "insert", index: 3, count: 2 },
  ]);
  a.destroy();
  b.destroy();
});

it("styles compare by value, keeping unknown IDs and inline styles as they are", () => {
  const styles = { bold: { bl: 1 as const } };
  expect(styleValue(styles, "bold")).toEqual({ bl: 1 });
  expect(styleValue(styles, "missing")).toBe("missing");
  expect(styleValue(styles, { it: 1 })).toEqual({ it: 1 });
  expect(styleValue(styles, undefined)).toBeUndefined();
});
