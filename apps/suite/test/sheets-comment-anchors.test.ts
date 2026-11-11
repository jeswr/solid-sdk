// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { expect, it, vi } from "vitest";
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
  const deletion = state.shift(edit);
  expired.dispose();
  expect(draft.current().deleted).toBe(true);
  expect(state.snapshot().commentAnchors?.anchors).toEqual({
    root: "deleted",
    gone: "deleted",
    other: { sheetId: "other", cell: "B3" },
  });
  state.shift({ ...edit, kind: "insert" });
  expect(draft.current().deleted).toBe(true);
  state.revive(deletion);
  expect(draft.current()).toEqual(anchor);
  state.revive(deletion);
  expect(deletion.anchors).toEqual({ root: { sheetId: "stable", cell: "B3" } });
  expect(draft.current()).toEqual(anchor);
  state.shift(edit);
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
  const deletion = state.shift(edit);
  draft.commit("published");
  draft.dispose();
  expect(state.snapshot().commentAnchors?.anchors.published).toBe("deleted");
  state.revive(deletion);
  expect(currentCommentAnchor(state.snapshot(), "published", anchor)).toEqual(anchor);
  state.revive(deletion);
  state.shift(edit);
  expect(state.snapshot().commentAnchors?.anchors.published).toBe("deleted");
  state.load({});
  state.revive(deletion);
  expect(state.snapshot()).toEqual({});
});

it("sanitizes optional anchor collections independently, retaining valid entries and chart metadata", async () => {
  const { validateCommentSnapshot } = await import("../src/apps/sheets/lib/comments/anchors");
  const workbook = { sheets: { stable: { name: "Data" } }, charts: { version: 1, entries: [] } };
  expect(validateCommentSnapshot(workbook)).toBe(workbook);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    for (const commentAnchors of [null, { version: 2, anchors: {} }, { version: 1 }]) {
      expect(validateCommentSnapshot({ ...workbook, commentAnchors })).toEqual(workbook);
    }
    const cleaned = validateCommentSnapshot({
      ...workbook,
      commentAnchors: {
        version: 1,
        anchors: {
          root: { sheetId: "stable", cell: "D5" },
          gone: "deleted",
          bad: { sheetId: "stable", cell: "$B$3" },
          "": "deleted",
          overflow: { sheetId: "stable", cell: Infinity },
        },
      },
    });
    expect(cleaned).toEqual({
      ...workbook,
      commentAnchors: {
        version: 1,
        anchors: { root: { sheetId: "stable", cell: "D5" }, gone: "deleted" },
      },
    });
    expect(() => serializeSnapshot(cleaned)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(6);
  } finally {
    warn.mockRestore();
  }
});

it("opens, saves and creates mixed snapshots without invalid optional entries hiding the other feature or cells", async () => {
  const { harness, snapshot } = await import("./sheets-workbook-helpers");
  const { readCharts } = await import("../src/apps/sheets/lib/charts/spec");
  const h = await harness();
  const chart = {
    id: "chart",
    sheetId: "data",
    range: "A1:B2",
    type: "column",
    title: "Values",
    legend: true,
    series: "columns",
  };
  const book = await h.service.create({ title: "Both", snapshot: snapshot() });
  const goodAnchors = {
    version: 1,
    anchors: { root: { sheetId: "data", cell: "B2" }, gone: "deleted" },
  };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    for (const [charts, commentAnchors, expectedCharts, expectedAnchors] of [
      [
        { version: 1, entries: [chart, { ...chart, id: "bad", range: "invalid" }] },
        goodAnchors,
        [chart],
        goodAnchors,
      ],
      [
        { version: 1, entries: [chart] },
        {
          version: 1,
          anchors: { ...goodAnchors.anchors, bad: { sheetId: "data", cell: "invalid" } },
        },
        [chart],
        goodAnchors,
      ],
      [{ version: 2, entries: [] }, goodAnchors, [], goodAnchors],
      [{ version: 1, entries: [chart] }, { version: 2, anchors: {} }, [chart], undefined],
    ] as const) {
      const mixed = {
        ...book.snapshot,
        charts,
        commentAnchors,
      } as unknown as import("../src/apps/sheets/lib/contract").Snapshot;
      await h.fetch(`${book.container}workbook.json`, {
        method: "PUT",
        body: JSON.stringify(mixed),
      });
      const opened = await h.service.open(book.container);
      const assert = (value: typeof opened.snapshot) => {
        expect(readCharts(value).charts).toEqual(expectedCharts);
        expect(value.commentAnchors).toEqual(expectedAnchors);
        expect(value.sheets).toEqual(book.snapshot.sheets);
      };
      assert(opened.snapshot);
      await h.service.save(book.container, mixed, opened.version);
      assert((await h.service.open(book.container)).snapshot);
      assert((await h.service.create({ title: "Mixed copy", snapshot: mixed })).snapshot);
      const current = await h.storage.loadSnapshot(book.container);
      await h.storage.saveSnapshot(book.container, mixed, { ifMatch: current.etag as string });
      assert((await h.storage.loadSnapshot(book.container)).value);
    }
  } finally {
    warn.mockRestore();
  }
});
