// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  ActivityError,
  type ActivityErrorCode,
  type ChangeEvent,
  foldActivity,
  groupActivityByDay,
  moveStar,
  recentFiles,
  setStarred,
  toggleStarred,
} from "../src/apps/drive/lib/activity";

const a = "https://example.org/drive/report.pdf";
const b = "https://example.org/archive/report.pdf";
const c = "https://example.org/drive/notes.md";
const actor = "https://example.org/people/morgan#me";
const otherActor = "https://example.org/people/robin#me";
const day = Date.UTC(2026, 9, 26);

function event(overrides: Partial<ChangeEvent> = {}): ChangeEvent {
  return {
    id: "event-1",
    fileId: "file-1",
    url: a,
    type: "created",
    kind: "resource",
    actor,
    at: day,
    ...overrides,
  } as ChangeEvent;
}

function fails(fn: () => unknown, code: ActivityErrorCode): void {
  expect(fn).toThrow(ActivityError);
  expect(fn).toThrow(expect.objectContaining({ code, name: "ActivityError" }));
}

describe("Drive activity folding", () => {
  it("handles empty streams and retains chronological history, actors and original URLs", () => {
    expect(foldActivity([])).toEqual(new Map());
    const created = event();
    const updated = event({ id: "2", type: "updated", at: day + 1, actor: otherActor });
    const moved = event({ id: "3", type: "moved", fromUrl: a, url: b, at: day + 2 });
    const shared = event({ id: "4", type: "shared", url: b, at: day + 3 });
    const deleted = event({ id: "5", type: "deleted", url: b, at: day + 4 });
    const input = Object.freeze(
      [deleted, updated, shared, moved, created].map((item) => Object.freeze(item)),
    );
    const result = foldActivity(input);
    expect(result.get("file-1")).toEqual({
      fileId: "file-1",
      url: b,
      kind: "resource",
      deleted: true,
      lastActivityAt: day + 4,
      events: [created, updated, moved, shared, deleted],
    });
    expect(result.get("file-1")?.events[0]).not.toBe(created);
    expect(input[0]).toEqual(deleted);
    expect(recentFiles(input)).toEqual([]);
  });

  it("deduplicates exact replay, keeps tie order, and supports partial histories", () => {
    const update = event({ type: "updated" });
    const move = event({ id: "move", type: "moved", fromUrl: a, url: b });
    expect(foldActivity([update, move, update]).get("file-1")?.events).toEqual([update, move]);
    expect(foldActivity([move]).get("file-1")?.url).toBe(b);
    expect(foldActivity([event({ type: "deleted" })]).get("file-1")?.deleted).toBe(true);
    expect(foldActivity([event({ type: "shared" })]).size).toBe(1);
    fails(() => foldActivity([move, update]), "inconsistent-history");
  });

  it("follows repeated moves and permits a different file at a vacated URL", () => {
    const stream = [
      event(),
      event({ id: "2", type: "moved", fromUrl: a, url: b, at: day + 1 }),
      event({ id: "3", fileId: "file-2", at: day + 2 }),
      event({ id: "4", type: "moved", fromUrl: b, url: c, at: day + 3 }),
      event({ id: "5", type: "updated", url: c, at: day + 4 }),
    ];
    expect(recentFiles(stream).map(({ fileId, url }) => [fileId, url])).toEqual([
      ["file-1", c],
      ["file-2", a],
    ]);
    expect(
      foldActivity([
        event({ type: "deleted" }),
        event({ id: "new", fileId: "new-file", at: day + 1 }),
      ]).size,
    ).toBe(2);
  });

  it("detaches output from input and from subsequent folds", () => {
    const original = event();
    const first = foldActivity([original]);
    (original as { actor: string }).actor = otherActor;
    expect(first.get("file-1")?.events[0]?.actor).toBe(actor);
    const second = foldActivity([original]);
    expect(second.get("file-1")?.events[0]?.actor).toBe(otherActor);
  });

  it("rejects conflicting replay IDs", () => {
    for (const change of [
      { fileId: "other" },
      { url: b },
      { kind: "container" },
      { actor: otherActor },
      { at: day + 1 },
      { type: "shared" },
      { type: "moved", fromUrl: b },
    ]) {
      fails(
        () => foldActivity([event(), event(change as Partial<ChangeEvent>)]),
        "conflicting-event",
      );
    }
    const move = event({ type: "moved", fromUrl: b });
    fails(() => foldActivity([move, event({ type: "moved", fromUrl: c })]), "conflicting-event");
  });

  it("rejects contradictory histories instead of merging file identities or guessing moves", () => {
    const changes: Partial<ChangeEvent>[] = [
      { type: "created" },
      { type: "updated", kind: "container" },
      { type: "updated", url: b },
      { type: "moved", fromUrl: b, url: c },
    ];
    for (const change of changes) {
      fails(
        () => foldActivity([event(), event({ ...change, id: "2", at: day + 1 })]),
        "inconsistent-history",
      );
    }
    for (const type of ["created", "updated", "shared", "deleted"] as const) {
      fails(
        () => foldActivity([event({ type: "deleted" }), event({ id: "2", type, at: day + 1 })]),
        "inconsistent-history",
      );
    }
    fails(() => foldActivity([event({ type: "moved", fromUrl: a })]), "inconsistent-history");
    fails(
      () => foldActivity([event(), event({ id: "2", fileId: "other" })]),
      "inconsistent-history",
    );
    fails(
      () =>
        foldActivity([
          event(),
          event({ id: "2", fileId: "other", type: "moved", fromUrl: a, url: b }),
        ]),
      "inconsistent-history",
    );
    fails(
      () =>
        foldActivity([
          event(),
          event({ id: "2", fileId: "other", url: b }),
          event({ id: "3", type: "moved", fromUrl: a, url: b, at: day + 1 }),
        ]),
      "inconsistent-history",
    );
  });
});

describe("Recent files", () => {
  it("excludes folders/deleted files, deduplicates by identity and counts shares and moves", () => {
    const stream = [
      event(),
      event({ id: "2", type: "updated", at: day + 1 }),
      event({
        id: "3",
        fileId: "folder",
        url: "https://example.org/folder/",
        kind: "container",
        at: day + 4,
      }),
      event({ id: "4", fileId: "file-2", url: c, at: day + 2 }),
      event({ id: "5", type: "shared", at: day + 3 }),
    ];
    expect(recentFiles(stream).map(({ fileId }) => fileId)).toEqual(["file-1", "file-2"]);
    expect(recentFiles(stream, 1).map(({ fileId }) => fileId)).toEqual(["file-1"]);
    expect(recentFiles(stream, 0)).toEqual([]);
  });

  it("orders time ties by file ID in either input order and caps the default list at 50", () => {
    const first = event();
    const second = event({ id: "2", fileId: "file-2", url: c });
    for (const stream of [
      [first, second],
      [second, first],
    ]) {
      expect(recentFiles(stream).map(({ fileId }) => fileId)).toEqual(["file-1", "file-2"]);
    }
    const many = Array.from({ length: 55 }, (_, i) =>
      event({
        id: `event-${i}`,
        fileId: `file-${i}`,
        url: `https://example.org/${i}`,
        at: day + i,
      }),
    );
    expect(recentFiles(many)).toHaveLength(50);
    expect(recentFiles(many)[0]?.fileId).toBe("file-54");
    expect(recentFiles(many).at(-1)?.fileId).toBe("file-5");
  });

  it.each([-1, 51, 1.5, NaN, Infinity, "5", null])("rejects limit %s", (limit) => {
    fails(() => recentFiles([], limit as number), "invalid-limit");
  });
  it("still validates the stream with limit zero", () => {
    fails(() => recentFiles([event({ at: NaN })], 0), "invalid-time");
  });
});

describe("Starred sets", () => {
  it("adds, removes, toggles and re-points immutably and idempotently", () => {
    const input = new Set([a]);
    expect(setStarred(input, b, true)).toEqual(new Set([a, b]));
    expect(setStarred(input, a, true)).toEqual(input);
    expect(setStarred(input, a, true)).not.toBe(input);
    expect(setStarred(input, a, false)).toEqual(new Set());
    expect(setStarred(input, b, false)).toEqual(input);
    expect(toggleStarred(input, a)).toEqual(new Set());
    expect(toggleStarred(input, b)).toEqual(new Set([a, b]));
    expect(moveStar(input, a, b)).toEqual(new Set([b]));
    expect(moveStar(input, b, c)).toEqual(input);
    expect(moveStar(input, a, a)).toEqual(input);
    expect(moveStar(new Set([a, b]), a, b)).toEqual(new Set([b]));
    expect(input).toEqual(new Set([a]));
    expect(setStarred(new Set(), "http://other.example.org/report.pdf?version=2", true).size).toBe(
      1,
    );
  });

  it("rejects malformed sets, values, action flags and move addresses", () => {
    fails(() => setStarred([] as unknown as Set<string>, a, true), "invalid-stars");
    fails(() => toggleStarred(new Set(["bad"]), a), "invalid-url");
    fails(() => setStarred(new Set(), a, 1 as unknown as boolean), "invalid-stars");
    fails(() => setStarred(new Set(), "bad", true), "invalid-url");
    fails(() => toggleStarred(new Set(), "bad"), "invalid-url");
    fails(() => moveStar(new Set(), "bad", a), "invalid-url");
    fails(() => moveStar(new Set(), a, "bad"), "invalid-url");
  });
});

describe("Calendar-day activity groups", () => {
  it("groups empty and shuffled streams newest-first and deduplicates replays", () => {
    expect(groupActivityByDay([], "UTC")).toEqual([]);
    const first = event();
    const second = event({ id: "2", type: "updated", at: day + 1 });
    const older = event({ id: "3", type: "shared", at: day - 1 });
    const tied = event({ id: "4", type: "shared", actor: otherActor });
    expect(groupActivityByDay([first, older, second, tied, older], "UTC")).toEqual([
      { date: "2026-10-26", items: [second, first, tied] },
      { date: "2026-10-25", items: [older] },
    ]);
  });

  it("uses local midnight across month/year and leap-day boundaries", () => {
    const stream = [
      event({ at: Date.UTC(2026, 0, 1) }),
      event({ id: "2", at: Date.UTC(2026, 0, 1, 8) }),
    ];
    expect(groupActivityByDay(stream, "America/Los_Angeles").map(({ date }) => date)).toEqual([
      "2026-01-01",
      "2025-12-31",
    ]);
    expect(groupActivityByDay([event({ at: Date.UTC(2024, 1, 29, 12) })], "UTC")[0]?.date).toBe(
      "2024-02-29",
    );
    expect(groupActivityByDay([event({ at: 0 })], "America/Los_Angeles")[0]?.date).toBe(
      "1969-12-31",
    );
    expect(groupActivityByDay([event({ at: 253402300799999 })], "UTC")[0]?.date).toBe("9999-12-31");
  });

  it("keeps both repeated DST hours in one local calendar day", () => {
    const times = [Date.UTC(2026, 10, 1, 5, 30), Date.UTC(2026, 10, 1, 6, 30)];
    const groups = groupActivityByDay(
      times.map((at, i) => event({ id: `${i}`, at })),
      "America/New_York",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.date).toBe("2026-11-01");
    expect(groups[0]?.items.map(({ at }) => at)).toEqual([...times].reverse());
    // Spring's 23-hour day is also one day, not a fixed 86,400,000ms bucket.
    expect(
      groupActivityByDay(
        [
          event({ at: Date.UTC(2026, 2, 8, 5) }),
          event({ id: "2", at: Date.UTC(2026, 2, 9, 3, 59) }),
        ],
        "America/New_York",
      ),
    ).toHaveLength(1);
  });

  it.each(["", " ", " UTC", "Invalid/Zone", null, 42])("rejects zone %s", (zone) => {
    fails(() => groupActivityByDay([], zone as string), "invalid-time-zone");
  });
  it("rejects local dates beyond the supported year range", () => {
    fails(
      () => groupActivityByDay([event({ at: 253402300799999 })], "Pacific/Kiritimati"),
      "invalid-time",
    );
  });
});

describe("Fail-closed runtime inputs", () => {
  it.each([null, {}, "events", new Set()])("rejects non-array streams %s", (input) => {
    fails(() => foldActivity(input as ChangeEvent[]), "invalid-events");
  });
  it.each([null, undefined, [], 42, "event"])("rejects invalid event records %s", (input) => {
    fails(() => foldActivity([input as unknown as ChangeEvent]), "invalid-event");
  });
  it.each([
    { id: "" },
    { id: 1 },
    { fileId: " " },
    { fileId: "\ud800" },
    { kind: "file" },
    { type: "renamed" },
    { fromUrl: undefined },
  ])("rejects invalid event fields %s", (input) => {
    fails(() => foldActivity([event(input as Partial<ChangeEvent>)]), "invalid-event");
  });
  it.each([
    NaN,
    Infinity,
    -1,
    0.1,
    253402300800000,
    "2026-10-26",
    null,
  ])("rejects time %s", (at) => {
    fails(() => foldActivity([event({ at: at as number })]), "invalid-time");
  });
  it.each([
    "",
    " ",
    "not a URL",
    "/relative",
    "ftp://example.org/a",
    "https://example.org/a#file",
    "https://example.org/a#",
    "https://user@example.org/a",
    "https://:pass@example.org/a",
    "https://EXAMPLE.org/a",
    " https://example.org/a",
    "https://example.org/a/../b",
    "https://example.org/a\n",
    "https://example.org/\ud800",
    null,
  ])("rejects unsupported resource URL %s", (url) => {
    fails(() => foldActivity([event({ url: url as string })]), "invalid-url");
  });
  it("validates actors and move sources without exposing values in errors", () => {
    fails(() => foldActivity([event({ actor: "not-an-actor" })]), "invalid-url");
    fails(() => foldActivity([event({ type: "moved", fromUrl: "bad", url: b })]), "invalid-url");
    try {
      foldActivity([event({ actor: "private-invalid-actor" })]);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toBe("Drive activity: invalid-url");
    }
  });
});
