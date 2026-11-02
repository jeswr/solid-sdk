// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  dismissNotification,
  groupNotifications,
  markNotificationsRead,
  mergeNotifications,
  type NotificationOverlay,
  reconcileReadIds,
  type SuiteNotification,
  unreadCount,
  unreadLabel,
} from "../src/shell/lib/notifications-model";

const n = (id: string, createdAt = new Date(2026, 10, 1, 12), read = false): SuiteNotification => ({
  id,
  createdAt,
  read,
  kind: "shared",
  title: id,
});
const empty = (): NotificationOverlay => ({ read: new Set(), dismissed: new Set() });
describe("notification model", () => {
  it("deduplicates across sources, prefers newest content and sorts deterministically without mutating inputs", () => {
    const older = n("duplicate", new Date(1));
    const newer = { ...n("duplicate", new Date(3)), title: "Newest" };
    const read = { ...older, read: true };
    expect(
      mergeNotifications(
        [
          [newer, n("b", new Date(2)), n("a", new Date(2))],
          [older, read],
        ],
        empty(),
      ),
    ).toEqual([{ ...newer, read: true }, n("a", new Date(2)), n("b", new Date(2))]);
    expect(mergeNotifications([[older], [newer]], empty())[0]?.title).toBe("Newest");
    expect(mergeNotifications([[read], [older]], empty())[0]?.read).toBe(true);
    expect(newer.read).toBe(false);
    expect(mergeNotifications([], empty())).toEqual([]);
  });
  it("local reads win until every carrying source confirms; dismissal hides every duplicate", () => {
    let overlay = markNotificationsRead(empty(), ["a", "absent"]);
    expect(mergeNotifications([[n("a")], [n("a")]], overlay)[0]?.read).toBe(true);
    expect(reconcileReadIds(overlay.read, [[n("a", new Date(), true)], [n("a")]])).toEqual(
      new Set(["a", "absent"]),
    );
    expect(reconcileReadIds(overlay.read, [[n("a", new Date(), true)]])).toEqual(
      new Set(["absent"]),
    );
    expect(reconcileReadIds(new Set(), [])).toEqual(new Set());
    const previous = overlay;
    overlay = dismissNotification(overlay, "a");
    expect(
      mergeNotifications([[n("a"), n("b")], [n("a")]], overlay).map((item) => item.id),
    ).toEqual(["b"]);
    expect(previous.dismissed.size).toBe(0);
  });
  it("groups at the viewer's local midnight with an injected clock, including DST", () => {
    const now = new Date(2026, 9, 25, 23, 59, 59); // Europe/London DST ends today.
    const items = [
      n("midnight", new Date(2026, 9, 25)),
      n("today", now),
      n("yesterday", new Date(2026, 9, 24, 23, 59, 59)),
      n("tomorrow", new Date(2026, 9, 26)),
    ];
    expect(
      groupNotifications(items, now).map((group) => [
        group.label,
        group.items.map((item) => item.id),
      ]),
    ).toEqual([
      ["Today", ["midnight", "today"]],
      ["Earlier", ["yesterday", "tomorrow"]],
    ]);
    expect(groupNotifications(items.slice(0, 2), new Date(2026, 9, 26, 0, 0, 1))[0]?.label).toBe(
      "Earlier",
    );
    expect(groupNotifications([], now)).toEqual([]);
    expect(groupNotifications([n("a", now)], now)).toHaveLength(1);
  });
  it("counts unread items and caps only the display at 99+", () => {
    const items = Array.from({ length: 103 }, (_, i) => n(String(i), new Date(), i < 2));
    expect(unreadCount(items)).toBe(101);
    expect(unreadLabel(unreadCount(items))).toBe("99+");
    expect(unreadLabel(99)).toBe("99");
    expect(unreadLabel(0)).toBe("0");
    expect(unreadCount([])).toBe(0);
  });
});
