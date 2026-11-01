// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  inQuietHours,
  kindPreference,
  shouldNotifyDesktop,
} from "../src/shell/lib/notifications-delivery";
import type { NotificationKind } from "../src/shell/lib/notifications-model";
import { defaultPreferences, mergePreferences } from "../src/shell/lib/settings-preferences";

const at = (time: string) => new Date(`2026-11-01T${time}:00`);

describe("inQuietHours", () => {
  const quiet = { enabled: true, start: "22:00", end: "08:00" };
  it("is off unless enabled, and never quiet when start equals end", () => {
    expect(inQuietHours({ ...quiet, enabled: false }, at("23:00"))).toBe(false);
    expect(inQuietHours({ ...quiet, end: "22:00" }, at("22:00"))).toBe(false);
  });
  it("handles windows across midnight", () => {
    expect(inQuietHours(quiet, at("22:00"))).toBe(true);
    expect(inQuietHours(quiet, at("03:15"))).toBe(true);
    expect(inQuietHours(quiet, at("08:00"))).toBe(false);
    expect(inQuietHours(quiet, at("12:00"))).toBe(false);
  });
  it("handles same-day windows", () => {
    const lunch = { enabled: true, start: "12:00", end: "13:30" };
    expect(inQuietHours(lunch, at("12:45"))).toBe(true);
    expect(inQuietHours(lunch, at("13:30"))).toBe(false);
    expect(inQuietHours(lunch, at("11:59"))).toBe(false);
  });
});

describe("shouldNotifyDesktop", () => {
  const optedIn = mergePreferences(defaultPreferences, { desktop: true });
  it("is off by default: browser permission alone never pops anything up", () => {
    expect(defaultPreferences.desktop).toBe(false);
    expect(shouldNotifyDesktop("shared", defaultPreferences, at("12:00"))).toBe(false);
  });
  it("honours the opt-in and every kind's own toggle", () => {
    for (const kind of Object.keys(kindPreference) as NotificationKind[]) {
      expect(shouldNotifyDesktop(kind, optedIn, at("12:00"))).toBe(true);
      const off = mergePreferences(optedIn, { notifications: { [kindPreference[kind]]: false } });
      expect(shouldNotifyDesktop(kind, off, at("12:00"))).toBe(false);
    }
  });
  it("stays quiet during quiet hours", () => {
    const quiet = mergePreferences(optedIn, { quietHours: { enabled: true } });
    expect(shouldNotifyDesktop("access-request", quiet, at("23:30"))).toBe(false);
    expect(shouldNotifyDesktop("access-request", quiet, at("09:00"))).toBe(true);
  });
});
