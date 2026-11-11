// AUTHORED-BY Codex GPT-6.1-Sol
import type { IStyleData, IWorkbookData } from "@univerjs/core";
import * as Y from "yjs";
import type { Snapshot } from "../contract";
import { encodeCell, type StoredCell } from "./formulas";

export type Axes = {
  rowIds: string[];
  colIds: string[];
};
export type SheetState = Y.Map<Y.Array<string> | Y.Map<StoredCell> | Axes>;
export const LOCAL_ORIGIN = Symbol("Sheets local command");
export const SEED_ORIGIN = Symbol("Sheets snapshot seed");

export function sheetStates(doc: Y.Doc) {
  return doc.getMap<SheetState>("sheets");
}
export function axes(state: SheetState): Axes {
  return {
    rowIds: [...new Set((state.get("rowIds") as Y.Array<string>).toArray())],
    colIds: [...new Set((state.get("colIds") as Y.Array<string>).toArray())],
  };
}
export function cells(state: SheetState) {
  return state.get("cells") as Y.Map<StoredCell>;
}
export function jsonCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/** A sheet's identity is external to the CRDT in slice 1. Never store names/order here. */
export function seedSheets(doc: Y.Doc, snapshot: Snapshot) {
  const workbook = snapshot as unknown as IWorkbookData;
  const created = new Set<string>();
  for (const [id, style] of Object.entries(workbook.styles ?? {})) {
    if (style && !doc.getMap<IStyleData>("styles").has(id))
      doc.getMap<IStyleData>("styles").set(id, jsonCopy(style));
  }
  for (const id of workbook.sheetOrder) {
    if (sheetStates(doc).has(id)) continue;
    const sheet = workbook.sheets[id];
    if (!sheet) continue;
    created.add(id);
    const state: SheetState = new Y.Map();
    const saved = (
      snapshot.collaboration as unknown as { sheets: Record<string, Axes> } | undefined
    )?.sheets[id];
    const rowIds =
      saved?.rowIds ?? Array.from({ length: sheet.rowCount ?? 1000 }, () => crypto.randomUUID());
    const colIds =
      saved?.colIds ?? Array.from({ length: sheet.columnCount ?? 26 }, () => crypto.randomUUID());
    const rows = new Y.Array<string>();
    const cols = new Y.Array<string>();
    rows.push(rowIds);
    cols.push(colIds);
    state.set("rowIds", rows);
    state.set("colIds", cols);
    state.set("initial", { rowIds, colIds });
    const values = new Y.Map<StoredCell>();
    state.set("cells", values);
    sheetStates(doc).set(id, state);
  }
  const positions = new Map([...sheetStates(doc)].map(([id, state]) => [id, axes(state)]));
  for (const id of workbook.sheetOrder) {
    const sheet = workbook.sheets[id];
    const state = sheetStates(doc).get(id);
    if (!sheet || !state || !created.has(id)) continue;
    const { rowIds, colIds } = axes(state);
    for (const [r, columns] of Object.entries(sheet.cellData ?? {})) {
      for (const [c, cell] of Object.entries(columns)) {
        if (cell)
          cells(state).set(
            `${rowIds[Number(r)]}|${colIds[Number(c)]}`,
            encodeCell(jsonCopy(cell), id, workbook, positions),
          );
      }
    }
  }
}

export function checkpoint(doc: Y.Doc) {
  return {
    stateVector: btoa(String.fromCharCode(...Y.encodeStateVector(doc))),
    sheets: Object.fromEntries([...sheetStates(doc)].map(([id, state]) => [id, axes(state)])),
  };
}

export function snapshotAxes(snapshot: Snapshot, id: string, state: SheetState): Axes {
  const saved = snapshot.collaboration as unknown as { sheets: Record<string, Axes> } | undefined;
  if (saved?.sheets[id]) return jsonCopy(saved.sheets[id]);
  const initial = state.get("initial") as Axes;
  const sheet = (snapshot.sheets as unknown as IWorkbookData["sheets"] | undefined)?.[id];
  const align = (ids: string[], size: number, axis: string) => [
    ...ids.slice(0, size),
    ...Array.from(
      { length: Math.max(0, size - ids.length) },
      (_, index) => `snapshot-${axis}-${index}`,
    ),
  ];
  // Legacy snapshots carry no identities. Their extra coordinates are local
  // placeholders, so the Y structure still wins if an old snapshot grew/shrank.
  return {
    rowIds: align(initial.rowIds, sheet?.rowCount ?? initial.rowIds.length, "row"),
    colIds: align(initial.colIds, sheet?.columnCount ?? initial.colIds.length, "column"),
  };
}

/** A move may be delivered concurrently twice. Render each stable identity only once. */
export function spliceAxis(array: Y.Array<string>, index: number, count: number, insert: string[]) {
  const ids = [...new Set(array.toArray())];
  const removed = new Set(ids.slice(index, index + count));
  for (let i = array.length - 1; i >= 0; i--) {
    if (removed.has(array.get(i))) array.delete(i, 1);
  }
  const next = ids.filter((id) => !removed.has(id));
  const before = next[index];
  const rawIndex = before === undefined ? array.length : array.toArray().indexOf(before);
  array.insert(rawIndex, insert);
}

export interface AxisChange {
  kind: "insert" | "delete" | "move";
  index: number;
  count: number;
  /** Before movement, matching Univer's mutation payload. */
  destination?: number;
}

/** Transform a replica's ordered IDs without replacing its workbook or its history. */
export function reconcileAxis(
  previous: string[],
  next: string[],
  apply: (edit: AxisChange) => void,
) {
  const current = [...previous];
  const wanted = new Set(next);
  for (let i = current.length - 1; i >= 0; i--) {
    if (!wanted.has(current[i] as string)) {
      const end = i;
      while (i > 0 && !wanted.has(current[i - 1] as string)) i--;
      const count = end - i + 1;
      apply({ kind: "delete", index: i, count });
      current.splice(i, count);
    }
  }
  for (let i = 0; i < next.length; i++) {
    const id = next[i] as string;
    if (current[i] === id) continue;
    const from = current.indexOf(id, i);
    if (from < 0) {
      let count = 1;
      while (i + count < next.length && !current.includes(next[i + count] as string)) count++;
      apply({ kind: "insert", index: i, count });
      current.splice(i, 0, ...next.slice(i, i + count));
      i += count - 1;
    } else {
      let count = 1;
      while (from + count < current.length && current[from + count] === next[i + count]) count++;
      apply({ kind: "move", index: from, count, destination: i });
      const moved = current.splice(from, count);
      current.splice(i, 0, ...moved);
      i += count - 1;
    }
  }
}
