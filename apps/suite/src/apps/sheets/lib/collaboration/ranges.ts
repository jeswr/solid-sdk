// AUTHORED-BY Claude Opus 5.5
import type { AnchorDeletions } from "../comments/anchors";
import type { AxisRange } from "../refs/model";
import { indexToColumn, parseA1 } from "../refs/notation";
import type { Axes } from "./model";

/** The stable row and column ids an A1 range covers in a sheet's current axes. */
export function rangeIdentity(position: Axes | undefined, range: string | null): Axes | undefined {
  if (!position || range === null) return undefined;
  const ref = parseA1(range);
  const rows = ref.rows as AxisRange;
  const columns = ref.columns as AxisRange;
  return {
    rowIds: position.rowIds.slice(rows.start.index - 1, rows.end.index),
    colIds: position.colIds.slice(columns.start.index - 1, columns.end.index),
  };
}

/** The A1 range spanning the ids that still exist, or null once a whole axis is gone. */
export function identityRange(position: Axes | undefined, identity: Axes): string | null {
  if (!position) return null;
  const rows = identity.rowIds.map((id) => position.rowIds.indexOf(id)).filter((i) => i >= 0);
  const cols = identity.colIds.map((id) => position.colIds.indexOf(id)).filter((i) => i >= 0);
  if (!rows.length || !cols.length) return null;
  const start = `${indexToColumn(Math.min(...cols) + 1)}${Math.min(...rows) + 1}`;
  return `${start}:${indexToColumn(Math.max(...cols) + 1)}${Math.max(...rows) + 1}`;
}

type Kind = "anchors" | "drafts";
const KINDS: readonly Kind[] = ["anchors", "drafts"];
/** A comment anchor's cell, pinned by the stable ids of its row and column. */
export type CellIdentity = { sheetId: string; rowId: string; colId: string };

/**
 * Pin each deleted anchor's cell to stable ids, preferring ids already known (a peer's
 * deletion arrives after its cells are gone, so its A1 address no longer resolves).
 */
export function captureAnchorIdentities(
  deleted: AnchorDeletions,
  known: (kind: Kind, id: string) => CellIdentity | undefined,
  position: (sheetId: string) => Axes | undefined,
): Map<string, Axes> {
  const stable = new Map<string, Axes>();
  for (const kind of KINDS) {
    for (const [id, anchor] of Object.entries(deleted[kind])) {
      const cell = known(kind, id);
      const identity = cell
        ? { rowIds: [cell.rowId, cell.rowId], colIds: [cell.colId, cell.colId] }
        : rangeIdentity(position(anchor.sheetId), anchor.cell);
      if (identity) stable.set(`${kind}:${id}`, identity);
    }
  }
  return stable;
}

/** The deleted anchors whose cells still exist, moved to where those cells are now. */
export function restoreAnchorIdentities(
  deleted: AnchorDeletions,
  stable: Map<string, Axes>,
  position: (sheetId: string) => Axes | undefined,
): AnchorDeletions {
  const restored: AnchorDeletions = { revision: deleted.revision, anchors: {}, drafts: {} };
  for (const kind of KINDS) {
    for (const [id, anchor] of Object.entries(deleted[kind])) {
      const identity = stable.get(`${kind}:${id}`);
      const range = identity && identityRange(position(anchor.sheetId), identity);
      if (range) restored[kind][id] = { ...anchor, cell: range.split(":")[0] as string };
    }
  }
  return restored;
}
