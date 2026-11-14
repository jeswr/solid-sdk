// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import { openConversation } from "../src/core/conversation.js";
import { DEFAULT_LIMITS } from "../src/core/limits.js";
import type { JsonObject } from "../src/core/types.js";
import { type GateContext, GateMemory } from "../src/gates/common.js";
import { InboundGate } from "../src/gates/inbound.js";
import { OutboundGate } from "../src/gates/outbound.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { MessageNode } from "../src/model/message-nodes.js";
import { CONFIG_ED25519 } from "../src/profile/configurations.js";
import { PILOT_PROFILE } from "../src/profile/vocabulary.js";
import { testKey } from "../src/reference/keys.js";
import { Cast, mandateOf, signClaim } from "../src/scenarios/common.js";
import { TraceRecorder } from "../src/trace/recorder.js";

const AT = "2026-11-13T09:00:00.000Z";
const OP = "urn:test:claim-operation";
const PURPOSE = "urn:test:purpose";
const ISSUER = "urn:test:accepted-assessor";
async function fixture(claims = ["assessment"]) {
  let now = AT;
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
    actionClaims: [{ action: OP, claims }],
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
    now: () => now,
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
  return {
    inbound,
    outbound,
    key,
    memory,
    recorder,
    claim,
    gate,
    sources,
    setNow: (at: string) => {
      now = at;
    },
  };
}

async function messageAdmission(
  f: Awaited<ReturnType<typeof fixture>>,
  evidence: string[],
  input: JsonObject = {},
) {
  const message = MessageNode.toNode({
    profile: PILOT_PROFILE,
    configuration: CONFIG_ED25519,
    id: "urn:test:message",
    conversation: "urn:test:conversation",
    kind: "invoke",
    from: { actor: "urn:test:subject-agent", onBehalfOf: "urn:test:subject" },
    to: { actor: "urn:test:receiver-agent" },
    createdAt: AT,
    expiresAt: "2026-11-13T10:00:00.000Z",
    body: {
      operation: { id: OP, version: "1" },
      input,
      basis: { kind: "public" },
      purpose: PURPOSE,
    },
    evidence: evidence.map((value) => ({ role: "credential", format: "jws-compact", value })),
  }).live;
  const conversation = openConversation({
    id: message.conversation,
    role: "responder",
    peer: { actor: "urn:test:subject-agent" },
    at: AT,
  });
  if (evidence.length) expect(message.evidence?.[0]?.value).toBe(evidence[0]);
  return f.inbound.arrive({}, undefined, message).complete(conversation, message);
}

it("checks evidence-bearing deliveries and leaves discovery, negotiation and closure kinds outside operation coverage", async () => {
  for (const kind of [
    "deliver",
    "describe",
    "propose",
    "challenge",
    "refuse",
    "receipt",
  ] as const) {
    const f = await fixture();
    const common = {
      profile: PILOT_PROFILE,
      configuration: CONFIG_ED25519,
      id: "urn:test:message",
      conversation: "urn:test:conversation",
      from: { actor: "urn:test:subject-agent", onBehalfOf: "urn:test:subject" },
      to: { actor: "urn:test:receiver-agent" },
      createdAt: AT,
      expiresAt: "2026-11-13T10:00:00.000Z",
    };
    const operation = { id: OP, version: "1" };
    const input =
      kind === "deliver"
        ? {
            ...common,
            kind,
            body: {
              ref: "urn:test:request",
              operation,
              basis: { kind: "represented" },
              output: {},
            },
          }
        : kind === "describe"
          ? { ...common, kind, body: { want: [OP] } }
          : kind === "propose"
            ? {
                ...common,
                kind,
                body: { operation, terms: {}, termsDigest: digestOf({}), round: 1 },
              }
            : kind === "challenge"
              ? {
                  ...common,
                  kind,
                  body: {
                    ref: "urn:test:request",
                    reason: "evidence-missing",
                    needs: {
                      id: "urn:test:challenge",
                      nonce: "urn:test:nonce",
                      expiresAt: "2026-11-13T09:05:00.000Z",
                      claim: "assessment",
                    },
                  },
                }
              : kind === "refuse"
                ? { ...common, kind, body: { ref: "urn:test:request", reason: "not-authorised" } }
                : {
                    ...common,
                    kind,
                    body: {
                      ref: "urn:test:request",
                      activity: "urn:test:activity",
                      outcome: "completed",
                    },
                  };
    const message = MessageNode.toNode(input as import("../src/core/types.js").AnyMessage).live;
    const conv = {
      ...openConversation({
        id: message.conversation,
        role: "initiator",
        peer: common.from,
        at: AT,
      }),
      operation,
    };
    const result = await f.inbound.arrive({}, undefined, message).complete(conv, message);
    expect(result, kind).toMatchObject(
      kind === "deliver" ? { ok: false, reason: "evidence-missing", askMore: true } : { ok: true },
    );
    expect(
      f.recorder.events().some((e) => e.rule?.id === "CORE-IN-21"),
      kind,
    ).toBe(kind === "deliver");
  }
});

it("covers required kinds with this message or same-task fit evidence; missing and stale evidence ask for more", async () => {
  for (const variant of [
    "present",
    "missing",
    "held",
    "stale",
    "other-task",
    "other-subject",
    "changed-digest",
    "weakened-method",
  ]) {
    const f = await fixture();
    if (variant === "other-subject") f.claim.subject = "urn:test:another-subject";
    if (!["present", "missing"].includes(variant)) {
      expect(
        await f.inbound.admitStatements([{ jws: await signClaim(f.key, f.claim) }], {
          task: "urn:test:task",
          taskId: "urn:test:task",
          purpose: PURPOSE,
        }),
      ).toEqual({ admitted: 1, refused: 0 });
      if (variant === "stale") f.setNow("2027-01-01T00:00:00.000Z");
      if (variant === "other-task") {
        f.memory.contexts["urn:test:other-task"] = f.memory.contexts["urn:test:task"]!;
        delete f.memory.contexts["urn:test:task"];
      }
      if (variant === "changed-digest") f.claim.value = "substituted";
      if (variant === "changed-digest") {
        const fact = f.memory.facts.get(String(f.claim.id))!;
        f.memory.facts.set(fact.id, { ...fact, statement: f.claim });
      }
      if (variant === "weakened-method") {
        const fact = f.memory.facts.get(String(f.claim.id))!;
        f.memory.facts.set(fact.id, { ...fact, method: "self-reported" });
      }
    }
    const result = await messageAdmission(
      f,
      variant === "present" ? [await signClaim(f.key, f.claim)] : [],
    );
    const pass = ["present", "held"].includes(variant);
    expect(
      result,
      `${variant}: ${JSON.stringify(
        f.recorder
          .events()
          .filter((e) => e.part !== "transport")
          .map(({ check, reason, verdict }) => ({ check, reason, verdict })),
      )}`,
    ).toMatchObject(pass ? { ok: true } : { ok: false, askMore: true, reason: "evidence-missing" });
    const coverage = f.recorder.events().findLast((event) => event.rule?.id === "CORE-IN-21");
    expect(coverage, variant).toMatchObject({
      check: "fitness",
      verdict: pass ? "pass" : "ask-more",
    });
    if (!pass) {
      expect(coverage?.refs).toContainEqual(expect.objectContaining({ id: "assessment" }));
      expect(coverage?.caption).toContain("Required claim: assessment");
      expect(coverage?.caption).toContain("recorded-by-authority");
    }
  }
});

it("retains passing statements on a partial request and keeps a failed required statement's more specific reason", async () => {
  const f = await fixture(["assessment", "another-assessment"]);
  expect(await messageAdmission(f, [await signClaim(f.key, f.claim)])).toMatchObject({
    ok: false,
    reason: "evidence-missing",
  });
  expect(f.memory.context("urn:test:task")).toHaveLength(1);
  expect(f.memory.facts.has(String(f.claim.id))).toBe(true);
  const bad = await fixture();
  bad.claim.asOf = "2025-01-01T00:00:00.000Z";
  expect(await messageAdmission(bad, [await signClaim(bad.key, bad.claim)])).toMatchObject({
    ok: false,
    reason: "stale-data",
    askMore: true,
  });
  expect(bad.recorder.events().some((e) => e.reason === "evidence-missing")).toBe(false);
  const mixed = await fixture(["assessment", "another-assessment"]);
  mixed.claim.asOf = "2025-01-01T00:00:00.000Z";
  const result = await messageAdmission(mixed, [await signClaim(mixed.key, mixed.claim)]);
  expect(result).toMatchObject({ ok: false, reason: "stale-data", askMore: true });
  if (!result.ok) expect(result.detail).toContain("Required claim: another assessment");
  expect(mixed.recorder.events().findLast((e) => e.rule?.id === "CORE-IN-21")?.refs).toContainEqual(
    expect.objectContaining({ id: "another-assessment" }),
  );
});

it("binds coverage to the explicitly referenced item's subject, with explicit subjects taking precedence", async () => {
  for (const variant of [
    "referenced",
    "held-reference",
    "wrong-reference",
    "explicit-other-subject",
    "implicit-party",
    "ambiguous-reference",
  ]) {
    const f = await fixture();
    f.claim.subject = "urn:test:material-lot";
    const signed = await signClaim(f.key, f.claim);
    if (variant === "held-reference")
      await f.inbound.admitStatements([{ jws: signed }], {
        task: "urn:test:task",
        taskId: "urn:test:task",
        purpose: PURPOSE,
      });
    const input: JsonObject =
      variant === "implicit-party"
        ? {}
        : { items: [variant === "wrong-reference" ? "urn:test:unrelated" : String(f.claim.id)] };
    if (variant === "explicit-other-subject") input.subject = "urn:test:subject";
    const evidence = variant === "held-reference" ? [] : [signed];
    if (variant === "ambiguous-reference") {
      const other = { ...f.claim, id: "urn:test:other-assessment", subject: "urn:test:subject" };
      input.items = [String(f.claim.id), other.id];
      evidence.push(await signClaim(f.key, other));
    }
    expect(await messageAdmission(f, evidence, input), variant).toMatchObject(
      ["referenced", "held-reference"].includes(variant)
        ? { ok: true }
        : { ok: false, reason: "evidence-missing" },
    );
  }
});

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
