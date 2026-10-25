// AUTHORED-BY Codex GPT-6
/**
 * Regression tests for the Phase 1 supervisor review findings 2–6 and the retention policy.
 * Crashes are simulated the way a killed process looks from outside: a snapshot write that
 * throws before/after writing, or an adapter that commits and then never returns (the
 * runtime instance is then abandoned and a fresh one is opened on the same durable state).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildMeetingTerms,
  MEETING_MODEL,
  SCHEDULE_OP,
  SyntheticCalendar,
} from "./domains/scheduling.js";
import { schedulingMandate } from "./mandates.js";
import { signApproval, signMandate } from "./mechanisms/mandate.js";
import { TrustStore } from "./mechanisms/trust.js";
import { CONFIG_ED25519 } from "./profile/configurations.js";
import type { AgentRuntime, OutboundMessage, StepResult } from "./runtime/agent.js";
import type { EffectAdapter } from "./runtime/operations.js";
import {
  ALICE,
  BOB,
  fixedClock,
  londonCalendar,
  newYorkCalendar,
  type PersonalAgent,
  provisionPair,
  startAgent,
} from "./scenarios/personal.js";
import { FileLedger, verifyLedger } from "./store/ledger.js";
import {
  domainOwner,
  FileStateStore,
  MemoryStateStore,
  type RuntimeState,
  type StateStore,
} from "./store/state.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

const ED = [CONFIG_ED25519];
const OVERLAP = { start: "2026-10-20T13:00:00Z", end: "2026-10-20T17:00:00Z" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class CrashError extends Error {}

/** A store that "crashes" (throws) at one chosen snapshot, before or after writing it. */
class FaultyStore implements StateStore {
  constructor(
    readonly inner: MemoryStateStore,
    private crash?: (state: RuntimeState) => "before" | "after" | undefined,
  ) {}
  load() {
    return this.inner.load();
  }
  save(state: RuntimeState) {
    const mode = this.crash?.(state);
    if (mode === "before") {
      this.crash = undefined;
      throw new CrashError("crash before snapshot");
    }
    this.inner.save(state);
    if (mode === "after") {
      this.crash = undefined;
      throw new CrashError("crash after snapshot");
    }
  }
  close() {}
}

/** Wrap the calendar adapter: hang (never return) before or after committing the hold. */
function hanging(mode: "before-commit" | "after-commit") {
  return (inner: EffectAdapter): EffectAdapter => ({
    id: inner.id,
    async execute(key, params) {
      if (mode === "after-commit") await inner.execute(key, params);
      return new Promise(() => {});
    },
    reconcile: (key) => inner.reconcile(key),
  });
}

const effectState = (state: RuntimeState, status: string) =>
  Object.values(state.effects).some((e) => e.status === status && e.conversation !== "x");

/** Alice opens a negotiation Bob can accept directly; returns the propose wire for Bob. */
async function toProposal(
  clock = fixedClock(),
  bobStore: StateStore = new MemoryStateStore(),
  wrap?: (a: EffectAdapter) => EffectAdapter,
) {
  const { alice, bob } = await provisionPair({ now: clock.now });
  const a = await startAgent(alice, londonCalendar(), { now: clock.now, accepted: ED });
  const bobCalendar = new SyntheticCalendar(newYorkCalendar());
  const openBob = (store: StateStore, w?: (x: EffectAdapter) => EffectAdapter) =>
    startAgent(bob, newYorkCalendar(), {
      now: clock.now,
      accepted: ED,
      store,
      calendar: bobCalendar,
      ...(w ? { wrapAdapter: w } : {}),
      runtime: { trackHandOff: true, effectTimeoutMs: 60_000 },
    });
  const b = await openBob(bobStore, wrap);
  const terms = buildMeetingTerms({
    calendar: a.calendar,
    title: "x",
    durationMinutes: 30,
    window: OVERLAP,
    now: clock.now().toISOString(),
  });
  const start = await a.runtime.startNegotiation({
    peer: { actor: BOB.actor, party: BOB.party },
    operation: SCHEDULE_OP,
    terms: terms as never,
    models: [MEETING_MODEL],
  });
  const desc = await b.runtime.receive((start.outbound[0] as OutboundMessage).wire);
  await b.runtime.markHandedOff(desc.outbound.map((o) => o.id)); // the binding took it
  const prop = await a.runtime.receive((desc.outbound[0] as OutboundMessage).wire);
  const proposeWire = (prop.outbound[0] as OutboundMessage).wire;
  return {
    clock,
    a,
    b,
    bobCalendar,
    openBob,
    proposeWire,
    conversation: start.conversation as string,
    bobProvisioned: bob,
  };
}

/** Deliver Bob's outbound to Alice and Alice's replies back until quiet (marking hand-off). */
async function finish(a: PersonalAgent, b: PersonalAgent, fromBob: readonly OutboundMessage[]) {
  let queue: Array<{ to: AgentRuntime; out: OutboundMessage }> = fromBob.map((out) => ({
    to: a.runtime,
    out,
  }));
  for (let i = 0; queue.length > 0 && i < 20; i++) {
    const next: typeof queue = [];
    for (const { to, out } of queue) {
      const sender = to === a.runtime ? b.runtime : a.runtime;
      await sender.markHandedOff([out.id]);
      const r = await to.receive(JSON.parse(JSON.stringify(out.wire)));
      for (const o of r.outbound) next.push({ to: sender, out: o });
    }
    queue = next;
  }
}

describe("finding 2 — state lock ownership", () => {
  it("refuses a second store for the same path in the same process and releases only its own lock", () => {
    const dir = tempDir("awp-lock-");
    const path = join(dir, "state.json");
    const first = new FileStateStore(path);
    expect(() => new FileStateStore(path)).toThrow(/already open in this process/);
    first.close();
    const second = new FileStateStore(path);
    // Someone else's lock (different token) is not removed by our close().
    const lock = JSON.parse(readFileSync(second.lockPath, "utf8"));
    writeFileSync(second.lockPath, JSON.stringify({ ...lock, token: "someone-else" }));
    second.close();
    expect(existsSync(second.lockPath)).toBe(true);
  });

  it("never auto-removes an unreadable lock or a leftover recovery marker", () => {
    const dir = tempDir("awp-lock-");
    const path = join(dir, "state.json");
    writeFileSync(`${path}.lock`, "");
    expect(() => new FileStateStore(path)).toThrow(/unreadable lock/);
    writeFileSync(
      `${path}.lock`,
      JSON.stringify({
        pid: 2 ** 22 - 7,
        host: require("node:os").hostname(),
        token: "t",
        createdAt: "x",
      }),
    );
    writeFileSync(`${path}.lock.recovering`, "{}");
    expect(() => new FileStateStore(path)).toThrow(/recovery is in progress or was interrupted/);
  });

  it("is held by a live competing process, and recovered only after that process dies", async () => {
    const dir = tempDir("awp-lock-");
    const path = join(dir, "state.json");
    const lockPath = `${path}.lock`;
    const script =
      "const fs=require('fs'),os=require('os');fs.writeFileSync(process.argv.at(-1),JSON.stringify({pid:process.pid,host:os.hostname(),token:'child-token',createdAt:new Date().toISOString()}));setInterval(()=>{},1000);";
    const child = spawn(process.execPath, ["-e", script, lockPath], { stdio: "ignore" });
    const exited = new Promise((r) => child.once("exit", r));
    for (let i = 0; i < 100 && !existsSync(lockPath); i++) await sleep(20);
    expect(() => new FileStateStore(path)).toThrow(/held by live process/);
    child.kill("SIGKILL");
    await exited;
    const store = new FileStateStore(path);
    expect(store.recoveredStaleLock?.token).toBe("child-token");
    store.close();
    expect(existsSync(lockPath)).toBe(false);
  });
});

describe("finding 3 — mandate revocation persists", () => {
  it("survives reopening; only a re-issued higher version restores autonomy", async () => {
    const dir = tempDir("awp-revoke-");
    const clock = fixedClock();
    const { alice } = await provisionPair({ now: clock.now, dir });
    const open = () => startAgent(alice, londonCalendar(), { now: clock.now, dir, accepted: ED });
    const terms = (a: PersonalAgent) =>
      buildMeetingTerms({
        calendar: a.calendar,
        title: "x",
        durationMinutes: 30,
        window: OVERLAP,
        now: clock.now().toISOString(),
      }) as never;
    let a = await open();
    expect((await a.runtime.revokeMandate()).revoked).toBe(true);
    a.runtime.close();
    a = await open();
    const blocked = await a.runtime.startNegotiation({
      peer: { actor: BOB.actor, party: BOB.party },
      operation: SCHEDULE_OP,
      terms: terms(a),
      models: [MEETING_MODEL],
      discover: false,
      configuration: CONFIG_ED25519,
    });
    expect(blocked.outbound).toHaveLength(0);
    expect(a.runtime.conversation(blocked.conversation as string)?.closedReason).toMatch(/revoked/);
    // Reloading the same mandate does not restore it; a re-issued version 2 does.
    await a.runtime.reloadMandate(alice.mandateJws);
    const v2 = await signMandate(alice.ownerKey, {
      ...schedulingMandate([BOB.party])({
        owner: ALICE.party,
        actor: ALICE.actor,
        validFrom: clock.now().toISOString(),
        validUntil: new Date(clock.now().getTime() + 86_400_000).toISOString(),
      }),
      version: 2,
    });
    await a.runtime.reloadMandate(v2);
    const ok = await a.runtime.startNegotiation({
      peer: { actor: BOB.actor, party: BOB.party },
      operation: SCHEDULE_OP,
      terms: terms(a),
      models: [MEETING_MODEL],
      discover: false,
      configuration: CONFIG_ED25519,
    });
    expect(ok.outbound.map((o) => o.kind)).toEqual(["propose"]);
    a.runtime.close();
  });

  it("a pending approval cannot resume an action after revocation", async () => {
    const clock = fixedClock();
    const { alice } = await provisionPair({ now: clock.now, aliceMandate: schedulingMandate([]) });
    const a = await startAgent(alice, londonCalendar(), { now: clock.now, accepted: ED });
    const terms = buildMeetingTerms({
      calendar: a.calendar,
      title: "x",
      durationMinutes: 30,
      window: OVERLAP,
      now: clock.now().toISOString(),
    });
    const s = await a.runtime.startNegotiation({
      peer: { actor: BOB.actor, party: BOB.party },
      operation: SCHEDULE_OP,
      terms: terms as never,
      models: [MEETING_MODEL],
      discover: false,
      configuration: CONFIG_ED25519,
    });
    const digest = s.pendingApproval?.actionDigest as string;
    await a.runtime.revokeMandate();
    const approval = await signApproval(alice.ownerKey, {
      type: "OwnerApproval",
      id: "urn:uuid:a1",
      issuer: ALICE.party,
      actor: ALICE.actor,
      actionDigest: digest,
      conversation: s.conversation as string,
      decision: "approve",
      issuedAt: clock.now().toISOString(),
      validUntil: new Date(clock.now().getTime() + 3_600_000).toISOString(),
    });
    const r = await a.runtime.submitApproval(approval);
    expect(r.outbound).toHaveLength(0);
    expect(a.runtime.conversation(s.conversation as string)?.phase).toBe("refused");
  });

  it("reconciliation after revocation reports what happened but never re-attempts", async () => {
    const t = await toProposal();
    t.bobCalendar.failNext = "timeout-before-commit";
    const r = await t.b.runtime.receive(t.proposeWire);
    expect(t.b.runtime.conversation(t.conversation)?.phase).toBe("uncertain");
    await t.b.runtime.revokeMandate();
    const rec = await t.b.runtime.recover();
    expect(t.bobCalendar.holdCount).toBe(0);
    expect(
      rec.outbound.map((o) => [o.kind, (o.message.body as { outcome?: string }).outcome]),
    ).toEqual([["receipt", "not-executed"]]);
    expect(t.b.runtime.conversation(t.conversation)?.phase).toBe("failed");
    expect(r.disposition).toBe("accepted");
  });
});

describe("finding 4 — interrupted completion and reply recovery", () => {
  it("crash BEFORE the write-ahead snapshot: nothing durable, redelivery processes normally", async () => {
    const inner = new MemoryStateStore();
    const t = await toProposal(
      fixedClock(),
      new FaultyStore(inner, (s) => (effectState(s, "attempting") ? "before" : undefined)),
    );
    await expect(t.b.runtime.receive(t.proposeWire)).rejects.toThrow(CrashError);
    const b2 = await t.openBob(inner);
    const r = await b2.runtime.receive(t.proposeWire);
    expect(r.disposition).toBe("accepted");
    await finish(t.a, b2, r.outbound);
    expect([t.bobCalendar.holdCount, t.a.calendar.holdCount]).toEqual([1, 1]);
    expect(b2.runtime.conversation(t.conversation)?.phase).toBe("completed");
  });

  it("process death after the effect committed: replay returns the recorded reply, recover() reconciles and owes the receipt", async () => {
    const inner = new MemoryStateStore();
    const t = await toProposal(fixedClock(), inner, hanging("after-commit"));
    await Promise.race([t.b.runtime.receive(t.proposeWire), sleep(50)]); // then the process "dies"
    const b2 = await t.openBob(inner);
    const dup = await b2.runtime.receive(t.proposeWire);
    expect(dup.disposition).toBe("duplicate");
    expect(dup.outbound.map((o) => o.kind)).toEqual(["accept"]);
    const rec = await b2.runtime.recover();
    expect(rec.outbound.map((o) => o.kind)).toEqual(["receipt"]);
    expect(t.bobCalendar.holdCount).toBe(1);
    const undelivered = b2.runtime.undeliveredOutbound().map((o) => o.kind);
    expect(undelivered).toEqual(["accept", "receipt"]);
    await finish(t.a, b2, b2.runtime.undeliveredOutbound());
    expect([t.bobCalendar.holdCount, t.a.calendar.holdCount]).toEqual([1, 1]);
    expect(b2.runtime.conversation(t.conversation)?.phase).toBe("completed");
  });

  it("process death before the adapter committed: reconciliation proves absence, then one attempt", async () => {
    const inner = new MemoryStateStore();
    const t = await toProposal(fixedClock(), inner, hanging("before-commit"));
    await Promise.race([t.b.runtime.receive(t.proposeWire), sleep(50)]);
    const b2 = await t.openBob(inner);
    await b2.runtime.recover();
    expect(t.bobCalendar.holdCount).toBe(1);
    await finish(t.a, b2, b2.runtime.undeliveredOutbound());
    expect(b2.runtime.conversation(t.conversation)?.phase).toBe("completed");
  });

  it("crash while writing the conclusion: the attempt is durable, recover() concludes from the adapter", async () => {
    const inner = new MemoryStateStore();
    const t = await toProposal(
      fixedClock(),
      new FaultyStore(inner, (s) => (effectState(s, "concluded") ? "before" : undefined)),
    );
    await expect(t.b.runtime.receive(t.proposeWire)).rejects.toThrow(CrashError);
    const b2 = await t.openBob(inner);
    expect(b2.runtime.effectStates().map((e) => e.status)).toEqual(["attempting"]);
    await b2.runtime.recover();
    await finish(t.a, b2, b2.runtime.undeliveredOutbound());
    expect([t.bobCalendar.holdCount, t.a.calendar.holdCount]).toEqual([1, 1]);
    expect(b2.runtime.conversation(t.conversation)?.phase).toBe("completed");
  });

  it("crash after the conclusion snapshot, before the reply was associated and handed off", async () => {
    const inner = new MemoryStateStore();
    const t = await toProposal(
      fixedClock(),
      new FaultyStore(inner, (s) => (effectState(s, "concluded") ? "after" : undefined)),
    );
    await expect(t.b.runtime.receive(t.proposeWire)).rejects.toThrow(CrashError);
    const b2 = await t.openBob(inner);
    const rec = await b2.runtime.recover();
    expect(rec.outbound).toHaveLength(0); // conclusion and receipt were persisted together
    const pending = b2.runtime.undeliveredOutbound();
    expect(pending.map((o) => o.kind)).toEqual(["accept", "receipt"]);
    const dup = await b2.runtime.receive(t.proposeWire);
    expect(dup.outbound.map((o) => o.kind)).toEqual(["accept", "receipt"]);
    await finish(t.a, b2, pending);
    expect(b2.runtime.undeliveredOutbound()).toEqual([]);
    expect([t.bobCalendar.holdCount, t.a.calendar.holdCount]).toEqual([1, 1]);
  });
});

describe("finding 5 — serialised runtime calls", () => {
  it("interleaved duplicate and distinct messages wait for the in-flight one", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const gated = (inner: EffectAdapter): EffectAdapter => ({
      id: inner.id,
      async execute(key, params) {
        await gate;
        return inner.execute(key, params);
      },
      reconcile: (key) => inner.reconcile(key),
    });
    const t = await toProposal(fixedClock(), new MemoryStateStore(), gated);
    const settled: string[] = [];
    const track = (label: string) => (r: StepResult) => {
      settled.push(label);
      return r;
    };
    const p1 = t.b.runtime.receive(t.proposeWire).then(track("p1"));
    const p2 = t.b.runtime.receive(t.proposeWire).then(track("p2"));
    const other = await t.a.runtime.startNegotiation({
      peer: { actor: BOB.actor, party: BOB.party },
      operation: SCHEDULE_OP,
      terms: {} as never,
      models: [MEETING_MODEL],
    });
    const p3 = t.b.runtime.receive((other.outbound[0] as OutboundMessage).wire).then(track("p3"));
    await sleep(30);
    expect(settled).toEqual([]);
    release();
    const [r1, r2, r3] = (await Promise.all([p1, p2, p3])) as [StepResult, StepResult, StepResult];
    expect(settled).toEqual(["p1", "p2", "p3"]);
    expect(r1.outbound.map((o) => o.kind)).toEqual(["accept", "receipt"]);
    expect(r2.disposition).toBe("duplicate");
    expect(r2.outbound.map((o) => o.id)).toEqual(r1.outbound.map((o) => o.id));
    expect(r3.kind).toBe("describe");
    expect(t.bobCalendar.holdCount).toBe(1);
  });

  it("refuses re-entrant calls from an adapter instead of deadlocking", async () => {
    let rt: AgentRuntime | undefined;
    const reentrant = (inner: EffectAdapter): EffectAdapter => ({
      id: inner.id,
      async execute() {
        await (rt as AgentRuntime).recover();
        return { conclusion: "completed", observed: {} };
      },
      reconcile: (key) => inner.reconcile(key),
    });
    const t = await toProposal(fixedClock(), new MemoryStateStore(), reentrant);
    rt = t.b.runtime;
    await t.b.runtime.receive(t.proposeWire);
    const outcome = t.b.ledger.entries().find((e) => e.record.type === "outcome")?.record;
    expect(outcome?.conclusion).toBe("uncertain");
    expect(String(outcome?.reason)).toMatch(/re-entrant/);
  });
});

describe("finding 6 — authority rule dates fail closed", () => {
  const rule = (extra: object) => ({
    version: 1,
    owner: "urn:o",
    keys: [],
    sourceAuthority: [
      {
        id: "urn:r",
        version: "1",
        source: "urn:s",
        claimTypes: ["income.*"],
        subjects: "any",
        ...extra,
      },
    ],
  });

  it("rejects malformed or inverted validity and honours exact boundaries", async () => {
    await expect(TrustStore.load(rule({ validUntil: "invalid-date" }))).rejects.toThrow();
    await expect(
      TrustStore.load(
        rule({ validFrom: "2026-10-02T00:00:00Z", validUntil: "2026-10-01T00:00:00Z" }),
      ),
    ).rejects.toThrow(/before/);
    const store = await TrustStore.load(
      rule({ validFrom: "2026-10-01T00:00:00Z", validUntil: "2026-10-02T00:00:00Z" }),
    );
    const at = (t: string) =>
      store.assessSource({ evaluator: "urn:e", source: "urn:s", claimType: "income.gross", at: t })
        .outcome;
    expect(at("2026-09-30T23:59:59.999Z")).toBe("not-accepted");
    expect(at("2026-10-01T00:00:00Z")).toBe("accepted");
    expect(at("2026-10-01T23:59:59.999Z")).toBe("accepted");
    expect(at("2026-10-02T00:00:00Z")).toBe("not-accepted");
    expect(at("not-a-time")).toBe("unresolved");
  });
});

describe("retention — bounded history without forgetting unresolved work or live replay entries", () => {
  it("keeps conversations while replay entries are live, compacts afterwards, and refuses when protected state exceeds budget", async () => {
    const store = new MemoryStateStore();
    const t = await toProposal(fixedClock(), store);
    const r = await t.b.runtime.receive(t.proposeWire);
    await finish(t.a, t.b, r.outbound);
    expect(t.b.runtime.conversation(t.conversation)?.phase).toBe("completed");
    const records = Object.values(store.load().domain);
    expect(records.length).toBeGreaterThan(0);
    expect(records.some((record) => domainOwner(record) === t.conversation)).toBe(true);
    const early = await t.b.runtime.compact();
    expect(early.removedConversations).toBe(0); // replay entries still live
    expect((await t.b.runtime.receive(t.proposeWire)).disposition).toBe("duplicate");

    // A second, uncertain conversation must survive any compaction.
    const t2 = await toProposal(t.clock);
    t2.bobCalendar.failNext = "timeout-after-commit";
    await t2.b.runtime.receive(t2.proposeWire);
    t.clock.advance(31 * 86_400_000);
    for (const rt of [t.b.runtime, t2.b.runtime]) await rt.compact();
    expect(t.b.runtime.conversation(t.conversation)).toBeUndefined();
    expect(
      Object.values(store.load().domain).some((record) => domainOwner(record) === t.conversation),
    ).toBe(false);
    expect(t2.b.runtime.conversation(t2.conversation)?.phase).toBe("uncertain");
    expect(t2.b.runtime.effectStates().map((e) => e.status)).toEqual(["attempting"]);
    // The expired message is still not re-processed.
    expect((await t.b.runtime.receive(t.proposeWire)).reason).toBe("expired");
    expect(t.bobCalendar.holdCount).toBe(1);
  });

  it("bounds the evidence ledger by segments; pruning leaves a verifiable checkpointed chain", () => {
    const dir = tempDir("awp-ledger-");
    const path = join(dir, "ledger.jsonl");
    const ledger = new FileLedger(path, { segmentMaxEntries: 3, maxSegments: 2 });
    for (let i = 0; i < 20; i++)
      ledger.append({ type: "event", i }, `2026-10-19T08:00:${String(i).padStart(2, "0")}Z`);
    const kept = ledger.entries();
    expect(kept.length).toBeLessThanOrEqual(3 * 3 + 3);
    const check = verifyLedger(kept);
    expect(check.ok).toBe(true);
    expect(check.prunedThroughSeq).toBeGreaterThan(0);
    // Reopening continues the same chain.
    const reopened = new FileLedger(path, { segmentMaxEntries: 3, maxSegments: 2 });
    reopened.append({ type: "event", i: 99 }, "2026-10-19T08:01:00Z");
    expect(verifyLedger(reopened.entries()).ok).toBe(true);
    // Dropping the checkpoint makes the missing prefix unattested.
    const noCheckpoint = kept.filter((e) => e.record.type !== "ledger-checkpoint");
    expect(verifyLedger(noCheckpoint).ok).toBe(false);
  });

  it("refuses new work when only protected state remains over the hard budget", async () => {
    const clock = fixedClock();
    const { bob } = await provisionPair({ now: clock.now });
    const cal = new SyntheticCalendar(newYorkCalendar());
    const b = await startAgent(bob, newYorkCalendar(), {
      now: clock.now,
      accepted: ED,
      calendar: cal,
      runtime: { retention: { maxRetainedConversations: 1 } },
    });
    await b.runtime.startNegotiation({
      peer: { actor: ALICE.actor, party: ALICE.party },
      operation: SCHEDULE_OP,
      terms: {} as never,
      models: [MEETING_MODEL],
    });
    await expect(
      b.runtime.startNegotiation({
        peer: { actor: ALICE.actor, party: ALICE.party },
        operation: SCHEDULE_OP,
        terms: {} as never,
        models: [MEETING_MODEL],
      }),
    ).rejects.toThrow(/capacity/);
  });
});
