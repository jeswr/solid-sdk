// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import { formatRelativeTime } from "../src/apps/agent/lib/format";

it.each([
  [86_400_000, "in 1 day"],
  [86_400_000 - 5000, "in 1 day"],
  [3_600_000 - 1000, "in 1 hour"],
  [-60_000 + 100, "1 minute ago"],
  [3 * 3_600_000, "in 3 hours"],
  [5 * 60_000, "in 5 minutes"],
  [-2 * 60_000, "2 minutes ago"],
  [30_000, "in 30 seconds"],
  [-30_000, "30 seconds ago"],
  [14 * 86_400_000, "in 2 weeks"],
  [30 * 86_400_000, "in 1 month"],
  [365 * 86_400_000, "in 1 year"],
  [0, "just now"],
  [500, "just now"],
  [-500, "just now"],
  [NaN, "at an unknown time"],
])("humanises %s milliseconds as %s", (delta, expected) => {
  expect(formatRelativeTime(delta, 0)).toBe(expected);
});
it("formats expiry and timestamps through the same helper with an injectable clock", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  expect(formatRelativeTime("2026-11-02T12:00:00Z", now, true)).toBe("Expires in 1 day");
  expect(formatRelativeTime(now - 120_000, now, true)).toBe("Expired 2 minutes ago");
  expect(formatRelativeTime("bad date", now)).toBe("at an unknown time");
  vi.spyOn(Date, "now").mockReturnValue(now);
  expect(formatRelativeTime(now + 180_000)).toBe("in 3 minutes");
  vi.restoreAllMocks();
});
