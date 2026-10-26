/**
 * The personal-to-personal slice as executable cases for the demo report. Each case runs
 * real agents (fresh synthetic keys, real JWS verification, persistent or memory stores)
 * and returns what was OBSERVED; the report compares observations with expectations.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DirectBus } from "../bindings/direct.js";
import { scopedUrn } from "../core/canonical.js";
import { buildMeetingTerms, MEETING_MODEL, SCHEDULE_OP } from "../domains/scheduling.js";
import { schedulingMandate } from "../mandates.js";
import { signApproval } from "../mechanisms/mandate.js";
import { signStatement, TYP } from "../mechanisms/statements.js";
import { CONFIG_ED25519 } from "../profile/configurations.js";
import type { AgentRuntime, OutboundMessage } from "../runtime/agent.js";
import { prepareOutbound, processInput, ThreadStore } from "../service.js";
import { introduce, provisionAgent } from "../setup.js";
import { verifyLedger } from "../store/ledger.js";
import type { WireMessage } from "../store/state.js";
import {
  ALICE,
  BOB,
  fixedClock,
  londonCalendar,
  newYorkCalendar,
  type PairOptions,
  type PersonalAgent,
  personalPair,
  provisionPair,
  startAgent,
} from "./personal.js";

const WIDE = { start: "2026-10-20T08:00:00Z", end: "2026-10-23T17:00:00Z" };

function terms(
  a: PersonalAgent,
  now: Date,
  window = WIDE,
  fee?: { amount: number; currency: string },
) {
  return buildMeetingTerms({
    calendar: a.calendar,
    title: "Synthetic catch-up",
    durationMinutes: 30,
    window,
    now: now.toISOString(),
    ...(fee ? { fee } : {}),
  }) as never;
}

/** Tuesday afternoon UTC: inside both working days, so the responder accepts directly. */
const OVERLAP = { start: "2026-10-20T13:00:00Z", end: "2026-10-20T17:00:00Z" };

async function begin(
  opts: PairOptions & {
    fee?: { amount: number; currency: string };
    window?: { start: string; end: string };
  },
) {
  const pair = await personalPair(opts);
  const start = await pair.alice.runtime.startNegotiation({
    peer: { actor: BOB.actor, party: BOB.party },
    operation: SCHEDULE_OP,
    terms: terms(pair.alice, opts.now(), opts.window ?? WIDE, opts.fee),
    models: [MEETING_MODEL],
  });
  const bus = new DirectBus()
    .register(pair.alice.runtime, pair.bob.runtime)
    .send(pair.alice.runtime, start);
  return { ...pair, bus, conv: start.conversation as string };
}

function history(rt: AgentRuntime, conv: string) {
  const c = rt.conversation(conv);
  return {
    phase: c?.phase,
    closedReason: c?.closedReason,
    outcomes: c?.outcomes,
    transitions: c?.history.map((h) => `${h.direction}:${h.kind}→${h.phaseAfter}`),
  };
}

export async function caseSuccessDirect() {
  const clock = fixedClock();
  const { alice, bob, bus, conv } = await begin({ now: clock.now });
  await bus.run();
  return {
    trace: bus.trace,
    alice: history(alice.runtime, conv),
    bob: history(bob.runtime, conv),
    holds: {
      alice: Object.values(alice.calendar.data.holds),
      bob: Object.values(bob.calendar.data.holds),
    },
    agreementIdsMatch: alice.runtime.agreements()[0]?.id === bob.runtime.agreements()[0]?.id,
    termsDigest: alice.runtime.agreements()[0]?.termsDigest,
    selection: alice.runtime.agreements()[0]?.selection,
    ledgersIntact: verifyLedger(alice.ledger.entries()).ok && verifyLedger(bob.ledger.entries()).ok,
    ledgerRecordTypes: [...new Set(bob.ledger.entries().map((e) => e.record.type))].sort(),
    description: alice.runtime.description(),
  };
}

export async function caseEmailParity() {
  const clock = fixedClock();
  const pair = await personalPair({ now: clock.now });
  const start = await pair.alice.runtime.startNegotiation({
    peer: { actor: BOB.actor, party: BOB.party },
    operation: SCHEDULE_OP,
    terms: terms(pair.alice, clock.now()),
    models: [MEETING_MODEL],
  });
  const threads = new Map([
    [pair.alice.runtime, new ThreadStore()],
    [pair.bob.runtime, new ThreadStore()],
  ]);
  const address = (rt: AgentRuntime) => (rt === pair.alice.runtime ? ALICE.email : BOB.email);
  let queue = (
    await prepareOutbound(
      pair.alice.runtime,
      start.outbound,
      { selfAddress: ALICE.email },
      threads.get(pair.alice.runtime) as ThreadStore,
      clock.now(),
    )
  ).map((item) => ({ to: pair.bob.runtime, item }));
  const hops: Array<{
    kind: string;
    to: string;
    disposition?: string;
    parity?: string;
    checks: boolean;
  }> = [];
  for (let i = 0; queue.length > 0 && i < 20; i++) {
    const next: typeof queue = [];
    for (const { to, item } of queue) {
      const report = await processInput(
        to,
        {
          format: "gmail-json",
          data: Buffer.from(
            JSON.stringify({
              id: `m${i}`,
              threadId: "18c0ffee00000001",
              raw: item.email?.gmailSend.raw,
            }),
          ),
        },
        { selfAddress: address(to), strictParity: true },
        threads.get(to) as ThreadStore,
        clock.now(),
      );
      hops.push({
        kind: item.kind,
        to: to.identity.actor,
        disposition: report.step?.disposition,
        parity: report.input?.parity,
        checks: item.checks.every((c) => c.ok),
      });
      for (const o of report.outbound)
        next.push({
          to: to === pair.alice.runtime ? pair.bob.runtime : pair.alice.runtime,
          item: o,
        });
    }
    queue = next;
  }
  const direct = await caseSuccessDirect();
  return {
    hops,
    alicePhase: pair.alice.runtime.conversation(start.conversation as string)?.phase,
    bobPhase: pair.bob.runtime.conversation(start.conversation as string)?.phase,
    sameTermsDigestAsDirect: pair.alice.runtime.agreements()[0]?.termsDigest === direct.termsDigest,
    sameSelectionAsDirect:
      JSON.stringify(pair.alice.runtime.agreements()[0]?.selection) ===
      JSON.stringify(direct.selection),
  };
}

export async function caseMismatch() {
  const clock = fixedClock();
  const cal = newYorkCalendar();
  cal.busy = [{ start: "2026-10-19T00:00:00Z", end: "2026-10-31T00:00:00Z" }];
  const { alice, bob, bus, conv } = await begin({ now: clock.now, bobCalendar: cal });
  await bus.run();
  return {
    alice: history(alice.runtime, conv),
    bob: history(bob.runtime, conv),
    holds: alice.calendar.holdCount + bob.calendar.holdCount,
  };
}

export async function caseFeeRefused() {
  const clock = fixedClock();
  // Alice offers a paid consultation (fee payable by the acceptor); Bob would be the payer.
  const { alice, bob, bus, conv } = await begin({
    now: clock.now,
    fee: { amount: 50, currency: "GBP" },
    window: OVERLAP,
  });
  await bus.run();
  const decision = bob.ledger
    .entries()
    .find((e) => e.record.type === "authorisation-decision")?.record;
  return {
    alice: history(alice.runtime, conv),
    bobDecision: { outcome: decision?.outcome, reason: decision?.reason },
    holds: bob.calendar.holdCount,
  };
}

function tamper(jws: string, mutate: (p: Record<string, unknown>) => void): string {
  const [h, p, s] = jws.split(".");
  const payload = JSON.parse(Buffer.from(p ?? "", "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
  mutate(payload);
  return `${h}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${s}`;
}

export async function caseTamperReplayAudience() {
  const clock = fixedClock();
  const t = await begin({ now: clock.now });
  await t.bus.run(({ out }) =>
    out.kind === "propose" && out.wire.format === "awp-jws-compact/0.1"
      ? {
          format: out.wire.format,
          jws: tamper(out.wire.jws, (p) => {
            (p.body as { terms: { durationMinutes: number } }).terms.durationMinutes = 120;
          }),
        }
      : undefined,
  );
  const tampered = t.bus.trace.find((x) => x.kind === "propose");

  const r = await begin({ now: clock.now });
  let accept: { to: AgentRuntime; wire: WireMessage } | undefined;
  await r.bus.run(({ to, out }) => {
    if (out.kind === "accept") accept = { to, wire: out.wire };
    return undefined;
  });
  // Redeliver the acceptance to its real recipient.
  const replay = accept ? await accept.to.receive(accept.wire) : undefined;

  const w = await begin({ now: clock.now });
  const carolP = await provisionAgent({
    identity: {
      name: "carol",
      party: "https://carol.example/#me",
      actor: "https://agents.carol.example/personal#agent",
    },
    now: clock.now(),
    mandate: schedulingMandate([ALICE.party]),
    representationOperations: [SCHEDULE_OP.id],
  });
  const carol = await startAgent(
    { ...carolP, trust: introduce(carolP.trust, w.alice.provisioned.card) },
    newYorkCalendar(),
    { now: clock.now, accepted: [CONFIG_ED25519] },
  );
  w.bus.register(carol.runtime);
  await w.bus.run(({ out }) => (out.kind === "propose" ? { redirect: carol.runtime } : undefined));
  const redirected = w.bus.trace.find((x) => x.kind === "propose");
  return {
    tampered: {
      disposition: tampered?.disposition,
      reason: tampered?.reason,
      holds: t.alice.calendar.holdCount + t.bob.calendar.holdCount,
    },
    replay: {
      disposition: replay?.disposition,
      resentSameResponses: replay?.outbound.length,
      holdsAfter:
        accept?.to === r.alice.runtime ? r.alice.calendar.holdCount : r.bob.calendar.holdCount,
    },
    wrongAudience: {
      to: redirected?.to,
      disposition: redirected?.disposition,
      reason: redirected?.reason,
      carolHolds: carol.calendar.holdCount,
    },
  };
}

export async function caseMandateAndRepresentation() {
  const clock = fixedClock();
  const pair = await personalPair({ now: clock.now, validityDays: 1 });
  clock.advance(2 * 86_400_000);
  const start = await pair.alice.runtime.startNegotiation({
    peer: { actor: BOB.actor, party: BOB.party },
    operation: SCHEDULE_OP,
    terms: terms(pair.alice, clock.now(), {
      start: "2026-10-22T13:00:00Z",
      end: "2026-10-22T17:00:00Z",
    }),
    models: [MEETING_MODEL],
  });
  const bus = new DirectBus()
    .register(pair.alice.runtime, pair.bob.runtime)
    .send(pair.alice.runtime, start);
  await bus.run();
  const ownExpired = {
    sentKinds: bus.trace.map((x) => x.kind),
    ...history(pair.alice.runtime, start.conversation as string),
  };

  const c2 = fixedClock();
  const { alice, bob } = await provisionPair({ now: c2.now });
  const expiredRep = await signStatement(alice.ownerKey, TYP.representation, {
    type: "RepresentationStatement",
    id: scopedUrn("representation", ALICE.actor, "rep-expired"),
    party: ALICE.party,
    actor: ALICE.actor,
    actorKid: alice.actorKey.kid,
    operations: [SCHEDULE_OP.id],
    validFrom: "2026-10-01T00:00:00Z",
    validUntil: "2026-10-02T00:00:00Z",
    issuedAt: "2026-10-01T00:00:00Z",
  });
  const a = await startAgent({ ...alice, representationJws: expiredRep }, londonCalendar(), {
    now: c2.now,
    accepted: [CONFIG_ED25519],
  });
  const b = await startAgent(bob, newYorkCalendar(), { now: c2.now, accepted: [CONFIG_ED25519] });
  const s2 = await a.runtime.startNegotiation({
    peer: { actor: BOB.actor, party: BOB.party },
    operation: SCHEDULE_OP,
    terms: terms(a, c2.now()),
    models: [MEETING_MODEL],
  });
  const bus2 = new DirectBus().register(a.runtime, b.runtime).send(a.runtime, s2);
  await bus2.run();
  return {
    ownMandateExpired: ownExpired,
    peerRepresentationExpired: history(a.runtime, s2.conversation as string),
  };
}

export async function caseConfigurationMismatch() {
  const clock = fixedClock();
  const { alice, bus, conv } = await begin({ now: clock.now, bobAlg: "ES256" });
  await bus.run();
  return history(alice.runtime, conv);
}

export async function caseUncertainAndRestart() {
  const dir = mkdtempSync(join(tmpdir(), "awp-demo-"));
  try {
    const clock = fixedClock();
    const opts = { now: clock.now, dir };
    const { alice, bob } = await provisionPair(opts);
    let a = await startAgent(alice, londonCalendar(), { ...opts, accepted: [CONFIG_ED25519] });
    let b = await startAgent(bob, newYorkCalendar(), { ...opts, accepted: [CONFIG_ED25519] });
    b.calendar.failNext = "timeout-after-commit";
    const start = await a.runtime.startNegotiation({
      peer: { actor: BOB.actor, party: BOB.party },
      operation: SCHEDULE_OP,
      terms: terms(a, clock.now()),
      models: [MEETING_MODEL],
    });
    const wires: Array<{ to: string; wire: WireMessage }> = [];
    let bus = new DirectBus().register(a.runtime, b.runtime).send(a.runtime, start);
    await bus.run(({ to, out }) => {
      wires.push({ to: to.identity.actor, wire: out.wire });
      return undefined;
    });
    const beforeCrash = history(b.runtime, start.conversation as string);
    a.runtime.close();
    b.runtime.close();
    a = await startAgent(alice, londonCalendar(), { ...opts, accepted: [CONFIG_ED25519] });
    b = await startAgent(bob, newYorkCalendar(), { ...opts, accepted: [CONFIG_ED25519] });
    const redeliveries: string[] = [];
    for (const w of wires)
      redeliveries.push(
        (await (w.to === BOB.actor ? b.runtime : a.runtime).receive(w.wire)).disposition,
      );
    const rec = await b.runtime.reconcile();
    bus = new DirectBus().register(a.runtime, b.runtime).send(b.runtime, rec);
    await bus.run();
    const result = {
      beforeCrash,
      redeliveriesAfterRestart: [...new Set(redeliveries)],
      holdsAfter: { alice: a.calendar.holdCount, bob: b.calendar.holdCount },
      after: {
        alice: history(a.runtime, start.conversation as string),
        bob: history(b.runtime, start.conversation as string),
      },
      reconciliation: b.ledger
        .entries()
        .filter(
          (e) =>
            e.record.type === "reconciliation" ||
            (e.record.type === "outcome" && e.record.method === "reconciliation"),
        )
        .map((e) => e.record),
    };
    a.runtime.close();
    b.runtime.close();
    return result;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function caseApproval() {
  const clock = fixedClock();
  const pair = await personalPair({ now: clock.now, aliceMandate: schedulingMandate([]) });
  const start = await pair.alice.runtime.startNegotiation({
    peer: { actor: BOB.actor, party: BOB.party },
    operation: SCHEDULE_OP,
    terms: terms(pair.alice, clock.now()),
    models: [MEETING_MODEL],
  });
  const bus = new DirectBus()
    .register(pair.alice.runtime, pair.bob.runtime)
    .send(pair.alice.runtime, start);
  await bus.run();
  const pending = pair.alice.runtime.pendingApprovals();
  const approve = (digest: string) =>
    signApproval(pair.alice.provisioned.ownerKey, {
      type: "OwnerApproval",
      id: `urn:uuid:${digest.slice(-12)}`,
      issuer: ALICE.party,
      actor: ALICE.actor,
      actionDigest: digest,
      conversation: start.conversation as string,
      decision: "approve",
      issuedAt: clock.now().toISOString(),
      validUntil: new Date(clock.now().getTime() + 3_600_000).toISOString(),
    });
  const stale = await pair.alice.runtime.submitApproval(await approve("sha-256:not-this-action"));
  // Each distinct action (the opening offer, then acceptance of Bob's counter-offer) needs
  // its own approval; the owner approves each one it is shown, up to a bound.
  const released: string[][] = [];
  for (let i = 0; i < 4; i++) {
    const next = pair.alice.runtime.pendingApprovals()[0];
    if (!next) break;
    const ok = await pair.alice.runtime.submitApproval(await approve(next.actionDigest));
    released.push(ok.outbound.map((o: OutboundMessage) => o.kind));
    bus.send(pair.alice.runtime, ok);
    await bus.run();
  }
  return {
    pendingBefore: pending.length,
    staleReleased: stale.outbound.length,
    released,
    final: history(pair.alice.runtime, start.conversation as string),
  };
}
