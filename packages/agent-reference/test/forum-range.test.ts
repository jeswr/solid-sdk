// AUTHORED-BY Claude Opus 5.5
// Brief 31 item 4: range-proving record segments. A segment may carry only the entries
// after an anchor entry, with the anchor's chain hash and the other party's receipt for it.
import { expect, it } from "vitest";
import { z } from "zod";
import { digestOf } from "../src/core/canonical.js";
import { LocalForum, RECORD_LIMITS } from "../src/mechanisms/forum.js";
import { signStatement, TYP, verifyStatement } from "../src/mechanisms/statements.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";
import { MemoryLedger, verifyLedgerRange } from "../src/store/ledger.js";
import { MemoryStateStore } from "../src/store/state.js";

const AT = "2026-11-13T09:00:00.000Z";
type Attack = "whole" | "none" | "wrong-anchor" | "gap" | "forged-anchor" | "unlinked";

async function fixture(attack: Attack) {
  const keys = await Promise.all(["forum", "a", "b"].map((id) => testKey(`forum/${id}`)));
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:forum",
    sourceAuthority: [],
    keys: keys.map((k, i) => ({
      kid: k.kid,
      alg: k.alg,
      publicJwk: k.publicJwk,
      role: i ? "actor" : "issuer",
      subject: i ? `urn:actor:${i}` : "urn:forum",
      ...(i ? { party: `urn:party:${i}` } : {}),
    })),
  });
  const forum = new LocalForum({
    identity: "urn:forum",
    key: required(keys[0]),
    trust,
    store: new MemoryStateStore(),
    ledger: new MemoryLedger(),
    now: () => AT,
    responseSeconds: 60,
    observers: [],
    sink: () => {},
  });
  const common = {
    profile: "urn:profile",
    configuration: "urn:config",
    conversation: "urn:conversation",
    createdAt: AT,
    expiresAt: "2026-11-14T09:00:00.000Z",
  };
  const terms = { fee: 0 };
  const offer = {
    ...common,
    id: "urn:offer",
    kind: "propose",
    from: { actor: "urn:actor:1", onBehalfOf: "urn:party:1" },
    to: { actor: "urn:actor:2", party: "urn:party:2" },
    body: {
      operation: { id: "urn:operation", version: "1" },
      terms,
      termsDigest: digestOf(terms),
      round: 1,
    },
  };
  const accept = {
    ...common,
    id: "urn:accept",
    kind: "accept",
    from: { actor: "urn:actor:2", onBehalfOf: "urn:party:2" },
    to: { actor: "urn:actor:1", party: "urn:party:1" },
    body: { proposal: "urn:offer", termsDigest: digestOf(terms), agreement: "urn:agreement" },
  };
  const messages = [offer, accept];
  const wires = await Promise.all(
    messages.map((m, i) => signStatement(required(keys[i + 1]), TYP.message, m)),
  );
  async function segment(actor: number) {
    const peer = actor === 1 ? 2 : 1;
    const ledger = new MemoryLedger();
    // Earlier history that a range segment leaves out.
    for (const n of [1, 2, 3]) ledger.append({ type: "earlier", n }, AT);
    const head = required(ledger.entries().at(-1));
    const archived = [];
    for (const [i, m] of messages.entries()) {
      const direction = (actor === 1 ? i === 0 : i === 1) ? "out" : "in";
      ledger.append(
        { type: `message-${direction}`, conversation: common.conversation, digest: digestOf(m) },
        AT,
      );
      archived.push({ direction, digest: digestOf(m), jws: wires[i] });
    }
    const check = { type: "gate-check", gate: "inbound", check: "integrity", reason: "intact" };
    ledger.append(check, AT);
    ledger.append({ type: "gate-decision", checks: [digestOf(check)] }, AT);
    const ranged = attack !== "whole";
    // A gap or a broken link is measured on the respondent's side.
    const victim = actor === 2;
    const exported = ledger.entries().filter((e) => !ranged || e.seq > head.seq);
    const entries = await Promise.all(
      exported.map(async (entry) => ({
        entry: structuredClone(entry),
        proof: await signStatement(required(keys[actor]), "awp-record-entry+jws", entry),
      })),
    );
    if (attack === "gap" && victim) entries.splice(1, 1);
    const witness = attack === "forged-anchor" && victim ? actor : peer;
    const receipt = await signStatement(required(keys[witness]), "awp-record-anchor+jws", {
      type: "RecordAnchorReceipt",
      actor: `urn:actor:${witness}`,
      party: `urn:party:${witness}`,
      subject: `urn:actor:${actor}`,
      subjectParty: `urn:party:${actor}`,
      seq: head.seq,
      // "unlinked": the peer attests a hash that is not the entry the range follows.
      hash:
        attack === "unlinked" && victim ? required(ledger.entries()[head.seq - 2]).hash : head.hash,
      at: AT,
    });
    const anchor = {
      seq: head.seq,
      hash:
        attack === "wrong-anchor" && victim
          ? "sha-256:not-the-anchor"
          : attack === "unlinked" && victim
            ? required(ledger.entries()[head.seq - 2]).hash
            : head.hash,
      receipt,
    };
    return signStatement(required(keys[actor]), "awp-record-segment+jws", {
      type: "RecordSegment",
      actor: `urn:actor:${actor}`,
      party: `urn:party:${actor}`,
      conversation: common.conversation,
      ...(ranged ? { anchor } : {}),
      entries,
      messages: archived,
    });
  }
  const claim = await signStatement(required(keys[1]), "awp-forum-claim+jws", {
    type: "ForumClaim",
    id: "urn:case",
    actor: "urn:actor:1",
    party: "urn:party:1",
    respondent: "urn:party:2",
    conversation: common.conversation,
    segment: await segment(1),
    allegation: "records-differ",
    at: AT,
  });
  const answer = await signStatement(required(keys[2]), "awp-forum-answer+jws", {
    type: "ForumAnswer",
    case: "urn:case",
    actor: "urn:actor:2",
    party: "urn:party:2",
    request: "",
    segment: await segment(2),
    at: AT,
  });
  return {
    async run() {
      expect(await forum.submit(claim), attack).toMatchObject({ ok: true });
      const response = await signStatement(required(keys[2]), "awp-forum-answer+jws", {
        ...(
          await verifyStatement(answer, {
            trust,
            typ: "awp-forum-answer+jws",
            role: "actor",
            schema: z.record(z.string(), z.unknown()),
            limits: RECORD_LIMITS,
            at: AT,
            verifier: "urn:reader",
          })
        ).payload,
        request: forum.requestFor("urn:case"),
      });
      await forum.answer(response);
      const jws = forum.decisionFor("urn:case");
      if (!jws) throw Error("no decision");
      return (
        await verifyStatement(jws, {
          trust,
          typ: TYP.statement,
          role: "issuer",
          schema: z.record(z.string(), z.unknown()),
          limits: RECORD_LIMITS,
          at: AT,
          verifier: "urn:reader",
        })
      ).payload;
    },
  };
}

it("decides a range segment as it decides the whole record, and refuses a bad anchor or a gap", async () => {
  const outcomes: Record<Attack, { reason: string; problem?: string }> = {
    whole: { reason: "evidence-missing" },
    none: { reason: "evidence-missing" },
    "wrong-anchor": { reason: "evidence-invalid", problem: "anchor-not-attested" },
    "forged-anchor": { reason: "evidence-invalid", problem: "anchor-not-attested" },
    gap: { reason: "record-unavailable", problem: "sequence gap" },
    unlinked: { reason: "record-unavailable", problem: "anchor link" },
  };
  for (const [attack, wanted] of Object.entries(outcomes) as [Attack, typeof outcomes.none][]) {
    const decision = await (await fixture(attack)).run();
    expect(decision?.reason, attack).toBe(wanted.reason);
    if (wanted.problem)
      expect((decision?.point as { problem?: string } | undefined)?.problem, attack).toBe(
        wanted.problem,
      );
  }
});

it("checks the first range entry against the anchor and the chain after it", () => {
  const ledger = new MemoryLedger();
  for (const n of [1, 2, 3, 4, 5]) ledger.append({ type: "entry", n }, AT);
  const all = ledger.entries();
  const anchor = { seq: 2, hash: required(all[1]).hash };
  expect(verifyLedgerRange(all.slice(2), anchor).ok).toBe(true);
  expect(verifyLedgerRange(all.slice(2), { ...anchor, hash: "sha-256:other" }).problem).toBe(
    "anchor link",
  );
  expect(verifyLedgerRange([all[2], all[4]].map(required), anchor).problem).toBe("sequence gap");
  expect(verifyLedgerRange(all.slice(3), anchor).problem).toBe("sequence gap");
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing test fixture");
  return value;
}
