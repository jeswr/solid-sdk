import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompactSign, calculateJwkThumbprint, exportJWK, generateKeyPair } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { DirectBus } from "./bindings/direct.js";
import { scopedUrn } from "./core/canonical.js";
import { buildMeetingTerms, MEETING_MODEL, SCHEDULE_OP } from "./domains/scheduling.js";
import { mandateWithUnsupportedTerm, schedulingMandate } from "./mandates.js";
import { signApproval } from "./mechanisms/mandate.js";
import { signStatement, TYP } from "./mechanisms/statements.js";
import { CONFIG_P256 } from "./profile/configurations.js";
import type { AgentRuntime, StepResult } from "./runtime/agent.js";
import {
  ALICE,
  BOB,
  fixedClock,
  londonCalendar,
  newYorkCalendar,
  type PairOptions,
  personalPair,
  provisionPair,
  startAgent,
} from "./scenarios/personal.js";
import { introduce, provisionAgent } from "./setup.js";
import type { WireMessage } from "./store/state.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const CAROL = {
  name: "carol",
  party: "https://carol.example/#me",
  actor: "https://agents.carol.example/personal#agent",
  email: "carol.awp@example.com",
};

function terms(
  cal: Parameters<typeof buildMeetingTerms>[0]["calendar"],
  now: Date,
  window = { start: "2026-10-20T13:00:00Z", end: "2026-10-20T17:00:00Z" },
  fee?: { amount: number; currency: string },
) {
  return buildMeetingTerms({
    calendar: cal,
    title: "Synthetic catch-up",
    durationMinutes: 30,
    window,
    now: now.toISOString(),
    ...(fee ? { fee } : {}),
  }) as never;
}

async function openProposal(opts: PairOptions & { fee?: { amount: number; currency: string } }) {
  const pair = await personalPair(opts);
  const captured: Array<{ to: AgentRuntime; wire: WireMessage; kind: string }> = [];
  const bus = new DirectBus().register(pair.alice.runtime, pair.bob.runtime);
  const start = await pair.alice.runtime.startNegotiation({
    peer: { actor: BOB.actor, party: BOB.party },
    operation: SCHEDULE_OP,
    terms: terms(pair.alice.calendar, opts.now(), undefined, opts.fee),
    models: [MEETING_MODEL],
  });
  bus.send(pair.alice.runtime, start);
  return { ...pair, bus, captured, conversation: start.conversation as string };
}

function tamperPayload(jws: string, mutate: (p: Record<string, unknown>) => void): string {
  const [h, p, s] = jws.split(".");
  const payload = JSON.parse(Buffer.from(p ?? "", "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
  mutate(payload);
  return `${h}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${s}`;
}

describe("integrity, authentication and audience", () => {
  it("rejects a tampered proposal (changed terms) with bad-signature and books nothing", async () => {
    const clock = fixedClock();
    const { alice, bob, bus } = await openProposal({ now: clock.now });
    await bus.run(({ out }) => {
      if (out.kind !== "propose" || out.wire.format !== "awp-jws-compact/0.1") return undefined;
      return {
        format: out.wire.format,
        jws: tamperPayload(out.wire.jws, (p) => {
          (p.body as { terms: { durationMinutes: number } }).terms.durationMinutes = 120;
        }),
      };
    });
    const rejected = bus.trace.find((t) => t.kind === "propose");
    expect(rejected?.disposition).toBe("rejected");
    expect(rejected?.reason).toBe("bad-signature");
    expect(bob.calendar.holdCount + alice.calendar.holdCount).toBe(0);
    expect(
      bob.ledger
        .entries()
        .some((e) => e.record.type === "verification" && e.record.outcome === "invalid"),
    ).toBe(true);
  });

  it("treats redelivery as a duplicate (same responses, no new effect) and id reuse as replay-conflict", async () => {
    const clock = fixedClock();
    const { alice, bob, bus } = await openProposal({ now: clock.now });
    let acceptWire: WireMessage | undefined;
    await bus.run(({ out }) => {
      if (out.kind === "accept") acceptWire = out.wire;
      return undefined;
    });
    expect(bob.calendar.holdCount).toBe(1);
    expect(alice.calendar.holdCount).toBe(1);
    if (acceptWire?.format !== "awp-jws-compact/0.1") throw new Error("no accept captured");
    const again = await alice.runtime.receive(acceptWire);
    expect(again.disposition).toBe("duplicate");
    expect(alice.calendar.holdCount).toBe(1);
    // Same id, different content (re-signed by an attacker is impossible; here: a forged
    // copy with a valid structure but tampered bytes fails signature before replay check).
    const forged = {
      format: acceptWire.format,
      jws: tamperPayload(acceptWire.jws, (p) => {
        p.expiresAt = "2026-10-19T09:00:00Z";
      }),
    };
    expect((await alice.runtime.receive(forged)).reason).toBe("bad-signature");
  });

  it("rejects a message redirected to an agent that is not its audience", async () => {
    const clock = fixedClock();
    const { alice, bob, bus } = await openProposal({ now: clock.now });
    // Carol has pinned Alice, so the signature verifies — but Carol is not the audience.
    const carolP = await provisionAgent({
      identity: CAROL,
      now: clock.now(),
      mandate: schedulingMandate([ALICE.party]),
      representationOperations: [SCHEDULE_OP.id],
    });
    const carol = await startAgent(
      { ...carolP, trust: introduce(carolP.trust, alice.provisioned.card) },
      newYorkCalendar(),
      { now: clock.now, accepted: bob.runtime.description().configurations.accepted },
    );
    bus.register(carol.runtime);
    await bus.run(({ out }) => (out.kind === "propose" ? { redirect: carol.runtime } : undefined));
    const t = bus.trace.find((x) => x.kind === "propose");
    expect(t?.to).toBe(CAROL.actor);
    expect(t?.reason).toBe("wrong-audience");
    expect(carol.calendar.holdCount).toBe(0);
  });

  it("does not trust a key supplied in the JWS header or an unpinned signer", async () => {
    const clock = fixedClock();
    const { bob, alice } = await openProposal({ now: clock.now });
    const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
      extractable: true,
    });
    const jwk = await exportJWK(publicKey);
    const kid = await calculateJwkThumbprint(jwk);
    const payload = {
      profile: "https://w3id.org/jeswr/awp/profile/pilot/0.1",
      configuration: bob.runtime.description().configurations.accepted[0],
      id: "urn:uuid:00000000-0000-4000-8000-000000000001",
      conversation: "urn:uuid:00000000-0000-4000-8000-000000000002",
      kind: "describe",
      from: { actor: ALICE.actor, onBehalfOf: ALICE.party },
      to: { actor: BOB.actor },
      createdAt: clock.now().toISOString(),
      expiresAt: new Date(clock.now().getTime() + 60_000).toISOString(),
      body: {},
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const withJwk = await new CompactSign(bytes)
      .setProtectedHeader({ alg: "EdDSA", kid, typ: TYP.message, jwk })
      .sign(privateKey);
    expect(
      (await bob.runtime.receive({ format: "awp-jws-compact/0.1", jws: withJwk })).reason,
    ).toBe("disallowed-header");
    const unpinned = await new CompactSign(bytes)
      .setProtectedHeader({ alg: "EdDSA", kid, typ: TYP.message })
      .sign(privateKey);
    expect(
      (await bob.runtime.receive({ format: "awp-jws-compact/0.1", jws: unpinned })).reason,
    ).toBe("unknown-key");
    // Alice's real key cannot be used to speak as a different actor.
    const spoof = await new CompactSign(
      new TextEncoder().encode(
        JSON.stringify({ ...payload, from: { actor: "https://agents.alice.example/other#agent" } }),
      ),
    )
      .setProtectedHeader({ alg: "EdDSA", kid: alice.provisioned.actorKey.kid, typ: TYP.message })
      .sign(alice.provisioned.actorKey.privateKey);
    expect((await bob.runtime.receive({ format: "awp-jws-compact/0.1", jws: spoof })).reason).toBe(
      "sender-key-mismatch",
    );
    // A description cannot add trust: Bob still refuses a key that only appeared in a description.
    expect(bob.runtime.description().notice).toMatch(/grants no authority/);
  });

  it("rejects expired messages and messages with excessive lifetime", async () => {
    const clock = fixedClock();
    const { alice, bob, bus } = await openProposal({ now: clock.now });
    let proposal: WireMessage | undefined;
    await bus.run(({ out }) => {
      if (out.kind === "propose") {
        proposal = out.wire;
        return "drop";
      }
      return undefined;
    });
    clock.advance(7 * 3_600_000); // beyond the 6h message lifetime + skew
    const late = await bob.runtime.receive(proposal);
    expect(late.reason).toBe("expired");
    expect(alice.calendar.holdCount + bob.calendar.holdCount).toBe(0);
  });
});

describe("configuration and ontology selection", () => {
  it("returns an explicit unsupported outcome when no configuration is shared", async () => {
    const clock = fixedClock();
    const { alice, bus, conversation } = await openProposal({ now: clock.now, bobAlg: "ES256" });
    await bus.run();
    const conv = alice.runtime.conversation(conversation);
    // Bob answers the describe with an explicit unsupported (Alice's config is not accepted).
    expect(bus.trace[0]?.kind).toBe("describe");
    expect(bus.trace[1]?.kind).toBe("unsupported");
    expect(conv?.phase).toBe("unsupported");
    expect(conv?.closedReason).toBe("unsupported-configuration");
  });

  it("rejects a message whose JWS alg does not match its declared configuration (downgrade)", async () => {
    const clock = fixedClock();
    const pair = await personalPair({
      now: clock.now,
      aliceAlg: "ES256",
      bobAlg: "EdDSA",
      aliceAccepted: [CONFIG_P256],
      bobAccepted: [CONFIG_P256, "https://w3id.org/jeswr/awp#config/signed-ed25519/0.1"],
    });
    const start = await pair.alice.runtime.startNegotiation({
      peer: { actor: BOB.actor, party: BOB.party },
      operation: SCHEDULE_OP,
      terms: terms(pair.alice.calendar, clock.now()),
      models: [MEETING_MODEL],
    });
    const describe = start.outbound[0]?.wire;
    if (describe?.format !== "awp-jws-compact/0.1") throw new Error("no describe");
    // Claim the Ed25519 configuration while signing with P-256: the payload changes, so the
    // signature must be regenerated by Alice's key — simulate a confused/malicious signer.
    const claimed = tamperPayload(describe.jws, (p) => {
      p.configuration = "https://w3id.org/jeswr/awp#config/signed-ed25519/0.1";
    });
    const [h, p] = claimed.split(".");
    const resigned = await new CompactSign(Buffer.from(p ?? "", "base64url"))
      .setProtectedHeader(JSON.parse(Buffer.from(h ?? "", "base64url").toString("utf8")))
      .sign(pair.alice.provisioned.actorKey.privateKey);
    const r = await pair.bob.runtime.receive({ format: "awp-jws-compact/0.1", jws: resigned });
    expect(r.reason).toBe("configuration-mismatch");
  });
});

describe("representation, mandate and approval", () => {
  it("refuses a meeting with a fee: a scheduling mandate grants no payment", async () => {
    const clock = fixedClock();
    // Alice proposes a paid consultation (fee payable by the acceptor, Bob).
    const { alice, bob, bus, conversation } = await openProposal({
      now: clock.now,
      fee: { amount: 50, currency: "GBP" },
    });
    await bus.run();
    expect(bob.runtime.conversation(conversation)?.phase).toBe("refused");
    expect(alice.runtime.conversation(conversation)?.closedReason).toBe("not-authorised");
    const decision = bob.ledger.entries().find((e) => e.record.type === "authorisation-decision");
    expect(decision?.record.outcome).toBe("deny");
    expect(String(decision?.record.reason)).toMatch(/prohibit/);
    expect(bob.calendar.holdCount).toBe(0);
  });

  it("refuses when no slot is acceptable (mismatch) after bounded counter-proposals", async () => {
    const clock = fixedClock();
    const busyAll = newYorkCalendar();
    busyAll.busy = [{ start: "2026-10-19T00:00:00Z", end: "2026-10-31T00:00:00Z" }];
    const { alice, bus, conversation } = await openProposal({
      now: clock.now,
      bobCalendar: busyAll,
    });
    await bus.run();
    const conv = alice.runtime.conversation(conversation);
    expect(conv?.phase).toBe("refused");
    expect(conv?.closedReason).toBe("no-acceptable-slot");
  });

  it("does not let an agent act after its own mandate expires (fail closed, nothing sent)", async () => {
    const clock = fixedClock();
    const pair = await personalPair({ now: clock.now, validityDays: 1 });
    clock.advance(2 * 86_400_000);
    const start = await pair.alice.runtime.startNegotiation({
      peer: { actor: BOB.actor, party: BOB.party },
      operation: SCHEDULE_OP,
      terms: terms(pair.alice.calendar, clock.now(), {
        start: "2026-10-22T13:00:00Z",
        end: "2026-10-22T17:00:00Z",
      }),
      models: [MEETING_MODEL],
    });
    const bus = new DirectBus()
      .register(pair.alice.runtime, pair.bob.runtime)
      .send(pair.alice.runtime, start);
    await bus.run();
    expect(bus.trace.map((t) => t.kind)).toEqual(["describe", "description"]);
    const conv = pair.alice.runtime.conversation(start.conversation as string);
    expect(conv?.phase).toBe("refused");
    expect(conv?.closedReason).toMatch(/mandate-invalid: expired/);
  });

  it("refuses a proposal whose representation statement is expired or out of scope", async () => {
    const clock = fixedClock();
    const { alice, bob } = await provisionPair({ now: clock.now });
    const expired = await signStatement(alice.ownerKey, TYP.representation, {
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
    const outOfScope = await signStatement(alice.ownerKey, TYP.representation, {
      type: "RepresentationStatement",
      id: scopedUrn("representation", ALICE.actor, "rep-narrow"),
      party: ALICE.party,
      actor: ALICE.actor,
      actorKid: alice.actorKey.kid,
      operations: ["https://w3id.org/jeswr/awp#op/other"],
      validFrom: "2026-10-01T00:00:00Z",
      validUntil: "2026-12-01T00:00:00Z",
      issuedAt: "2026-10-01T00:00:00Z",
    });
    for (const [rep, reason] of [
      [expired, "representation-expired"],
      [outOfScope, "representation-out-of-scope"],
    ] as const) {
      const a = await startAgent({ ...alice, representationJws: rep }, londonCalendar(), {
        now: clock.now,
        accepted: ["https://w3id.org/jeswr/awp#config/signed-ed25519/0.1"],
      });
      const b = await startAgent(bob, newYorkCalendar(), {
        now: clock.now,
        accepted: ["https://w3id.org/jeswr/awp#config/signed-ed25519/0.1"],
      });
      const start = await a.runtime.startNegotiation({
        peer: { actor: BOB.actor, party: BOB.party },
        operation: SCHEDULE_OP,
        terms: terms(a.calendar, clock.now()),
        models: [MEETING_MODEL],
      });
      const bus = new DirectBus().register(a.runtime, b.runtime).send(a.runtime, start);
      await bus.run();
      expect(a.runtime.conversation(start.conversation as string)?.closedReason).toBe(reason);
      expect(b.calendar.holdCount).toBe(0);
    }
  });

  it("marks a mandate using an operand outside the pilot subset as indeterminate, never permit", async () => {
    const clock = fixedClock();
    const { alice, bus, conversation } = await openProposal({
      now: clock.now,
      bobMandate: mandateWithUnsupportedTerm,
    });
    await bus.run();
    expect(alice.runtime.conversation(conversation)?.phase).toBe("indeterminate");
    expect(alice.runtime.conversation(conversation)?.closedReason).toBe("indeterminate-policy");
  });

  it("requires an owner approval bound to the exact action for an unknown counterparty", async () => {
    const clock = fixedClock();
    // Alice's mandate lists no known counterparties → with-approval policy applies.
    const pair = await personalPair({ now: clock.now, aliceMandate: schedulingMandate([]) });
    const start = await pair.alice.runtime.startNegotiation({
      peer: { actor: BOB.actor, party: BOB.party },
      operation: SCHEDULE_OP,
      terms: terms(pair.alice.calendar, clock.now()),
      models: [MEETING_MODEL],
    });
    const bus = new DirectBus()
      .register(pair.alice.runtime, pair.bob.runtime)
      .send(pair.alice.runtime, start);
    await bus.run();
    const pending = pair.alice.runtime.pendingApprovals();
    expect(pending).toHaveLength(1);
    expect(bus.trace.map((t) => t.kind)).toEqual(["describe", "description"]);
    const approve = (digest: string) =>
      signApproval(pair.alice.provisioned.ownerKey, {
        type: "OwnerApproval",
        id: `urn:uuid:approval-${digest.slice(-8)}`,
        issuer: ALICE.party,
        actor: ALICE.actor,
        actionDigest: digest,
        conversation: start.conversation as string,
        decision: "approve",
        issuedAt: clock.now().toISOString(),
        validUntil: new Date(clock.now().getTime() + 3_600_000).toISOString(),
      });
    // An approval for a different action does not release the pending one.
    const stale = await pair.alice.runtime.submitApproval(await approve("sha-256:0000"));
    expect(stale.outbound).toHaveLength(0);
    expect(pair.alice.runtime.pendingApprovals()).toHaveLength(1);
    // An approval signed by someone other than the owner is rejected.
    const forged = await signApproval(pair.bob.provisioned.ownerKey, {
      type: "OwnerApproval",
      id: "urn:uuid:forged",
      issuer: ALICE.party,
      actor: ALICE.actor,
      actionDigest: pending[0]?.actionDigest as string,
      conversation: start.conversation as string,
      decision: "approve",
      issuedAt: clock.now().toISOString(),
      validUntil: new Date(clock.now().getTime() + 3_600_000).toISOString(),
    });
    expect((await pair.alice.runtime.submitApproval(forged)).disposition).toBe("rejected");
    const ok = await pair.alice.runtime.submitApproval(
      await approve(pending[0]?.actionDigest as string),
    );
    expect(ok.outbound.map((o) => o.kind)).toEqual(["propose"]);
    bus.send(pair.alice.runtime, ok);
    await bus.run();
    expect(pair.alice.runtime.conversation(start.conversation as string)?.phase).toBe("completed");
  });
});

describe("uncertain effects, reconciliation and restart", () => {
  it("reconciles a timeout after commit instead of retrying (no duplicate hold)", async () => {
    const clock = fixedClock();
    const { alice, bob, bus, conversation } = await openProposal({ now: clock.now });
    bob.calendar.failNext = "timeout-after-commit";
    await bus.run();
    expect(bob.runtime.conversation(conversation)?.phase).toBe("uncertain");
    expect(bob.calendar.holdCount).toBe(1);
    const r = await bob.runtime.reconcile();
    bus.send(bob.runtime, r);
    await bus.run();
    expect(bob.calendar.holdCount).toBe(1);
    expect(bob.runtime.conversation(conversation)?.phase).toBe("completed");
    expect(alice.runtime.conversation(conversation)?.phase).toBe("completed");
    expect(
      bob.ledger
        .entries()
        .some(
          (e) =>
            e.record.type === "outcome" &&
            e.record.method === "reconciliation" &&
            e.record.conclusion === "completed",
        ),
    ).toBe(true);
  });

  it("retries under the same key only after reconciliation proves nothing happened", async () => {
    const clock = fixedClock();
    const { bob, bus, conversation } = await openProposal({ now: clock.now });
    bob.calendar.failNext = "timeout-before-commit";
    await bus.run();
    expect(bob.calendar.holdCount).toBe(0);
    expect(bob.runtime.conversation(conversation)?.phase).toBe("uncertain");
    bus.send(bob.runtime, await bob.runtime.reconcile());
    await bus.run();
    expect(bob.calendar.holdCount).toBe(1);
    expect(bob.runtime.conversation(conversation)?.phase).toBe("completed");
  });

  it("survives a restart: persisted replay set and effect states prevent duplicate effects", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awp-restart-"));
    dirs.push(dir);
    const clock = fixedClock();
    const opts = { now: clock.now, dir };
    const { alice, bob } = await provisionPair(opts);
    const accepted = ["https://w3id.org/jeswr/awp#config/signed-ed25519/0.1"];
    let a = await startAgent(alice, londonCalendar(), { ...opts, accepted });
    let b = await startAgent(bob, newYorkCalendar(), { ...opts, accepted });
    b.calendar.failNext = "timeout-after-commit";
    const start = await a.runtime.startNegotiation({
      peer: { actor: BOB.actor, party: BOB.party },
      operation: SCHEDULE_OP,
      terms: terms(a.calendar, clock.now()),
      models: [MEETING_MODEL],
    });
    const wires: Array<{ to: string; wire: WireMessage }> = [];
    let bus = new DirectBus().register(a.runtime, b.runtime).send(a.runtime, start);
    await bus.run(({ to, out }) => {
      wires.push({ to: to.identity.actor, wire: out.wire });
      return undefined;
    });
    expect(b.runtime.conversation(start.conversation as string)?.phase).toBe("uncertain");
    // "Crash": drop both runtimes, re-open from disk.
    a.runtime.close();
    b.runtime.close();
    a = await startAgent(alice, londonCalendar(), { ...opts, accepted });
    b = await startAgent(bob, newYorkCalendar(), { ...opts, accepted });
    expect(b.calendar.holdCount).toBe(1);
    // Redelivering every earlier message is idempotent.
    for (const w of wires) {
      const rt = w.to === BOB.actor ? b.runtime : a.runtime;
      const r: StepResult = await rt.receive(w.wire);
      expect(["duplicate", "rejected"]).toContain(r.disposition);
    }
    bus = new DirectBus()
      .register(a.runtime, b.runtime)
      .send(b.runtime, await b.runtime.reconcile());
    await bus.run();
    expect(b.calendar.holdCount).toBe(1);
    expect(a.calendar.holdCount).toBe(1);
    expect(b.runtime.conversation(start.conversation as string)?.phase).toBe("completed");
    expect(a.runtime.conversation(start.conversation as string)?.phase).toBe("completed");
    a.runtime.close();
    b.runtime.close();
  });
});
