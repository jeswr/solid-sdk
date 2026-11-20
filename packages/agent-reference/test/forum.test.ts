// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { z } from "zod";
import { digestOf } from "../src/core/canonical.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { LocalForum, RECORD_LIMITS } from "../src/mechanisms/forum.js";
import { signStatement, TYP, verifyStatement } from "../src/mechanisms/statements.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";
import { LEDGER_GENESIS, legacyApprovalRedaction, MemoryLedger } from "../src/store/ledger.js";
import { MemoryStateStore } from "../src/store/state.js";
import { decodeCompactPayload } from "../src/wire/inspect.js";

const AT = "2026-11-13T09:00:00.000Z";
async function fixture(attack = "none") {
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
  let at = AT;
  const store = new MemoryStateStore();
  const events: unknown[] = [];
  const forum = new LocalForum({
    identity: "urn:forum",
    key: required(keys[0]),
    trust,
    store,
    ledger: new MemoryLedger(),
    now: () => at,
    responseSeconds: 60,
    observers: [],
    sink: (e) => events.push(e),
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
    body: {
      proposal: "urn:offer",
      termsDigest: attack === "terms" ? "sha-256:wrong" : digestOf(terms),
      agreement: "urn:agreement",
    },
  };
  const messages = [offer, accept];
  const wires = await Promise.all(
    messages.map((m, i) => signStatement(required(keys[i + 1]), TYP.message, m)),
  );
  async function segment(actor: number) {
    const ledger = new MemoryLedger();
    const archived = [];
    for (const [i, m] of messages.entries()) {
      const direction = (actor === 1 ? i === 0 : i === 1) ? "out" : "in";
      if (attack === "one-side" && actor === 2 && i === 0) continue;
      ledger.append(
        {
          type: `message-${direction}`,
          conversation: common.conversation,
          id: m.id,
          digest: digestOf(m),
        },
        AT,
      );
      archived.push({ direction, digest: digestOf(m), jws: wires[i] });
    }
    const check = {
      type: "gate-check",
      ...(attack === "core-record" && actor === 2 ? { producer: "core" } : {}),
      gate: "inbound",
      check: "integrity",
      reason: "intact",
    };
    ledger.append(check, AT);
    ledger.append(
      {
        type: "gate-decision",
        checks: [attack === "citation" && actor === 2 ? "sha-256:absent" : digestOf(check)],
      },
      AT,
    );
    const withhold = actor === 2 && attack.startsWith("legacy-approval");
    const redacted = withhold
      ? required(
          legacyApprovalRedaction(
            ledger.append(
              {
                type: "approval",
                jws: "PRIVATE LEGACY APPROVAL",
              },
              AT,
            ),
          ),
        )
      : undefined;
    const entries = await Promise.all(
      ledger.entries().map(async (entry) => {
        const exported = redacted?.seq === entry.seq ? redacted : structuredClone(entry);
        return {
          entry: exported,
          proof: await signStatement(required(keys[actor]), "awp-record-entry+jws", exported),
        };
      }),
    );
    if (attack === "signature" && actor === 2)
      required(entries[0]).proof = await signStatement(
        required(keys[1]),
        "awp-record-entry+jws",
        required(entries[0]).entry,
      );
    if (attack === "gap" && actor === 2) entries.splice(1, 1);
    if (attack === "truncated" && actor === 2) entries.pop();
    if (attack === "tamper" && actor === 2)
      Object.assign(required(required(entries[0]).entry.record ?? undefined), {
        digest: "sha-256:tampered",
      });
    const peer = actor === 1 ? 2 : 1;
    const head = ledger.head();
    const terminal = {
      ...head,
      receipt: await signStatement(required(keys[peer]), "awp-record-anchor+jws", {
        type: "RecordAnchorReceipt",
        actor: `urn:actor:${peer}`,
        party: `urn:party:${peer}`,
        subject: `urn:actor:${actor}`,
        subjectParty: `urn:party:${actor}`,
        ...head,
        at: AT,
        interval: { conversation: common.conversation, from: LEDGER_GENESIS },
        ...(redacted && attack !== "legacy-approval-unwitnessed"
          ? {
              approvalRedactions: [
                digestOf(
                  attack === "legacy-approval-other"
                    ? { ...redacted, seq: redacted.seq - 1 }
                    : redacted,
                ),
              ],
            }
          : {}),
      }),
    };
    return {
      terminal,
      jws: await signStatement(required(keys[actor]), "awp-record-segment+jws", {
        type: "RecordSegment",
        actor: `urn:actor:${actor}`,
        party: `urn:party:${actor}`,
        conversation: common.conversation,
        ...(attack === "missing-terminal" ? {} : { terminal }),
        entries,
        messages: archived,
      }),
    };
  }
  const a = await segment(1),
    b = await segment(2);
  const claim = await signStatement(required(keys[1]), "awp-forum-claim+jws", {
    type: "ForumClaim",
    id: "urn:case",
    actor: "urn:actor:1",
    party: "urn:party:1",
    respondent: "urn:party:2",
    conversation: common.conversation,
    segment: a.jws,
    ...(attack === "missing-answer-terminal" ? {} : { answerThrough: b.terminal }),
    allegation: "records-differ",
    at: AT,
  });
  async function answer() {
    return forum.answer(
      await signStatement(required(keys[2]), "awp-forum-answer+jws", {
        type: "ForumAnswer",
        case: "urn:case",
        actor: "urn:actor:2",
        party: "urn:party:2",
        request: forum.requestFor("urn:case"),
        segment: b.jws,
        at,
      }),
    );
  }
  async function decision() {
    const jws = forum.decisionFor("urn:case");
    if (!jws) throw Error("no decision");
    return (
      await verifyStatement(jws, {
        trust,
        typ: TYP.statement,
        role: "issuer",
        schema: z.record(z.string(), z.unknown()),
        limits: RECORD_LIMITS,
        at,
        verifier: "urn:reader",
      })
    ).payload;
  }
  return {
    forum,
    claim,
    answer,
    decision,
    respondentRecord: b.jws,
    advance: () => {
      at = "2026-11-13T09:01:01.000Z";
    },
    events,
  };
}
it("accepts a peer-attested legacy approval redaction without exposing the approval", async () => {
  for (const [mode, reason] of [
    ["legacy-approval-witnessed", "evidence-missing"],
    ["legacy-approval-unwitnessed", "record-unavailable"],
    ["legacy-approval-other", "record-unavailable"],
  ] as const) {
    const f = await fixture(mode);
    const record = decodeCompactPayload(f.respondentRecord);
    expect(JSON.stringify(record)).not.toContain("PRIVATE LEGACY APPROVAL");
    expect(record.entries).toContainEqual(
      expect.objectContaining({
        entry: expect.objectContaining({ record: null }),
      }),
    );
    expect(await f.forum.submit(f.claim)).toMatchObject({ ok: true });
    await f.answer();
    expect(await f.decision()).toMatchObject({ reason });
  }
});

it("withholds a whole record when the exact signed payload has no grant", async () => {
  const { profile, scenario } = loadCase(join(import.meta.dirname, ".."), "fee-dispute");
  scenario.branches = [];
  scenario.stopAfter = "file-claim";
  const claim = scenario.script.find((step) => step.type === "forum-claim");
  if (!claim || claim.type !== "forum-claim") throw Error("missing fee claim fixture");
  claim.proofOwners = [];
  const [path] = await runScenario(profile, scenario, { compare: false });
  expect(path?.trace?.events.findLast(({ kind }) => kind === "decision")).toMatchObject({
    agent: "owner-agent",
    part: "outbound-gate",
    outcome: "stop",
    reason: "evidence-invalid",
  });
  expect(path?.trace?.events.some(({ agent }) => agent === "forum")).toBe(false);
});
it("verifies each segment independently and identifies tampering, sequence gaps, missing messages and check citations", async () => {
  for (const attack of [
    "none",
    "gap",
    "truncated",
    "tamper",
    "one-side",
    "citation",
    "terms",
    "signature",
    "core-record",
  ]) {
    const f = await fixture(attack);
    expect(await f.forum.submit(f.claim), attack).toMatchObject({ ok: true });
    await f.answer();
    const decision = await f.decision();
    expect(decision?.reason, attack).toBe(
      {
        none: "evidence-missing",
        gap: "record-unavailable",
        truncated: "record-unavailable",
        tamper: "record-unavailable",
        "one-side": "record-unavailable",
        citation: "record-unavailable",
        terms: "terms-digest-mismatch",
        signature: "evidence-invalid",
        "core-record": "record-unavailable",
      }[attack],
    );
    if (attack === "one-side") expect(decision?.settled).toBe(false);
  }
});
it("records a non-answer by the deadline and does not replace it with a late answer", async () => {
  const f = await fixture();
  await f.forum.submit(f.claim);
  f.advance();
  await f.forum.audit();
  expect(await f.decision()).toMatchObject({ reason: "record-unavailable", fault: "urn:party:2" });
  expect(await f.answer()).toMatchObject({ ok: false, reason: "expired" });
});
it("runs the fee and off-gate-copy claims with signed forum decisions and preserves the honest gate refusal", async () => {
  for (const id of ["fee-dispute", "onward-leak"]) {
    const { profile, scenario } = loadCase(join(import.meta.dirname, ".."), id);
    const paths = await runScenario(profile, scenario);
    expect(
      paths.every((p) => !p.blocked && !p.disagrees),
      id,
    ).toBe(true);
    const events = required(required(paths[0]).trace).events;
    expect(
      events.some(
        (e) =>
          e.agent === "forum" &&
          e.caption.includes(id === "fee-dispute" ? "fee-not-agreed" : "observed-outside-gate"),
      ),
      id,
    ).toBe(true);
    if (id === "onward-leak")
      expect(
        events.filter(
          (e) =>
            e.agent === "owner-agent" && e.kind === "message-out" && e.packet?.kind === "invoke",
        ),
      ).toHaveLength(0);
  }
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing test fixture");
  return value;
}

it.each([
  "missing-terminal",
  "missing-answer-terminal",
])("requires whole-record terminal commitments (%s)", async (attack) => {
  const f = await fixture(attack);
  expect(await f.forum.submit(f.claim)).toMatchObject({ ok: false, reason: "record-unavailable" });
  expect(f.forum.requestFor("urn:case")).toBeFalsy();
});
