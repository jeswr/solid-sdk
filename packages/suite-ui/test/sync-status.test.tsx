// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { relativeTime } from "../src/sync/lib/time.js";
import { syncStatus } from "../src/sync/status.js";
import type { SyncSnapshot } from "../src/sync/types.js";

const now = new Date("2026-10-20T12:00:00Z");
const change = {
  id: "one",
  label: "Save notes",
  where: "Work",
  queuedAt: now,
  state: "pending" as const,
};
const conflict = {
  id: "one",
  name: "Notes",
  where: "Work",
  summary: "Changed twice",
  changedAt: now,
};
function snapshot(
  online: boolean,
  reconnecting: boolean,
  pending: number,
  conflicts: number,
): SyncSnapshot {
  return {
    online,
    reconnecting,
    pending: Array.from({ length: pending }, () => change),
    conflicts: Array.from({ length: conflicts }, () => conflict),
  };
}
describe("syncStatus", () => {
  for (const online of [false, true])
    for (const reconnecting of [false, true])
      for (const pending of [0, 1, 3])
        for (const conflicts of [0, 1, 3]) {
          it(`precedence: online=${online}, reconnecting=${reconnecting}, pending=${pending}, conflicts=${conflicts}`, () => {
            const expected = conflicts
              ? {
                  kind: "conflict",
                  label: `${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"}`,
                }
              : reconnecting
                ? { kind: "reconnecting", label: "Reconnecting…" }
                : !online
                  ? { kind: "offline", label: "Offline — showing saved copies" }
                  : pending
                    ? {
                        kind: "waiting",
                        label: `${pending} ${pending === 1 ? "change" : "changes"} waiting`,
                      }
                    : { kind: "hidden", label: "" };
            const value = snapshot(online, reconnecting, pending, conflicts);
            expect(syncStatus(value)).toEqual(expected);
            expect(value.pending).toHaveLength(pending);
          });
        }
});
describe("relative sync times", () => {
  it.each([
    [0, "now"],
    [-10, "10 seconds ago"],
    [-60, "1 minute ago"],
    [-3600, "1 hour ago"],
    [-86400, "yesterday"],
    [-172800, "2 days ago"],
    [60, "in 1 minute"],
  ])("formats %s seconds", (seconds, label) => {
    expect(relativeTime(new Date(now.getTime() + Number(seconds) * 1000), now, "en")).toBe(label);
  });
  it("honours the locale", () => {
    expect(relativeTime(new Date(now.getTime() - 120000), now, "fr")).toBe("il y a 2 minutes");
  });
});
