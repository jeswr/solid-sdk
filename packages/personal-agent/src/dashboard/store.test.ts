import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_HISTORY } from "./model.js";
import { RevisionConflictError, SETTINGS_FILE, SettingsStore, writeAtomic } from "./store.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "awp-store-test-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const now = () => new Date("2026-10-19T08:00:00Z");

describe("SettingsStore", () => {
  it("creates a private directory (0700) and settings file (0600) and never overwrites", () => {
    const state = join(dir, "state");
    const store = new SettingsStore(state, now);
    store.init();
    expect(statSync(state).mode & 0o777).toBe(0o700);
    expect(statSync(join(state, SETTINGS_FILE)).mode & 0o777).toBe(0o600);
    store.update(0, "owner (dashboard)", "x", "y", (d) => {
      d.triage.hostedEnabled = true;
    });
    new SettingsStore(state, now).init();
    expect(store.read().triage.hostedEnabled).toBe(true);
  });

  it("round-trips, bumps the revision and records bounded history", () => {
    const store = new SettingsStore(dir, now);
    store.init();
    // A change cannot rewrite history: the entry list comes from the stored document.
    let s = store.update(0, "owner (dashboard)", "Changed", "try to erase", (d) => {
      d.history = [];
    });
    expect(s.history).toHaveLength(1);
    // Fill the history to its bound directly, then check that further writes trim it.
    writeAtomic(store.path, {
      ...s,
      history: Array.from({ length: MAX_HISTORY }, (_, i) => ({
        revision: 1,
        at: now().toISOString(),
        actor: "initialisation" as const,
        action: "old",
        summary: `old ${i}`,
      })),
    });
    for (let i = 0; i < 3; i++)
      s = store.update(s.revision, "owner (dashboard)", "Changed", `change ${i}`, (d) => {
        d.triage.hostedEnabled = i % 2 === 0;
      });
    expect(s.revision).toBe(4);
    expect(s.history).toHaveLength(MAX_HISTORY);
    expect(s.history[0]?.summary).toBe("old 3");
    expect(s.history.at(-1)).toMatchObject({
      revision: s.revision,
      actor: "owner (dashboard)",
      at: now().toISOString(),
    });
    expect(store.read()).toEqual(s);
    expect(statSync(store.path).mode & 0o777).toBe(0o600);
  });

  it("refuses a stale revision without writing", () => {
    const store = new SettingsStore(dir, now);
    store.init();
    store.update(0, "owner (dashboard)", "a", "b", () => undefined);
    const before = readFileSync(store.path, "utf8");
    expect(() => store.update(0, "owner (dashboard)", "a", "b", () => undefined)).toThrow(
      RevisionConflictError,
    );
    expect(readFileSync(store.path, "utf8")).toBe(before);
  });

  it("validates the result: an invalid change is refused and nothing is written", () => {
    const store = new SettingsStore(dir, now);
    store.init();
    const before = readFileSync(store.path, "utf8");
    expect(() =>
      store.update(0, "owner (dashboard)", "a", "b", (d) => {
        d.availability.timeZone = "Not/AZone";
      }),
    ).toThrow();
    expect(readFileSync(store.path, "utf8")).toBe(before);
  });

  it("serialises writers with a lock held by a live process and recovers a dead one's", () => {
    const store = new SettingsStore(dir, now);
    store.init();
    const lock = join(dir, "settings.lock");
    writeFileSync(lock, String(process.pid));
    expect(() => store.update(0, "owner (dashboard)", "a", "b", () => undefined)).toThrow(
      /another process/,
    );
    writeFileSync(lock, "999999999"); // no such process
    expect(store.update(0, "owner (dashboard)", "a", "b", () => undefined).revision).toBe(1);
  });

  it("labels demo-clock times explicitly, keeps them unchanged and records the migration", () => {
    // Before the clocks were separated, a fixed future demo clock dated two changes.
    const demo = new SettingsStore(dir, () => new Date("2026-10-19T08:00:00Z"));
    demo.init();
    demo.update(0, "inventory import", "Imported", "x", () => undefined);
    const withRecord = demo.update(1, "demo setup", "Demo", "y", (d) => {
      d.connections.push({
        id: "demo-a",
        label: "Demo",
        channel: "email",
        provider: "gmail",
        organisation: "",
        identifiers: [],
        origin: "demo",
        evidence: [],
        conflicts: [],
        localConnector: { state: "setup-required" },
        restrictions: {
          agentEnabled: false,
          read: false,
          triage: false,
          draft: false,
          hostedTriage: false,
        },
        notes: "",
        updatedAt: "2026-10-19T08:00:00.000Z",
        updatedBy: "demo setup",
      });
    });
    const realNow = () => new Date("2026-09-26T12:00:00Z"); // the demo date is in the future
    const real = new SettingsStore(dir, realNow);
    const r = real.labelSyntheticClockTimes();
    expect(r).toEqual({ history: 2, records: 1, revision: 3 });
    const s = real.read();
    expect(s.history.slice(0, 2).map((e) => [e.at, e.clock])).toEqual(
      withRecord.history.map((e) => [e.at, "synthetic-demo"]),
    );
    expect(s.history[2]).toMatchObject({ actor: "migration (CLI)", at: realNow().toISOString() });
    expect(s.history[2]?.clock).toBeUndefined();
    expect(s.connections[0]).toMatchObject({
      updatedAt: "2026-10-19T08:00:00.000Z",
      updatedAtClock: "synthetic-demo",
    });
    // Idempotent: nothing more to label, nothing written.
    expect(real.labelSyntheticClockTimes()).toEqual({ history: 0, records: 0, revision: 3 });
    expect(real.read().revision).toBe(3);
  });

  it("refuses a malformed document instead of replacing it", () => {
    const store = new SettingsStore(dir, now);
    store.init();
    writeFileSync(store.path, "{}");
    expect(() => store.read()).toThrow();
    expect(() => store.init()).toThrow();
    expect(readFileSync(store.path, "utf8")).toBe("{}");
  });
});
