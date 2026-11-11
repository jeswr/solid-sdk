// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import {
  currentCommentAnchor,
  WorkbookCommentAnchors,
} from "../src/apps/sheets/lib/comments/anchors";
import { deserializeSnapshot, serializeSnapshot } from "../src/apps/sheets/lib/model/snapshot";

const anchor = { sheetId: "stable", cell: "B3", deleted: false };
const edit = { sheet: "stable", axis: "row" as const, kind: "delete" as const, index: 3, count: 1 };
it("validates versioned anchor state on save and open, preserving legacy selector fallback", () => {
  const valid = {
    commentAnchors: {
      version: 1,
      anchors: { root: { sheetId: "stable", cell: "D5" }, gone: "deleted" },
    },
  };
  expect(deserializeSnapshot(serializeSnapshot(valid))).toEqual(valid);
  expect(currentCommentAnchor(valid, "root", anchor)).toEqual({ ...anchor, cell: "D5" });
  expect(currentCommentAnchor(valid, "gone", anchor)).toEqual({ ...anchor, deleted: true });
  expect(currentCommentAnchor(valid, "missing", anchor)).toBe(anchor);
  expect(currentCommentAnchor({}, "root", anchor)).toBe(anchor);
  for (const value of [
    null,
    { version: 2, anchors: {} },
    { version: 1 },
    { version: 1, anchors: { root: { sheetId: "", cell: "B3" } } },
    { version: 1, anchors: { root: { sheetId: "s", cell: "$B$3" } } },
    { version: 1, anchors: { root: "B3" } },
    { version: 1, anchors: { "": "deleted" } },
    { version: 1, anchors: {}, extra: true },
  ]) {
    expect(() => serializeSnapshot({ commentAnchors: value })).toThrow();
    expect(() => deserializeSnapshot(JSON.stringify({ commentAnchors: value }))).toThrow();
  }
});
it("tracks each root synchronously, isolates snapshots and keeps draft history out of persisted state", () => {
  const state = new WorkbookCommentAnchors({});
  expect(state.snapshot()).toEqual({});
  expect(
    state.register({
      root: anchor,
      gone: { ...anchor, deleted: true },
      other: { ...anchor, sheetId: "other" },
    }),
  ).toBe(true);
  expect(state.register({ root: { ...anchor, cell: "Z9" } })).toBe(false);
  const draft = state.track(anchor);
  const expired = state.track(anchor);
  const before = state.checkpoint();
  expired.dispose();
  state.shift(edit);
  const after = state.checkpoint();
  expect(draft.current().deleted).toBe(true);
  expect(state.snapshot().commentAnchors?.anchors).toEqual({
    root: "deleted",
    gone: "deleted",
    other: { sheetId: "other", cell: "B3" },
  });
  state.shift({ ...edit, kind: "insert" });
  expect(draft.current().deleted).toBe(true);
  state.restore(before);
  expect(draft.current()).toEqual(anchor);
  state.restore(after);
  expect(draft.current().deleted).toBe(true);
  state.load({
    commentAnchors: { version: 1, anchors: { root: { sheetId: "stable", cell: "C4" } } },
  });
  const saved = state.snapshot();
  expect(Object.keys(saved)).toEqual(["commentAnchors"]);
  if (saved.commentAnchors) saved.commentAnchors.anchors.root = "deleted";
  expect(state.snapshot().commentAnchors?.anchors.root).toEqual({ sheetId: "stable", cell: "C4" });
  draft.dispose();
  state.load({});
  expect(state.snapshot()).toEqual({});
});

it("carries draft deletion history into a thread persisted after the structural edit", () => {
  const state = new WorkbookCommentAnchors({});
  const draft = state.track(anchor);
  const before = state.checkpoint();
  state.shift(edit);
  const after = state.checkpoint();
  draft.commit("published");
  draft.dispose();
  expect(state.snapshot().commentAnchors?.anchors.published).toBe("deleted");
  state.restore(before);
  expect(currentCommentAnchor(state.snapshot(), "published", anchor)).toEqual(anchor);
  state.restore(after);
  expect(state.snapshot().commentAnchors?.anchors.published).toBe("deleted");
  state.load({});
  state.restore(before);
  expect(state.snapshot()).toEqual({});
});
