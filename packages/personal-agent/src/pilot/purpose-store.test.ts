/**
 * Durable purpose-bound store: commit boundaries with fault injection and restart, fail-closed
 * loading, idempotence without widening, and bounded retention with tombstones.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OdrlPolicy } from "@jeswr/solid-odrl";
import { afterEach, describe, expect, it } from "vitest";
import {
  type InternalRole,
  PurposeBoundStore,
  type StoreFaultPoint,
} from "./domains/purpose-store.js";
import { PURPOSE } from "./profile/vocabulary.js";
import { FileLedger } from "./store/ledger.js";

const ORG = "https://lender.example/#org";
const ASSESS = "https://lender.example/agents/assessment#agent";
const ROLES: InternalRole[] = [
  { agent: ASSESS, label: "assessment", purposes: [PURPOSE.creditChecking], actions: ["read"] },
];
const T0 = Date.parse("2026-10-19T08:00:00Z");
const DAY = 86_400_000;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function grantPolicy(target: string): OdrlPolicy {
  return {
    id: `${target}#policy`,
    type: "Agreement",
    assigner: "https://sam.example/#me",
    assignee: ORG,
    conflict: "prohibit",
    permissions: [
      {
        id: `${target}#read`,
        type: "permission",
        action: "read",
        target,
        constraints: [
          { leftOperand: "purpose", operator: "isAnyOf", rightOperand: [PURPOSE.creditChecking] },
        ],
      },
    ],
  } as OdrlPolicy;
}

function item(
  id: string,
  validUntil = new Date(T0 + 90 * DAY).toISOString(),
  grantId = `${id}#grant`,
) {
  return {
    id,
    claimType: "income.monthly",
    source: "https://payroll.example/#org",
    data: { value: 90000 },
    grant: { id: grantId, target: id, policy: grantPolicy(id), assignee: ORG, validUntil },
  };
}

function open(dir: string, clock: { t: number }, fault?: (p: StoreFaultPoint) => void) {
  return new PurposeBoundStore(ORG, ROLES, () => new Date(clock.t), undefined, {
    path: join(dir, "data-store.json"),
    ledgerPath: join(dir, "data-store-ledger.jsonl"),
    ...(fault ? { fault } : {}),
  });
}

const records = (dir: string) =>
  new FileLedger(join(dir, "data-store-ledger.jsonl")).entries().map((e) => e.record);

function tempDir() {
  const d = mkdtempSync(join(tmpdir(), "awp-store-"));
  dirs.push(d);
  return d;
}

const read = (s: PurposeBoundStore, id: string) =>
  s.request({ agent: ASSESS, action: "read", items: [id], purpose: PURPOSE.creditChecking });

describe("purpose-bound store: recovery and retention", () => {
  it("a crash after the item commit but before its evidence is repaired on restart, before use", async () => {
    const dir = tempDir();
    const clock = { t: T0 };
    const crashing = open(dir, clock, (p) => {
      if (p === "after-item-commit") throw new Error("crash");
    });
    expect(() => crashing.put(item("urn:x:1"))).toThrow("crash");
    // Committed item, no evidence yet.
    expect(JSON.parse(readFileSync(join(dir, "data-store.json"), "utf8")).items).toHaveLength(1);
    expect(records(dir).filter((r) => r.type === "data-stored")).toHaveLength(0);
    const restarted = open(dir, clock);
    const stored = records(dir).filter((r) => r.type === "data-stored");
    expect(stored).toEqual([expect.objectContaining({ item: "urn:x:1", recovered: true })]);
    expect(read(restarted, "urn:x:1").decision).toBe("permit");
    // Idempotent re-put after restart: no second record.
    restarted.put(item("urn:x:1"));
    expect(records(dir).filter((r) => r.type === "data-stored")).toHaveLength(1);
  });

  it("a failed item write leaves nothing usable and nothing recorded", () => {
    const dir = tempDir();
    const clock = { t: T0 };
    const failing = open(dir, clock, (p) => {
      if (p === "item-write") throw new Error("disk full");
    });
    expect(() => failing.put(item("urn:x:2"))).toThrow("disk full");
    expect(failing.has("urn:x:2")).toBe(false);
    expect(read(failing, "urn:x:2")).toMatchObject({ decision: "deny" });
    expect(records(dir).filter((r) => r.type === "data-stored")).toHaveLength(0);
  });

  it("idempotent put; a different item or grant under an existing id is refused (no widening)", () => {
    const dir = tempDir();
    const s = open(dir, { t: T0 });
    s.put(item("urn:x:3"));
    s.put(item("urn:x:3"));
    const wider = item("urn:x:3", new Date(T0 + 365 * DAY).toISOString());
    expect(() => s.put(wider)).toThrow(/different content or grant/);
    expect(() => s.put({ ...item("urn:x:3"), data: { value: 1 } })).toThrow(/different content/);
    expect(s.inventory()[0]?.validUntil).toBe(new Date(T0 + 90 * DAY).toISOString());
  });

  it("persisted items are validated on open: malformed shapes and dates fail closed", () => {
    const dir = tempDir();
    const s = open(dir, { t: T0 });
    s.put(item("urn:x:4"));
    const path = join(dir, "data-store.json");
    const good = JSON.parse(readFileSync(path, "utf8"));
    for (const broken of [
      {
        ...good,
        items: [{ ...good.items[0], grant: { ...good.items[0].grant, validUntil: "soon" } }],
      },
      { ...good, items: [{ ...good.items[0], storedAt: "2026-13-45T99:00:00Z" }] },
      { ...good, items: [{ ...good.items[0], extra: 1 }] },
      { ...good, version: 2 },
    ]) {
      writeFileSync(path, JSON.stringify(broken));
      expect(() => open(dir, { t: T0 }), JSON.stringify(broken).slice(0, 80)).toThrow(/malformed/);
    }
    // A malformed item is also refused on put.
    const fresh = open(tempDir(), { t: T0 });
    expect(() => fresh.put(item("urn:x:5", "not-a-date"))).toThrow(/malformed/);
  });

  it("retention: expired payloads are erased (bounded), tombstoned, logged payload-free, and never re-stored under the same grant", () => {
    const dir = tempDir();
    const clock = { t: T0 };
    const s = open(dir, clock);
    s.put(item("urn:x:6", new Date(T0 + 1 * DAY).toISOString()));
    s.put(item("urn:x:7", new Date(T0 + 1 * DAY).toISOString()));
    s.put(item("urn:x:8", new Date(T0 + 90 * DAY).toISOString()));
    expect(s.purgeExpired()).toMatchObject({ erased: [], remainingExpired: 0 });
    clock.t = T0 + 2 * DAY;
    const first = s.purgeExpired(1);
    expect(first.erased.map((t) => t.id)).toEqual(["urn:x:6"]);
    expect(first.remainingExpired).toBe(1);
    expect(s.purgeExpired().erased.map((t) => t.id)).toEqual(["urn:x:7"]);
    // The payloads are gone from the store file; tombstones carry no payload.
    const file = readFileSync(join(dir, "data-store.json"), "utf8");
    expect(file).not.toContain(
      '"urn:x:6","claimType":"income.monthly","source":"https://payroll.example/#org","data"',
    );
    const persisted = JSON.parse(file);
    expect(persisted.items.map((i: { id: string }) => i.id)).toEqual(["urn:x:8"]);
    expect(persisted.tombstones.map((t: { id: string }) => t.id)).toEqual(["urn:x:6", "urn:x:7"]);
    expect(JSON.stringify(persisted.tombstones)).not.toContain("90000");
    const erased = records(dir).filter((r) => r.type === "data-erased");
    expect(erased.map((r) => r.item)).toEqual(["urn:x:6", "urn:x:7"]);
    expect(JSON.stringify(records(dir))).not.toContain("90000");
    // Access says erased; a replayed store of the same item under the same grant is refused.
    expect(read(s, "urn:x:6")).toMatchObject({
      decision: "deny",
      reason: expect.stringMatching(/erased/),
    });
    expect(() => s.put(item("urn:x:6", new Date(T0 + 1 * DAY).toISOString()))).toThrow(
      /erased under retention/,
    );
    // Tombstones survive a restart.
    const restarted = open(dir, clock);
    expect(restarted.tombstones().map((t) => t.id)).toEqual(["urn:x:6", "urn:x:7"]);
    expect(() => restarted.put(item("urn:x:7", new Date(T0 + 1 * DAY).toISOString()))).toThrow(
      /erased/,
    );
  });
});

/**
 * Phase-7 review findings 2 and 3, reproduced as the supervisor did (re-grant after purge;
 * crash between commit and evidence; crash after an erasure commit). Evidence must name the
 * CURRENT revision; erasure evidence is repaired; tombstone history is never lost.
 */
describe("purpose-bound store: revision-bound evidence (phase-7 review)", () => {
  const G1 = "urn:test:grant1";
  const G2 = "urn:test:grant2";
  const RegrantItem = "urn:x:regrant";
  const grantsOf = (dir: string, type: string) =>
    records(dir)
      .filter((r) => r.type === type && r.item === RegrantItem)
      .map((r) => r.grant);

  /** Store under grant1, let it expire, purge it (committed with evidence). */
  function erasedOnce(dir: string, clock: { t: number }) {
    const s = open(dir, clock);
    s.put(item(RegrantItem, new Date(T0 + 1 * DAY).toISOString(), G1));
    clock.t = T0 + 2 * DAY;
    expect(s.purgeExpired().erased.map((t) => t.grant)).toEqual([G1]);
  }

  it("re-grant + crash before evidence: access is DENIED until the new revision's evidence exists; restart repairs it", () => {
    const dir = tempDir();
    const clock = { t: T0 };
    erasedOnce(dir, clock);
    const crashing = open(dir, clock, (p) => {
      if (p === "after-item-commit") throw new Error("crash");
    });
    expect(() =>
      crashing.put(item(RegrantItem, new Date(T0 + 90 * DAY).toISOString(), G2)),
    ).toThrow("crash");
    // Before the fix: permit, with only grant1's data-stored in the ledger.
    expect(read(crashing, RegrantItem)).toMatchObject({
      decision: "deny",
      reason: expect.stringMatching(/current revision/),
    });
    expect(grantsOf(dir, "data-stored")).toEqual([G1]);
    const restarted = open(dir, clock);
    expect(grantsOf(dir, "data-stored")).toEqual([G1, G2]);
    expect(read(restarted, RegrantItem).decision).toBe("permit");
    // Revisions are distinct events for the same data identity.
    const revs = records(dir)
      .filter((r) => r.type === "data-stored" && r.item === RegrantItem)
      .map((r) => r.revision);
    expect(new Set(revs).size).toBe(2);
    // The erased grant is refused for good; tombstone history is kept.
    expect(restarted.tombstones().map((t) => t.grant)).toEqual([G1]);
  });

  it("crash after an erasure commit: data-erased evidence for THAT revision is repaired on open; history keeps both tombstones", () => {
    const dir = tempDir();
    const clock = { t: T0 };
    erasedOnce(dir, clock);
    const s = open(dir, clock);
    s.put(item(RegrantItem, new Date(T0 + 3 * DAY).toISOString(), G2));
    clock.t = T0 + 4 * DAY;
    const crashing = open(dir, clock, (p) => {
      if (p === "after-erasure-commit") throw new Error("crash");
    });
    expect(() => crashing.purgeExpired()).toThrow("crash");
    // Before the fix: tombstone grant2, erasure evidence only for grant1, never repaired.
    expect(grantsOf(dir, "data-erased")).toEqual([G1]);
    const restarted = open(dir, clock);
    expect(grantsOf(dir, "data-erased")).toEqual([G1, G2]);
    expect(records(dir).filter((r) => r.type === "data-erased" && r.grant === G2)[0]).toMatchObject(
      { recovered: true },
    );
    expect(restarted.tombstones().map((t) => t.grant)).toEqual([G1, G2]);
    expect(() =>
      restarted.put(item(RegrantItem, new Date(T0 + 90 * DAY).toISOString(), G1)),
    ).toThrow(/not stored again under that grant/);
    expect(() =>
      restarted.put(item(RegrantItem, new Date(T0 + 90 * DAY).toISOString(), G2)),
    ).toThrow(/not stored again under that grant/);
  });

  it("the purge report separates committed erasure from evidence; a later purge reports the repair", () => {
    const dir = tempDir();
    const clock = { t: T0 };
    const failing = open(dir, clock, (p) => {
      if (p === "erasure-evidence") throw new Error("ledger unavailable");
    });
    failing.put(item("urn:x:e1", new Date(T0 + 1 * DAY).toISOString()));
    clock.t = T0 + 2 * DAY;
    const report = failing.purgeExpired();
    expect(report.erased.map((t) => t.id)).toEqual(["urn:x:e1"]); // committed
    expect(report.evidencePending).toEqual(["urn:x:e1"]); // but not yet evidenced
    expect(records(dir).filter((r) => r.type === "data-erased")).toHaveLength(0);
    const next = open(dir, clock).purgeExpired();
    expect(next.erased).toEqual([]);
    expect(records(dir).filter((r) => r.type === "data-erased")).toHaveLength(1); // repaired on open
    expect(next.repairedEvidence).toEqual([]); // nothing left for the purge itself to repair
  });

  it("a failed purge write erases nothing and keeps earlier tombstones", () => {
    const dir = tempDir();
    const clock = { t: T0 };
    erasedOnce(dir, clock);
    open(dir, clock).put(item(RegrantItem, new Date(T0 + 3 * DAY).toISOString(), G2));
    clock.t = T0 + 4 * DAY;
    const failing = open(dir, clock, (p) => {
      if (p === "item-write") throw new Error("disk full");
    });
    expect(() => failing.purgeExpired()).toThrow("disk full");
    expect(failing.has(RegrantItem)).toBe(true);
    expect(failing.tombstones().map((t) => t.grant)).toEqual([G1]);
    expect(grantsOf(dir, "data-erased")).toEqual([G1]);
    const restarted = open(dir, clock);
    expect(restarted.has(RegrantItem)).toBe(true);
    expect(restarted.tombstones().map((t) => t.grant)).toEqual([G1]);
  });
});
