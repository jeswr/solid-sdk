// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import { DEFAULT_LIMITS } from "../src/core/limits.js";
import type { JsonObject } from "../src/core/types.js";
import { evaluateRule, ruleSchema, validateRules, verifyDerivation } from "../src/derive/rules.js";
import { GateMemory } from "../src/gates/common.js";
import { InboundGate } from "../src/gates/inbound.js";
import { evaluateItemTerms } from "../src/gates/quality.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";
import { Cast, mandateOf, signClaim } from "../src/scenarios/common.js";

const at = "2026-11-13T09:00:00.000Z",
  source = "urn:source:payroll",
  subject = "urn:person:fictional",
  task = "urn:task:credit",
  purpose = "urn:purpose:credit";
const baseRule = {
  id: "urn:rule:annual",
  template: "annualise-consecutive-months",
  params: { input: "monthly-net-pay", months: 12 },
  output: "annual-income",
  inputsFrom: [source],
};
async function fixture() {
  const key = await testKey("derive/payroll");
  const memory = new GateMemory();
  const rules = [ruleSchema.parse(baseRule)];
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:owner:receiver",
    keys: [{ ...key, publicJwk: key.publicJwk, role: "issuer", subject: source }].map(
      ({ kid, alg, publicJwk, role, subject }) => ({ kid, alg, publicJwk, role, subject }),
    ),
    sourceAuthority: [
      {
        id: "urn:rule:source",
        version: "1",
        source,
        claimTypes: [
          "monthly-net-pay",
          "complete",
          "numerator",
          "denominator",
          "yes",
          "no",
          "annual-income",
        ],
        subjects: [subject],
      },
    ],
  });
  const events: unknown[] = [];
  const gate = new InboundGate({
    identity: { actor: "urn:actor:receiver", party: "urn:owner:receiver" },
    trust,
    limits: DEFAULT_LIMITS,
    now: () => at,
    record: () => {},
    memory,
    agreementTerms: () => undefined,
    gate: {
      taskId: task,
      rules,
      reliance: {
        id: "urn:reliance",
        rules: [
          "monthly-net-pay",
          "complete",
          "numerator",
          "denominator",
          "yes",
          "no",
          "annual-income",
        ].map((claimType) => ({
          id: `urn:rule:${claimType}`,
          claimType,
          methods: ["recorded-by-authority", "derived"],
          maxAgeDays: 30,
          text: "fictional",
        })),
      },
      sink: { agent: "receiver", emit: (e) => events.push(e) },
    },
  });
  const statement: JsonObject = {
    id: "urn:input:monthly",
    issuer: source,
    subject,
    claimType: "monthly-net-pay",
    method: "recorded-by-authority",
    asOf: at,
    currency: "GBP",
    monthly: Array.from({ length: 12 }, (_, i) => ({
      month: `${i === 0 ? 2025 : 2026}-${String(i === 0 ? 12 : i).padStart(2, "0")}`,
      value: 4000,
    })),
  };
  const admit = async (claims: JsonObject[]) =>
    gate.admitStatements(
      await Promise.all(claims.map(async (claim) => ({ jws: await signClaim(key, claim) }))),
      { subject, purpose, task, taskId: task },
    );
  expect(await admit([statement])).toEqual({ admitted: 1, refused: 0 });
  const options = {
    rules,
    rule: rules[0]?.id as string,
    memory,
    task,
    subject,
    deriver: source,
    at,
    purpose,
  };
  return { options, memory, statement, admit, gate, key, events };
}
it("annualises actual admitted consecutive inputs and pins both rule and input bytes", async () => {
  const { options } = await fixture();
  const result = evaluateRule(options);
  expect(result).toMatchObject({
    ok: true,
    statement: {
      value: 48000,
      method: "derived",
      derivation: { ruleDigest: digestOf(options.rules[0]), assurance: "recomputed" },
    },
  });
  if (!result.ok) throw new Error("expected derivation");
  expect(verifyDerivation(result.statement, options).ok).toBe(true);
  for (const altered of [
    { ...result.statement, value: 99000 },
    { ...result.statement, asOf: "2026-11-12T00:00:00Z" },
    {
      ...result.statement,
      derivation: { ...(result.statement.derivation as JsonObject), inputs: [] },
    },
  ])
    expect(verifyDerivation(altered, options)).toMatchObject({
      ok: false,
      reason: "derivation-not-verified",
    });
  expect(verifyDerivation(result.statement, { ...options, rules: [] })).toMatchObject({
    ok: false,
    reason: "rule-not-accepted",
  });
});
it("missing, rejected, foreign-task, wrong-source, duplicate or gapped months give no output", async () => {
  const { options, memory, statement, admit } = await fixture();
  expect(evaluateRule({ ...options, task: "urn:other" })).toMatchObject({
    ok: false,
    reason: "completeness-not-established",
  });
  memory.facts.clear();
  expect(evaluateRule(options).ok).toBe(false);
  await admit([statement]);
  expect(
    evaluateRule({
      ...options,
      rules: [ruleSchema.parse({ ...baseRule, inputsFrom: ["urn:wrong-source"] })],
    }).ok,
  ).toBe(false);
  for (const monthly of [
    (statement.monthly as JsonObject[]).slice(1),
    (statement.monthly as JsonObject[]).map((r, i) => (i === 1 ? { ...r, month: "2025-12" } : r)),
  ]) {
    memory.contexts[task] = [];
    memory.facts.clear();
    await admit([{ ...statement, monthly }]);
    expect(evaluateRule(options)).toMatchObject({
      ok: false,
      reason: "completeness-not-established",
    });
  }
});
it("executes all templates, requires completeness for aggregates, and rejects cycles", async () => {
  const { options, admit, statement } = await fixture();
  const scalar = (id: string, value: number | boolean) => ({
    id: `urn:input:${id}`,
    issuer: source,
    subject,
    claimType: id,
    method: "recorded-by-authority",
    asOf: at,
    value,
  });
  await admit([
    scalar("numerator", 10),
    scalar("denominator", 2),
    scalar("yes", true),
    scalar("no", false),
    {
      ...scalar("complete", true),
      complete: true,
      forClaim: "monthly-net-pay",
      period: { start: "2025-12", end: "2026-11" },
    },
  ]);
  const rule = (template: string, params: unknown) =>
    ruleSchema.parse({
      id: "urn:rule:other",
      output: "other",
      inputsFrom: [source],
      template,
      params,
    });
  for (const [template, expected] of [
    ["sum", 48000],
    ["count", 12],
    ["min", 4000],
    ["max", 4000],
  ] as const) {
    const r = rule(template, {
      input: "monthly-net-pay",
      period: { start: "2025-12", end: "2026-11" },
      completeness: "complete",
    });
    expect(evaluateRule({ ...options, rules: [r], rule: r.id })).toMatchObject({
      ok: true,
      statement: { value: expected },
    });
    expect(
      evaluateRule({
        ...options,
        rules: [rule(template, { ...r.params, completeness: "absent" })],
        rule: r.id,
      }).ok,
    ).toBe(false);
  }
  for (const [template, params, value] of [
    ["ratio", { numerator: "numerator", denominator: "denominator" }, 5],
    ["threshold", { input: "numerator", operator: "gt", compareWith: "denominator" }, true],
    ["all-of", { inputs: ["yes", "no"] }, false],
    ["any-of", { inputs: ["yes", "no"] }, true],
  ] as const) {
    const r = rule(template, params);
    expect(evaluateRule({ ...options, rules: [r], rule: r.id })).toMatchObject({
      ok: true,
      statement: { value },
    });
    expect(
      evaluateRule({ ...options, memory: new GateMemory(), rules: [r], rule: r.id }),
    ).toMatchObject({ ok: false, reason: "completeness-not-established" });
  }
  await admit([scalar("denominator", 0)]);
  const zero = rule("ratio", { numerator: "numerator", denominator: "denominator" });
  expect(evaluateRule({ ...options, rules: [zero], rule: zero.id })).toMatchObject({
    ok: false,
    reason: "completeness-not-established",
  });
  for (const template of ["all-of", "any-of"]) {
    const wrongType = rule(template, { inputs: ["yes", "numerator"] });
    expect(evaluateRule({ ...options, rules: [wrongType], rule: wrongType.id }).ok).toBe(false);
  }
  const nonNumeric = rule("threshold", { input: "yes", operator: "gt", value: 0 });
  expect(evaluateRule({ ...options, rules: [nonNumeric], rule: nonNumeric.id }).ok).toBe(false);
  const annual = options.rules[0];
  if (!annual) throw new Error("rule");
  const threshold = rule("threshold", { input: annual.output, operator: "gte", value: 48000 });
  expect(
    evaluateRule({ ...options, rules: [annual, threshold], rule: threshold.id }),
  ).toMatchObject({ ok: true, statement: { value: true } });
  expect(() =>
    validateRules([rule("threshold", { input: "other", operator: "gt", value: 0 })]),
  ).toThrow("cycle");
  expect(statement.monthly).toHaveLength(12);
});
it("by-source requires the source itself and the receiver's accepted rule", async () => {
  const { options } = await fixture();
  const rules = [ruleSchema.parse({ ...baseRule, assurances: ["by-source"] })];
  expect(
    evaluateRule({ ...options, rules, assurance: "by-source", deriver: "urn:someone-else" }),
  ).toMatchObject({ ok: false, reason: "deriver-not-accepted" });
  const result = evaluateRule({ ...options, rules, assurance: "by-source" });
  if (!result.ok) throw new Error("derive");
  expect(
    verifyDerivation(result.statement, { ...options, rules, memory: new GateMemory() }).ok,
  ).toBe(true);
  expect(
    verifyDerivation({ ...result.statement, issuer: "urn:someone-else" }, { ...options, rules }),
  ).toMatchObject({ ok: false, reason: "deriver-not-accepted" });
});

it("the real inbound gate refuses a re-signed wrong derivation and does not admit its bytes as support", async () => {
  const { options, gate, key, memory } = await fixture();
  const result = evaluateRule(options);
  if (!result.ok) throw new Error("derive");
  expect(
    await gate.admitStatements(
      [{ jws: await signClaim(key, { ...result.statement, value: 99000 }) }],
      { subject, purpose, task, taskId: task },
    ),
  ).toEqual({ admitted: 0, refused: 1 });
  expect(memory.facts.has(String(result.statement.id))).toBe(false);
  const { derivation: _record, ...naked } = result.statement;
  expect(
    await gate.admitStatements([{ jws: await signClaim(key, naked) }], {
      subject,
      purpose,
      task,
      taskId: task,
    }),
  ).toEqual({ admitted: 0, refused: 1 });
  expect(
    await gate.admitStatements([{ jws: await signClaim(key, result.statement) }], {
      subject,
      purpose,
      task,
      taskId: task,
    }),
  ).toEqual({ admitted: 1, refused: 0 });
});

it("resolves a profile source alias without changing the rule digest and recomputes a chain at a later receiver time", async () => {
  const { options } = await fixture();
  const annual = ruleSchema.parse({ ...baseRule, inputsFrom: ["payroll"] });
  const threshold = ruleSchema.parse({
    id: "urn:rule:enough",
    template: "threshold",
    params: { input: annual.output, operator: "gte", value: 48000 },
    output: "enough",
    inputsFrom: ["payroll"],
  });
  const configured = {
    ...options,
    rules: [annual, threshold],
    sources: { payroll: source },
    rule: threshold.id,
  };
  const result = evaluateRule(configured);
  if (!result.ok) throw new Error("derive");
  expect(result.statement.value).toBe(true);
  expect(
    verifyDerivation(result.statement, { ...configured, at: "2026-11-13T09:05:00.000Z" }).ok,
  ).toBe(true);
  const d = result.statement.derivation as JsonObject;
  expect(
    verifyDerivation(
      {
        ...result.statement,
        derivation: { ...d, params: { input: "another", operator: "gte", value: 0 } },
      },
      configured,
    ),
  ).toMatchObject({ ok: false, reason: "derivation-not-verified" });
});

it("admits a signed by-source result without retaining its original inputs", async () => {
  const { options, gate, key, memory } = await fixture();
  options.rules.splice(0, 1, ruleSchema.parse({ ...baseRule, assurances: ["by-source"] }));
  const result = evaluateRule({ ...options, assurance: "by-source" });
  if (!result.ok) throw new Error("derive");
  memory.facts.clear();
  memory.contexts[task] = [];
  expect(
    await gate.admitStatements([{ jws: await signClaim(key, result.statement) }], {
      subject,
      purpose,
      task,
      taskId: task,
    }),
  ).toEqual({ admitted: 1, refused: 0 });
});

it("a source runtime uses its host-installed source key for by-source assurance", async () => {
  const { statement } = await fixture();
  const cast = new Cast(() => new Date(at));
  const p = await cast.add(
    { name: "payroll", party: source, actor: "urn:source:payroll:agent" },
    mandateOf("source", []),
    [],
  );
  cast.rule("payroll", {
    id: "urn:rule:own-records",
    version: "1",
    source,
    claimTypes: ["monthly-net-pay", "annual-income"],
    subjects: [subject],
  });
  const gates = {
    taskId: task,
    rules: [ruleSchema.parse({ ...baseRule, assurances: ["by-source"] })],
    reliance: {
      id: "urn:source:quality",
      rules: ["monthly-net-pay", "annual-income"].map((claimType) => ({
        id: `urn:quality:${claimType}`,
        claimType,
        methods: ["recorded-by-authority", "derived"],
        maxAgeDays: 30,
        text: "fictional source",
      })),
    },
  };
  const { runtime } = await cast.runtime("payroll", [], [], undefined, {
    gates,
    sourceKey: p.ownerKey,
  });
  await runtime.admitStatements([{ jws: await signClaim(p.ownerKey, statement) }], {
    task,
    taskId: task,
    subject,
    purpose,
  });
  const result = await runtime.derive({
    rule: baseRule.id,
    subject,
    purpose,
    assurance: "by-source",
  });
  expect(result).toMatchObject({
    ok: true,
    statement: { issuer: source, value: 48000, derivation: { assurance: "by-source" } },
  });
  if (!result.ok) throw new Error("derive");
  expect(
    await runtime.admitStatements([{ jws: result.jws }], { task, taskId: task, subject, purpose }),
  ).toEqual({ admitted: 1, refused: 0 });
  const { runtime: withoutKey } = await cast.runtime("payroll", [], [], undefined, { gates });
  expect(
    await withoutKey.derive({ rule: baseRule.id, subject, purpose, assurance: "by-source" }),
  ).toMatchObject({ ok: false, reason: "deriver-not-accepted" });
});

it("counts dated non-numeric records and sums a complete empty period as zero", async () => {
  const { options, statement, admit, memory } = await fixture();
  const period = { start: "2026-11-01", end: "2026-11-30" };
  const completeness = {
    id: "urn:complete:dated",
    issuer: source,
    subject,
    claimType: "complete",
    method: "recorded-by-authority",
    asOf: at,
    complete: true,
    forClaim: "monthly-net-pay",
    period,
  };
  const r = ruleSchema.parse({
    id: "urn:rule:count-dates",
    template: "count",
    params: { input: "monthly-net-pay", period, completeness: "complete" },
    output: "event-count",
    inputsFrom: [source],
  });
  memory.facts.clear();
  memory.contexts[task] = [];
  await admit([
    {
      ...statement,
      monthly: [
        { date: "2026-11-02", event: "work" },
        { date: "2026-11-20", event: "work" },
      ],
    },
    completeness,
  ]);
  expect(evaluateRule({ ...options, rules: [r], rule: r.id })).toMatchObject({
    ok: true,
    statement: { value: 2 },
  });
  memory.facts.clear();
  memory.contexts[task] = [];
  await admit([{ ...statement, monthly: [] }, completeness]);
  expect(evaluateRule({ ...options, rules: [r], rule: r.id })).toMatchObject({
    ok: true,
    statement: { value: 0 },
  });
  const sum = ruleSchema.parse({ ...r, template: "sum" });
  expect(evaluateRule({ ...options, rules: [sum], rule: sum.id })).toMatchObject({
    ok: true,
    statement: { value: 0 },
  });
});

it("by-source assurance cannot upgrade a disallowed input method", async () => {
  const { options, gate, key, memory } = await fixture();
  options.rules.splice(0, 1, ruleSchema.parse({ ...baseRule, assurances: ["by-source"] }));
  const result = evaluateRule({ ...options, assurance: "by-source" });
  if (!result.ok) throw new Error("derive");
  const d = result.statement.derivation as JsonObject;
  const inputs = (d.inputs as JsonObject[]).map((i) => ({ ...i, method: "reported-by-subject" }));
  const altered = {
    ...result.statement,
    derivation: { ...d, inputs, basis: ["reported-by-subject"] },
  };
  expect(
    await gate.admitStatements([{ jws: await signClaim(key, altered) }], {
      task,
      taskId: task,
      subject,
      purpose,
    }),
  ).toEqual({ admitted: 0, refused: 1 });
  expect(memory.facts.has(String(result.statement.id))).toBe(false);
});

it("carries the shortest input expiry so a source-derived claim cannot outlive it", async () => {
  const { options, memory, statement, admit } = await fixture();
  memory.facts.clear();
  memory.contexts[task] = [];
  await admit([{ ...statement, validUntil: "2026-11-13T09:01:00.000Z" }]);
  const rules = [ruleSchema.parse({ ...baseRule, assurances: ["by-source"] })];
  const result = evaluateRule({ ...options, rules, assurance: "by-source" });
  expect(result).toMatchObject({ ok: true, statement: { validUntil: "2026-11-13T09:01:00.000Z" } });
  if (!result.ok) throw new Error("derive");
  expect(
    verifyDerivation(
      { ...result.statement, validUntil: "2026-12-01T00:00:00.000Z" },
      { ...options, rules },
    ),
  ).toMatchObject({ ok: false, reason: "derivation-not-verified" });
});

it("inherited terms retain both recipient registration and additional output prohibitions", () => {
  const sourceTerms = {
    policy: {
      id: "urn:terms:input",
      permissions: [
        { type: "permission" as const, action: "distribute" as const, target: "urn:input" },
      ],
    },
    recipientMustBe: { task: "regulated-lender", label: "registered lender" },
  };
  const terms = {
    policy: { id: "urn:terms:output" },
    inherited: [{ target: "urn:input", terms: sourceTerms }],
  };
  const need = {
    agent: "urn:actor",
    action: "distribute" as const,
    target: "urn:output",
    recipient: "urn:recipient",
    purpose,
    at,
  };
  expect(evaluateItemTerms(terms, need)).toMatchObject({
    verdict: "fail",
    reason: "not-authorised",
  });
  expect(evaluateItemTerms(terms, { ...need, recipientAllowed: () => true }).verdict).toBe("pass");
  expect(
    evaluateItemTerms(
      {
        ...terms,
        policy: {
          ...terms.policy,
          prohibitions: [{ type: "prohibition", action: "distribute", target: "urn:output" }],
        },
      },
      { ...need, recipientAllowed: () => true },
    ),
  ).toMatchObject({ verdict: "fail", reason: "prohibited" });
});
