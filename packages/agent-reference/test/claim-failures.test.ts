// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import { DEFAULT_LIMITS } from "../src/core/limits.js";
import type { JsonObject } from "../src/core/types.js";
import { type GateContext, GateMemory } from "../src/gates/common.js";
import { InboundGate } from "../src/gates/inbound.js";
import { OutboundGate } from "../src/gates/outbound.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";
import { Cast, mandateOf, signClaim } from "../src/scenarios/common.js";
import { TraceRecorder } from "../src/trace/recorder.js";

const AT = "2026-11-13T09:00:00.000Z";
const OP = "urn:test:claim-operation";
const PURPOSE = "urn:test:purpose";
const ISSUER = "urn:test:accepted-assessor";
async function fixture() {
  const cast = new Cast(() => new Date(AT));
  await cast.add(
    { name: "receiver", party: "urn:test:receiver", actor: "urn:test:receiver-agent" },
    mandateOf("claims", [{ type: "permission", action: "use", target: OP }]),
    [OP],
  );
  const key = await testKey("claims:issuer");
  cast.pinIssuer("receiver", ISSUER, key);
  cast.rule("receiver", {
    id: "urn:test:source-rule",
    version: "1",
    source: ISSUER,
    claimTypes: ["assessment"],
    subjects: "any",
  });
  const trust = await TrustStore.load(cast.trust.get("receiver"));
  const memory = new GateMemory();
  const recorder = new TraceRecorder();
  const sources = { assessment: [ISSUER] };
  const gate: GateContext = {
    taskId: "urn:test:task",
    sink: recorder.sink("receiver"),
    actionClaims: [{ action: OP, claims: ["assessment"] }],
    claimSources: sources,
    reliance: {
      id: "urn:test:reliance",
      rules: [
        {
          id: "urn:test:fitness",
          claimType: "assessment",
          methods: ["recorded-by-authority"],
          maxAgeDays: 30,
          text: "Require the accepted assessor's recent record.",
        },
      ],
    },
  };
  const inbound = new InboundGate({
    identity: { actor: "urn:test:receiver-agent" },
    trust,
    limits: DEFAULT_LIMITS,
    now: () => AT,
    record: () => {},
    gate,
    memory,
    agreementTerms: () => undefined,
  });
  const outbound = new OutboundGate({
    identity: { actor: "urn:test:receiver-agent" },
    now: () => AT,
    mandate: () => undefined,
    gate,
    memory,
    isReplyTo: () => true,
    offerTerms: () => undefined,
  });
  const claim: JsonObject = {
    id: "urn:test:assessment",
    issuer: ISSUER,
    subject: "urn:test:subject",
    claimType: "assessment",
    method: "recorded-by-authority",
    asOf: AT,
    value: "assessed",
  };
  return { inbound, outbound, key, memory, recorder, claim, gate, sources };
}

it("asks for the required claim and accepted sources/methods, keeps failed evidence outside context, and admits only a cured retry", async () => {
  for (const reason of ["method-not-accepted", "stale-data", "source-not-authoritative"]) {
    const f = await fixture();
    if (reason === "method-not-accepted") f.claim.method = "self-reported";
    if (reason === "stale-data") f.claim.asOf = "2025-01-01T00:00:00.000Z";
    if (reason === "source-not-authoritative") f.sources.assessment = [];
    const opts = { task: "urn:test:task", operation: OP, purpose: PURPOSE };
    const bad = { jws: await signClaim(f.key, f.claim) };
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await f.inbound.admitStatements([bad], opts)).toEqual({ admitted: 0, refused: 1 });
      const decision = f.recorder.events().at(-1);
      expect(decision).toMatchObject({ outcome: "ask-more", reason });
      expect(decision?.caption).toContain("Required claim: assessment");
      expect(decision?.caption).toContain("recorded-by-authority");
      if (reason !== "source-not-authoritative") expect(decision?.caption).toContain(ISSUER);
      expect(f.memory.facts.size).toBe(0);
      expect(f.memory.context(opts.task)).toEqual([]);
    }
    const intent = {
      action: "use",
      operation: OP,
      target: OP,
      conversation: "urn:test:conversation",
      purpose: PURPOSE,
      parameters: { support: [String(f.claim.id)] },
    };
    const release = f.outbound.release(intent, {
      type: "authorisation-decision",
      decider: "urn:test:receiver-agent",
      actionDigest: digestOf(intent),
      action: intent,
      at: AT,
      outcome: "permit",
      reason: "within-mandate",
      policy: { id: "urn:test:mandate", digest: "digest", evaluator: "test" },
    });
    expect(release).toMatchObject({ outcome: "stop", decision: { reason } });
    f.claim.method = "recorded-by-authority";
    f.claim.asOf = AT;
    f.sources.assessment = [ISSUER];
    expect(
      await f.inbound.admitStatements([{ jws: await signClaim(f.key, f.claim) }], opts),
    ).toEqual({ admitted: 1, refused: 0 });
    expect(f.memory.facts.get(String(f.claim.id))?.digest).toBe(digestOf(f.claim));
    expect(f.memory.context(opts.task)).toHaveLength(1);
  }
});

it("keeps unrelated claims and integrity failures on their existing refusal paths", async () => {
  const f = await fixture();
  f.claim.method = "self-reported";
  await f.inbound.admitStatements([{ jws: await signClaim(f.key, f.claim) }], {
    task: "urn:test:task",
    operation: "urn:test:unrelated",
  });
  expect(f.recorder.events().at(-1)).toMatchObject({
    outcome: "refuse",
    reason: "method-not-accepted",
  });
  const signed = await signClaim(f.key, f.claim);
  await f.inbound.admitStatements([{ jws: `${signed.slice(0, -8)}invalid!` }], {
    task: "urn:test:task",
    operation: OP,
  });
  expect(f.recorder.events().at(-1)?.outcome).toBe("refuse");
  expect(f.memory.facts.size).toBe(0);
});
