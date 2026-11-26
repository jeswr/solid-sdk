// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import {
  buildDigest,
  classifyUrgency,
  DEFAULT_LATE_WINDOW,
  DIGEST_RECEIPT_LIMIT,
  type DigestNotification,
  type DigestSchedule,
  digestGroupKey,
  inQuietHours,
  isDue,
  nextDigestTime,
} from "./index.js";

const n = (id: string, patch: Partial<DigestNotification> = {}): DigestNotification => ({
  id,
  kind: "comment",
  app: "docs",
  title: id,
  time: 10,
  read: false,
  ...patch,
});
const options = { since: 0, now: 100 };
const slot = (schedule: DigestSchedule, now: string, tz = "UTC") =>
  nextDigestTime(schedule, new Date(now), tz)?.toISOString();

describe("urgency", () => {
  it.each(["access-request", "security", "sign-in", "direct-mention"])("recognises %s", (kind) =>
    expect(classifyUrgency(n("a", { kind }))).toBe(true));
  it("honours source urgency and only blocking agent approvals", () => {
    expect(classifyUrgency(n("a", { urgent: true }))).toBe(true);
    expect(classifyUrgency(n("a", { kind: "access-request", category: "comment" }))).toBe(true);
    expect(classifyUrgency(n("a", { kind: "mention" }))).toBe(true);
    expect(
      classifyUrgency(n("a", { kind: "task", category: "agent-approval", blocking: true })),
    ).toBe(true);
    expect(classifyUrgency(n("a", { category: "agent-approval", blocking: false }))).toBe(false);
    expect(classifyUrgency(n("a"))).toBe(false);
  });
});
describe("digest", () => {
  it("handles empty, invalid, future and exclusive lower boundaries", () => {
    expect(
      buildDigest(
        [n("nan", { time: NaN }), n("before", { time: 0 }), n("future", { time: 101 })],
        options,
      ),
    ).toEqual({
      ...options,
      digestedIds: [],
      count: 0,
      unread: 0,
      omitted: 0,
      sections: [],
      agent: { actionsTaken: 0, approvalsWaiting: 0 },
      headline: "You're all caught up",
    });
  });
  it("uses receipts instead of creation time for late arrivals and retains bounded delivery history", () => {
    const previous = Array.from({ length: 500 }, (_, i) => `old-${i}`);
    const digest = buildDigest(
      [
        n("old-499", { time: 99 }),
        n("late", { time: 1 }),
        n("undated", { time: -8640000000000000, read: true }),
        n("future", { time: 101 }),
        n("invalid", { time: NaN }),
        n("late", { time: 0 }),
      ],
      { since: 90, now: 100, digestedIds: previous, lateWindow: Infinity },
    );
    expect(digest.count).toBe(2);
    expect(digest.unread).toBe(1);
    expect(digest.digestedIds).toHaveLength(500);
    // Listed receipts are refreshed: the still-listed old-499 moves to the newest end.
    expect(digest.digestedIds.slice(-3)).toEqual(["undated", "late", "old-499"]);
    expect(digest.digestedIds).not.toContain("old-0");
    expect(digest.digestedIds).not.toContain("old-1");
    expect(buildDigest([n("late")], { ...options, digestedIds: digest.digestedIds }).count).toBe(0);
    expect(buildDigest([n("first", { time: 0 })], { ...options, digestedIds: [] }).count).toBe(1);
  });
  it("keeps arrivals within the late window before since and drops older ones", () => {
    const since = DEFAULT_LATE_WINDOW + 1000;
    const late = n("late", { time: since - DEFAULT_LATE_WINDOW + 1 });
    const stale = n("stale", { time: since - DEFAULT_LATE_WINDOW });
    const digest = buildDigest([late, stale], { since, now: since + 1, digestedIds: [] });
    expect(digest.sections[0]?.items.map((i) => i.id)).toEqual(["late"]);
    expect(digest.digestedIds).toEqual(["late"]);
    expect(
      buildDigest([n("x", { time: 50 })], { since: 60, now: 100, digestedIds: [], lateWindow: 5 })
        .count,
    ).toBe(0);
    expect(
      buildDigest([n("x", { time: 56 })], { since: 60, now: 100, digestedIds: [], lateWindow: 5 })
        .count,
    ).toBe(1);
  });
  it("refreshes receipts for listed records so long-lived items are never re-digested", () => {
    const old = n("old", { time: 1 });
    let receipts: string[] = buildDigest([old], { since: 0, now: 2, digestedIds: [] }).digestedIds;
    expect(receipts).toEqual(["old"]);
    // Twelve deliveries of 100 newer records each, while old stays listed and later ones age out.
    for (let round = 0; round < 12; round++) {
      const fresh = Array.from({ length: 100 }, (_, i) =>
        n(`r${round}-${i}`, { time: 10 + round * 100 + i }),
      );
      const now = 10 + round * 100 + 100;
      const digest = buildDigest([old, ...fresh], {
        since: now - 100,
        now,
        digestedIds: receipts,
      });
      expect(digest.count).toBe(100);
      expect(digest.digestedIds.at(-1)).toBe(`r${round}-99`);
      receipts = digest.digestedIds;
      expect(receipts).toContain("old");
      expect(receipts.length).toBeLessThanOrEqual(DIGEST_RECEIPT_LIMIT);
    }
    expect(receipts).toHaveLength(DIGEST_RECEIPT_LIMIT);
    expect(receipts).not.toContain("r0-0");
    expect(buildDigest([old], { since: 1300, now: 1310, digestedIds: receipts }).count).toBe(0);
  });
  it("retains the newest and most urgent receipts when one listing exceeds the cap", () => {
    const records = [
      ...Array.from({ length: 600 }, (_, i) => n(`plain-${i}`, { time: 1 + i })),
      n("urgent-old", { time: 1, urgent: true }),
      n("read-new", { time: 700, read: true }),
    ];
    const digest = buildDigest(records, { since: 0, now: 1000, digestedIds: ["absent"] });
    expect(digest.count).toBe(602);
    expect(digest.digestedIds).toHaveLength(DIGEST_RECEIPT_LIMIT);
    expect(digest.digestedIds.at(-1)).toBe("urgent-old");
    expect(digest.digestedIds.at(-2)).toBe("plain-599");
    expect(digest.digestedIds).not.toContain("absent");
    expect(digest.digestedIds).not.toContain("read-new");
    expect(digest.digestedIds).not.toContain("plain-0");
    expect(digest.digestedIds).toContain("plain-101");
  });
  it("exposes each item's group key for matching live records", () => {
    const comment = n("a", { target: { id: "q4", title: "Q4 plan" } });
    const digest = buildDigest([comment, n("b", { category: "agent-action" })], options);
    expect(digest.sections[0]?.items[0]?.key).toBe(digestGroupKey(comment));
    expect(digestGroupKey(n("other", { target: { id: "q4", title: "Renamed" } }))).toBe(
      digestGroupKey(comment),
    );
    expect(digestGroupKey(n("c", { category: "agent-action", app: "x", title: "b" }))).toBe(
      digest.sections[1]?.items[0]?.key,
    );
  });
  it("groups repeats by app, target and category with stable ordering and names", () => {
    const input = [
      n("a", { actor: { id: "sam", name: "Sam" }, target: { id: "q4", title: "Q4 plan" } }),
      n("b", { actor: { name: "Jo" }, target: { id: "q4", title: "Q4 plan" } }),
      n("c", { actor: { name: "Lee" }, target: { id: "q4", title: "Q4 plan" } }),
      n("d", { app: "chat", target: { id: "q4", title: "Q4 plan" } }),
    ];
    const digest = buildDigest(input, options);
    expect(digest.count).toBe(4);
    expect(digest.sections).toHaveLength(2);
    expect(digest.sections[0]?.items[0]?.text).toBe(
      "Sam and 2 others commented on Q4 plan (3 comments)",
    );
    expect(digest.headline).toContain("1 comment on Q4 plan");
    expect(buildDigest(input.toReversed(), options)).toEqual(digest);
    expect(input[0]?.read).toBe(false);
  });
  it("prioritises urgent, unread, newest then id; deduplicates and preserves newest time", () => {
    const d = buildDigest(
      [
        n("old", { time: 2, urgent: true, target: { id: "x", title: "X" } }),
        n("new", { time: 90, target: { id: "x", title: "X" } }),
        n("read", { read: true, time: 99 }),
        n("b"),
        n("a"),
        n("a", { time: 10 }),
        n("a", { time: 9 }),
        n("a", { time: 11 }),
        n("z", { time: 12 }),
      ],
      options,
    );
    expect(d.sections[0]?.items.map((i) => i.id)).toEqual(["old", "z", "a", "b", "read"]);
    expect(d.sections[0]?.items[0]?.newest).toBe(90);
    expect(d.sections[0]?.items[0]?.unread).toBe(2);
    expect(d.count).toBe(6);
  });
  it("formats single actors, anonymous shares, repeats and distinct categories", () => {
    const d = buildDigest(
      [
        n("a", { actor: { name: "Sam" }, target: { id: "a", title: "Plan" } }),
        n("b", { target: { id: "b", title: "Notes" } }),
        n("c", { kind: "shared", actor: { name: "Sam" }, target: { id: "c", title: "File" } }),
        n("d", { kind: "shared", target: { id: "d", title: "Folder" } }),
        n("e", { kind: "shared", target: { id: "d", title: "Folder" } }),
        n("f", { kind: "task", target: { id: "f", title: "Task" } }),
        n("g", { kind: "task", target: { id: "f", title: "Task" } }),
      ],
      options,
    );
    expect(d.sections[0]?.items.map((i) => i.text)).toEqual([
      "Sam commented on Plan",
      "1 comment on Notes",
      "Sam shared File",
      "Someone shared Folder (2 updates)",
      "f (2 updates)",
    ]);
  });
  it("counts agent activity and pending approvals, including acknowledged ones in a dedicated section", () => {
    const d = buildDigest(
      [
        n("a", { category: "agent-action" }),
        n("b", { category: "agent-approval", blocking: true }),
        n("c", { category: "agent-approval", read: true }),
      ],
      options,
    );
    expect(d.agent).toEqual({ actionsTaken: 1, approvalsWaiting: 2 });
    expect(d.sections[0]?.app).toBe("agent");
    expect(d.sections[0]?.items.map((i) => i.text)).toEqual([
      "1 approval waiting",
      "Your agent did 1 thing",
      "1 approval waiting",
    ]);
    expect(d.headline).toBe("While you were away: your agent did 1 thing; 2 approvals waiting");
  });
  it("collapses repeated titles without a target and keeps the headline on one line", () => {
    const digest = buildDigest(
      [n("a", { title: "A new\n update" }), n("b", { title: "A new\n update" })],
      options,
    );
    expect(digest.sections[0]?.items).toHaveLength(1);
    expect(digest.headline).toBe("While you were away: A new update (2 updates)");
  });
  it("includes ordinary agent notifications in the headline", () => {
    expect(buildDigest([n("Agent update", { app: "agent" })], options).headline).toBe(
      "While you were away: Agent update",
    );
  });
  it("caps large digests while retaining all counts and bounding group id lists", () => {
    const d = buildDigest(
      Array.from({ length: 10000 }, (_, i) =>
        n(String(i), { target: { id: String(i % 100), title: "Plan" } }),
      ),
      options,
    );
    expect(d.count).toBe(10000);
    expect(d.unread).toBe(10000);
    expect(d.digestedIds).toHaveLength(500);
    expect(d.omitted).toBe(5000);
    expect(d.sections[0]?.count).toBe(10000);
    expect(d.sections[0]?.items).toHaveLength(50);
    expect(d.sections[0]?.items[0]?.notificationIds).toHaveLength(100);
    expect(
      buildDigest(
        Array.from({ length: 52 }, (_, i) => n(String(i), { app: String(i) })),
        options,
      ).sections,
    ).toHaveLength(50);
    const one = buildDigest(
      Array.from({ length: 1001 }, (_, i) =>
        n(String(i), { target: { id: "same", title: "Plan" } }),
      ),
      options,
    );
    expect(one.sections[0]?.items[0]?.notificationIds).toHaveLength(100);
  });
  it("uses an explicit async summary hook, preserves structure and propagates failures", async () => {
    const summarise = vi.fn(async () => "  A short summary  ");
    const digest = await buildDigest([n("a")], { ...options, summarise });
    expect(summarise).toHaveBeenCalledOnce();
    expect(digest.headline).toBe("A short summary");
    expect(digest).not.toHaveProperty("summarise");
    expect((await buildDigest([n("a")], { ...options, summarise: async () => " " })).headline).toBe(
      "While you were away: a",
    );
    await expect(
      buildDigest([], {
        ...options,
        summarise: async () => {
          throw new Error("offline");
        },
      }),
    ).rejects.toThrow("offline");
  });
});

describe("scheduling", () => {
  it("shares quiet-hour checks with delivery adapters", () => {
    const quiet = { enabled: true, start: "22:00", end: "08:00" };
    expect(inQuietHours(quiet, new Date("2026-11-11T23:00Z"))).toBe(true);
    expect(inQuietHours(quiet, new Date("2026-11-11T12:00Z"), "Europe/London")).toBe(false);
    expect(inQuietHours({ ...quiet, enabled: false }, new Date("2026-11-11T23:00Z"))).toBe(false);
  });
  it("supports off, hourly, daily and unordered twice-daily schedules", () => {
    expect(nextDigestTime({ mode: "off" }, new Date())).toBeNull();
    expect(slot({ mode: "hourly" }, "2026-11-11T12:00:00Z")).toBe("2026-11-11T13:00:00.000Z");
    expect(slot({ mode: "hourly" }, "2026-11-11T12:59:59Z")).toBe("2026-11-11T13:00:00.000Z");
    expect(slot({ mode: "daily", time: "00:00" }, "2026-11-11T23:59:59Z")).toBe(
      "2026-11-12T00:00:00.000Z",
    );
    expect(slot({ mode: "twice-daily", times: ["17:00", "09:00"] }, "2026-11-11T10:00:00Z")).toBe(
      "2026-11-11T17:00:00.000Z",
    );
    expect(slot({ mode: "twice-daily", times: ["09:00", "09:00"] }, "2026-11-11T09:00:00Z")).toBe(
      "2026-11-12T09:00:00.000Z",
    );
    expect(nextDigestTime({ mode: "hourly" }, new Date("2026-11-11T12:00Z"))).toBeInstanceOf(Date);
  });
  it("defers slots inside quiet hours including midnight wrap and partial hours", () => {
    const quietHours = { enabled: true, start: "22:00", end: "08:30" };
    expect(slot({ mode: "hourly", quietHours }, "2026-11-11T21:30Z")).toBe(
      "2026-11-12T08:30:00.000Z",
    );
    expect(slot({ mode: "daily", time: "23:00", quietHours }, "2026-11-12T07:00Z")).toBe(
      "2026-11-12T08:30:00.000Z",
    );
    expect(slot({ mode: "hourly", quietHours }, "2026-11-12T08:30Z")).toBe(
      "2026-11-12T09:00:00.000Z",
    );
    expect(
      slot(
        {
          mode: "daily",
          time: "12:00",
          quietHours: { enabled: true, start: "11:00", end: "13:30" },
        },
        "2026-11-11T10:00Z",
      ),
    ).toBe("2026-11-11T13:30:00.000Z");
    for (const enabled of [true, false])
      expect(
        slot(
          { mode: "daily", time: "12:00", quietHours: { enabled, start: "12:00", end: "12:00" } },
          "2026-11-11T10:00Z",
        ),
      ).toBe("2026-11-11T12:00:00.000Z");
  });
  it("resolves spring gaps and autumn folds in America/New_York and Europe/London", () => {
    expect(slot({ mode: "daily", time: "02:30" }, "2026-03-08T05:00Z", "America/New_York")).toBe(
      "2026-03-08T07:30:00.000Z",
    );
    expect(slot({ mode: "daily", time: "01:30" }, "2026-11-01T04:00Z", "America/New_York")).toBe(
      "2026-11-01T05:30:00.000Z",
    );
    expect(slot({ mode: "daily", time: "01:30" }, "2026-11-01T05:30Z", "America/New_York")).toBe(
      "2026-11-02T06:30:00.000Z",
    );
    expect(slot({ mode: "daily", time: "01:30" }, "2026-03-29T00:00Z", "Europe/London")).toBe(
      "2026-03-29T01:30:00.000Z",
    );
    expect(
      slot(
        {
          mode: "daily",
          time: "23:00",
          quietHours: { enabled: true, start: "22:00", end: "08:00" },
        },
        "2026-03-28T22:00Z",
        "Europe/London",
      ),
    ).toBe("2026-03-29T07:00:00.000Z");
    expect(slot({ mode: "daily", time: "09:00" }, "2026-11-11T00:00Z", "Asia/Kolkata")).toBe(
      "2026-11-11T03:30:00.000Z",
    );
  });
  it("keeps hourly deliveries in both occurrences of a repeated hour", () => {
    expect(slot({ mode: "hourly" }, "2026-11-01T05:00Z", "America/New_York")).toBe(
      "2026-11-01T06:00:00.000Z",
    );
    expect(slot({ mode: "hourly" }, "2026-11-01T06:00Z", "America/New_York")).toBe(
      "2026-11-01T07:00:00.000Z",
    );
  });
  it("defers repeated-hour slots to the matching quiet-hours end", () => {
    expect(
      slot(
        { mode: "hourly", quietHours: { enabled: true, start: "00:00", end: "01:30" } },
        "2026-11-01T06:00Z",
        "America/New_York",
      ),
    ).toBe("2026-11-01T06:30:00.000Z");
  });
  it("reports due boundaries, catch-up, initial delivery, quiet hours and clock rollback", () => {
    const schedule: DigestSchedule = { mode: "hourly" };
    const at = new Date("2026-11-11T12:01Z");
    expect(isDue(null, { mode: "off" }, at)).toBe(false);
    expect(isDue(null, schedule, at)).toBe(true);
    expect(isDue(at, schedule, new Date("2026-11-11T13:00Z"))).toBe(true);
    expect(isDue(at, schedule, new Date("2026-11-11T12:59Z"))).toBe(false);
    expect(isDue(at, schedule, new Date("2026-11-12T12:00Z"))).toBe(true);
    expect(isDue(at, schedule, new Date("2026-11-11T11:00Z"))).toBe(true);
    expect(isDue(at, schedule, at)).toBe(false);
    expect(
      isDue(
        new Date("2026-11-12T12:00Z"),
        { ...schedule, quietHours: { enabled: true, start: "12:00", end: "14:00" } },
        at,
      ),
    ).toBe(false);
    expect(
      isDue(null, { ...schedule, quietHours: { enabled: true, start: "12:00", end: "14:00" } }, at),
    ).toBe(false);
    expect(isDue(null, schedule, at, "Asia/Kolkata")).toBe(true);
  });
  it("rejects invalid schedules, dates and zones", () => {
    expect(() => nextDigestTime({ mode: "hourly" }, new Date("bad"))).toThrow("Invalid now");
    expect(() => slot({ mode: "daily", time: "25:00" }, "2026-11-11T00:00Z")).toThrow(
      "Expected HH:MM",
    );
    expect(() => slot({ mode: "daily", time: "09:00" }, "2026-11-11T00:00Z", "bad")).toThrow(
      RangeError,
    );
  });
});
