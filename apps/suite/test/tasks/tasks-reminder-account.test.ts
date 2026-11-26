// AUTHORED-BY Claude Sonnet 5.5
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@jeswr/suite-ui", () => ({ toast: vi.fn() }));
async function load() {
  vi.resetModules();
  return import("../../src/apps/tasks/state/reminders");
}
const alice = "https://alice.example/profile#me";
const bob = "https://bob.example/profile#me";
const key = "https://pod.test/tasks/a.ttl/reminder-PT0S@2026-11-02T09:00:00.000Z|due=x";

describe("fired reminder store accounts", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("indexedDB", undefined);
  });
  it("lets another account in the same browser claim the same reminder", async () => {
    const { firedReminderStore } = await load();
    expect(await firedReminderStore(alice).claim(key)).toBe(true);
    expect(await firedReminderStore(alice).claim(key)).toBe(false);
    expect(await firedReminderStore(bob).claim(key)).toBe(true);
  });
  it("stores no task URL or title and drops the old unscoped entry", async () => {
    localStorage.setItem("tasks.firedReminders", JSON.stringify({ "Secret|title": 1 }));
    const { firedReminderStore } = await load();
    await firedReminderStore(alice).claim(`${key}|2026|Call the clinic`);
    expect(localStorage.getItem("tasks.firedReminders")).toBeNull();
    const raw = Object.keys(localStorage)
      .map((name) => `${name}${localStorage.getItem(name)}`)
      .join("");
    expect(raw).not.toMatch(/clinic|pod\.test|alice/);
  });
});
it("hashes with SHA-256", async () => {
  vi.stubGlobal("indexedDB", undefined);
  localStorage.clear();
  const { firedReminderStore } = await load();
  await firedReminderStore("").claim("abc");
  const { createHash } = await import("node:crypto");
  const expected = createHash("sha256").update("\nabc").digest("hex");
  expect(Object.keys(JSON.parse(localStorage.getItem("tasks.firedReminders.v2") ?? "{}"))).toEqual([
    expected,
  ]);
});
