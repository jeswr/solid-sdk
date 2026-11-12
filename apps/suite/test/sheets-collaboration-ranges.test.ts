// AUTHORED-BY Claude Opus 5.5
import { expect, it } from "vitest";
import type { Axes } from "../src/apps/sheets/lib/collaboration/model";
import {
  captureAnchorIdentities,
  identityRange,
  rangeIdentity,
  restoreAnchorIdentities,
} from "../src/apps/sheets/lib/collaboration/ranges";
import type { AnchorDeletions } from "../src/apps/sheets/lib/comments/anchors";

const grid: Axes = { rowIds: ["r1", "r2", "r3"], colIds: ["a", "b", "c"] };

it("a range's identity is the stable ids it covers, or nothing without a sheet or range", () => {
  expect(rangeIdentity(grid, "B2:C3")).toEqual({ rowIds: ["r2", "r3"], colIds: ["b", "c"] });
  expect(rangeIdentity(undefined, "A1")).toBeUndefined();
  expect(rangeIdentity(grid, null)).toBeUndefined();
});

it("an identity resolves to the span of its surviving ids, and to null once an axis is gone", () => {
  const moved: Axes = { rowIds: ["r0", "r3", "r2"], colIds: ["c", "x", "b"] };
  expect(identityRange(moved, { rowIds: ["r2", "r3"], colIds: ["b", "c"] })).toBe("A2:C3");
  expect(identityRange(moved, { rowIds: ["r1", "r2"], colIds: ["a", "b"] })).toBe("C3:C3");
  expect(identityRange(undefined, { rowIds: ["r1"], colIds: ["a"] })).toBeNull();
  expect(identityRange(moved, { rowIds: ["r1"], colIds: ["b"] })).toBeNull();
  expect(identityRange(moved, { rowIds: ["r2"], colIds: ["a"] })).toBeNull();
});

it("deleted anchors are pinned by known ids first, then by their address, and restored where they are now", () => {
  const deleted: AnchorDeletions = {
    revision: 4,
    anchors: {
      known: { sheetId: "s", cell: "Z99" },
      addressed: { sheetId: "s", cell: "B2" },
      lostSheet: { sheetId: "gone", cell: "A1" },
    },
    drafts: { draft: { sheetId: "s", cell: "C3", deleted: false } },
  };
  const position = (sheetId: string) => (sheetId === "s" ? grid : undefined);
  const stable = captureAnchorIdentities(
    deleted,
    (kind, id) =>
      kind === "anchors" && id === "known" ? { sheetId: "s", rowId: "r1", colId: "a" } : undefined,
    position,
  );
  expect([...stable.keys()]).toEqual(["anchors:known", "anchors:addressed", "drafts:draft"]);
  // Column "b" is deleted and a row is inserted above: B2's anchor is gone, the others move down.
  const after: Axes = { rowIds: ["new", "r1", "r2", "r3"], colIds: ["a", "c"] };
  const restored = restoreAnchorIdentities(deleted, stable, (sheetId) =>
    sheetId === "s" ? after : undefined,
  );
  expect(restored).toEqual({
    revision: 4,
    anchors: { known: { sheetId: "s", cell: "A2" } },
    drafts: { draft: { sheetId: "s", cell: "B4", deleted: false } },
  });
});
