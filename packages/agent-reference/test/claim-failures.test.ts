// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.2 Sol
import { expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import { openConversation } from "../src/core/conversation.js";
import { DEFAULT_LIMITS } from "../src/core/limits.js";
import type { JsonObject } from "../src/core/types.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import type { Scenario } from "../src/engine/schema.js";
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
    claimTypes: ["assessment", "unstructured-content"],
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
        {
          id: "urn:test:letter-fitness",
          claimType: "unstructured-content",
          methods: ["recorded-by-authority"],
          maxAgeDays: 30,
          text: "Admit the assessor's letter as content.",
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

it.each([
  "accepted",
  "other",
  "structured",
] as const)("uses the issuer of admitted prose to request structured evidence (%s)", async (variant) => {
  const f = await fixture();
  if (variant === "other") f.sources.assessment = ["urn:test:another-assessor"];
  const content = {
    ...f.claim,
    id: "urn:test:assessor-letter",
    claimType: "unstructured-content",
    value: { contentDigest: digestOf("The damage is serious.") },
  };
  const evidence = [await signClaim(f.key, content)];
  if (variant === "structured") evidence.push(await signClaim(f.key, f.claim));
  const result = await messageAdmission(f, evidence);
  expect(f.memory.facts.has(content.id)).toBe(true);
  if (variant === "structured") {
    expect(result).toMatchObject({ ok: true });
    return;
  }
  const reason = variant === "accepted" ? "structured-form-required" : "evidence-missing";
  expect(result).toMatchObject({ ok: false, askMore: true, reason });
  const coverage = f.recorder.events().findLast((event) => event.rule?.id === "CORE-IN-21");
  expect(coverage).toMatchObject({ verdict: "ask-more", reason });
  if (variant === "accepted") {
    expect(coverage?.refs?.map((ref) => ref.id)).toEqual(["assessment", content.id]);
    expect(coverage?.caption).toContain(`Ask ${ISSUER}`);
    expect(coverage?.caption).toContain("recorded-by-authority");
    expect(coverage?.caption).not.toContain("urn:test:subject");
  }
});

const insuranceRoot = new URL("..", import.meta.url).pathname;

it.each([
  true,
  false,
])("holds the policyholder's release with only a signed garage letter (accepted source: %s)", async (accepted) => {
  const { profile, scenario } = loadCase(insuranceRoot, "insurance-claim-photos");
  const branch = scenario.branches.find((b) => b.id === "branch-1")!;
  const garage = scenario.parties.find((party) => party.id === "garage")!;
  if (!accepted) {
    branch.profileChange = {
      claims: {
        "repair.estimate": {
          sources: profile.claims
            .find((claim) => claim.kind === "repair.estimate")!
            .sources.filter((source) => source !== garage.identity),
        },
      },
    };
    branch.expect = { outcome: "stop", check: "fitness", reason: "evidence-missing" };
    delete branch.catalogueExpected;
  }
  const [, path] = await runScenario(
    profile,
    { ...scenario, branches: [branch] },
    { compare: false },
  );
  const events = path!.trace!.events;
  const hold = events.findLast((e) => e.kind === "decision")!;
  expect(hold).toMatchObject({
    agent: "owner-agent",
    part: "outbound-gate",
    outcome: branch.expect.outcome,
    reason: branch.expect.reason,
  });
  expect(
    events.some((e) => e.agent === "owner-agent" && e.fact?.id.endsWith(":garage-letter")),
  ).toBe(true);
  const fitness = events.find(
    (e) =>
      e.agent === hold.agent &&
      e.part === hold.part &&
      e.gateRun === hold.gateRun &&
      e.check === "fitness",
  );
  expect(fitness).toMatchObject({
    verdict: accepted ? "ask-more" : "fail",
    reason: branch.expect.reason,
  });
  if (accepted) {
    expect(fitness?.caption).toContain(garage.name);
    expect(fitness?.caption).toContain("repair estimate");
    expect(fitness?.caption).toContain("recorded-by-authority");
  }
  expect(
    events
      .filter((e) => e.step >= hold.step)
      .some(
        (e) => e.agent === "receiver-agent" || ["message-out", "ask-principal"].includes(e.kind),
      ),
  ).toBe(false);
}, 120_000);

it("holds the insurer's core at the coverage check until a structured estimate arrives", async () => {
  const { profile, scenario } = loadCase(insuranceRoot, "insurance-claim-photos");
  const branch = scenario.branches.find((b) => b.id === "branch-1")!;
  const retry = scenario.branches.find((b) => b.id === "needed-claim-left-out")!;
  const change = branch.change as Pick<Scenario, "script" | "statements" | "stopAfter">;
  const retryChange = retry.change as Pick<Scenario, "script">;
  // Lift the policyholder's earlier outbound bar by admitting the estimate locally.
  change.statements.push(scenario.statements.find((claim) => claim.id === "estimate")!);
  const admit = change.script.find((step) => step.type === "admit")!;
  if (admit.type !== "admit") throw new Error("Expected local statement admission");
  admit.statements.push("estimate");
  change.script.push(
    ...retryChange.script.slice(
      retryChange.script.findIndex((step) => step.id === "approve-exact-account"),
    ),
  );
  delete change.stopAfter;
  const [, path] = await runScenario(
    profile,
    { ...scenario, branches: [branch] },
    { compare: false },
  );
  const events = path!.trace!.events;
  const challenge = events.find(
    (e) =>
      e.agent === "receiver-agent" &&
      e.kind === "decision" &&
      e.reason === "structured-form-required",
  )!;
  expect(challenge).toMatchObject({
    part: "inbound-gate",
    outcome: "ask-more",
  });
  const arrival = events.findLast(
    (e) => e.agent === challenge.agent && e.kind === "message-in" && e.seq < challenge.seq,
  )!;
  expect(arrival.seq).toBeLessThan(challenge.seq);
  const admitted = events.find(
    (e) =>
      e.agent === challenge.agent &&
      e.kind === "decision" &&
      e.outcome === "admit" &&
      e.seq > challenge.seq,
  )!;
  expect(
    events.some(
      (e) =>
        e.agent === challenge.agent &&
        e.part === "core" &&
        e.seq > arrival.seq &&
        e.seq < admitted.seq,
    ),
  ).toBe(false);
  expect(
    events.some((e) => e.agent === challenge.agent && e.part === "core" && e.seq > admitted.seq),
  ).toBe(true);
}, 120_000);
