// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.2 Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import type { ActionIntent, JsonObject } from "../src/core/types.js";
import { queryFor } from "../src/derive/rules.js";
import { type DerivedRequest, verifierRegistry } from "../src/derive/verifiers.js";
import { loadCase as loadActualCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { signStatement, TYP } from "../src/mechanisms/statements.js";
import { Cast, mandateOf, permit } from "../src/scenarios/common.js";
import { outlineOf, type TraceEvent } from "../src/trace/types.js";
import { ToyJointProtocol } from "./doubles/joint.js";
import { ToyProofSystem } from "./doubles/proof.js";

const root = join(import.meta.dirname, "..");
// These tests deliberately exercise the earlier toy relation and its queries.
function loadCase(directory: string, id: string) {
  const loaded = loadActualCase(directory, id);
  if (["insurance-quote", "trial-eligibility", "recycled-content"].includes(id)) {
    for (const rule of loaded.profile.rules) if ("proofQuery" in rule) delete rule.proofQuery;
    loaded.scenario.blocked = [];
    loaded.scenario.requiredMethods = ["sparq-zk-query/1"];
  }
  if (
    [
      "degree-recognition",
      "introduction",
      "visa-application",
      "tenancy-application",
      "age-check",
      "right-to-work",
    ].includes(id)
  ) {
    for (const rule of loaded.profile.rules) if ("proofQuery" in rule) delete rule.proofQuery;
    if (id === "right-to-work") {
      const branch = loaded.scenario.branches.find((b) => b.id === "hidden-validity-proof");
      if (branch) {
        branch.change.blocked = [];
        branch.change.requiredMethods = ["sparq-zk-result/5"];
      }
    } else {
      loaded.scenario.blocked = [];
      loaded.scenario.requiredMethods = ["sparq-zk-result/5"];
    }
  }
  return loaded;
}
const doubles = () =>
  verifierRegistry([
    new ToyProofSystem(),
    new ToyProofSystem("sparq-zk-query/1", ["rule", "issuers", "fresh", "complete"]),
    new ToyJointProtocol(),
  ]);

/**
 * These unpublishable toy fixtures retain their pre-coverage outlines. Compare every
 * original check in order, while testing the added CORE-IN-21 passes separately. An
 * ask-more/failure is never normalized away; the real canonical oracle stays exact.
 */
function beforeCoverage(events: readonly TraceEvent[]) {
  const legacy: TraceEvent[] = [];
  const fitness = new Set<string>();
  for (const event of events) {
    if (event.kind === "message-in") fitness.delete(event.agent);
    if (event.rule?.id === "CORE-IN-21" && event.verdict === "pass") {
      expect(event).toMatchObject({ check: "fitness", reason: "fit-for-use" });
      if (!fitness.has(event.agent))
        legacy.push({ ...event, verdict: "not-applicable", reason: "no-claims" });
      continue;
    }
    if (event.part === "inbound-gate" && event.check === "fitness") fitness.add(event.agent);
    legacy.push(event);
  }
  return outlineOf({ events: legacy });
}
it.each([
  "degree-recognition",
  "introduction",
  "visa-application",
  "tenancy-application",
  "age-check",
  "insurance-quote",
  "trial-eligibility",
  "recycled-content",
  "right-to-work",
])("exercises %s through the real runtime and gates with an explicitly test-only verifier", async (id) => {
  const { profile, scenario } = loadCase(root, id);
  const paths = await runScenario(profile, scenario, {
    registry: doubles(),
    testOnly: true,
    compare: false,
    generateProofs: true,
  });
  for (const result of paths) {
    if (!result.trace) continue;
    // The five real executions record extra issuer/status admission checks. Compare
    // ordinary outlines here and exercise the double's verification checks below.
    if (
      result.usedTestDouble &&
      [
        "age-check",
        "introduction",
        "right-to-work",
        "tenancy-application",
        "visa-application",
      ].includes(id)
    )
      continue;
    const expected =
      result.path === "main"
        ? scenario.expect
        : scenario.branches.find((b) => b.id === result.path)!.outline;
    expect(beforeCoverage(result.trace.events), `${id}/${result.path}`).toEqual(expected);
  }
  const path = paths.find(
    (p) => p.path === (id === "right-to-work" ? "hidden-validity-proof" : "main"),
  );
  expect(path?.blocked).toBeUndefined();
  expect(path?.usedTestDouble).toBe(true);
  expect(
    path?.trace?.events.some((event) => event.rule?.id === "DER-17" && event.verdict === "pass"),
  ).toBe(true);
  if (id !== "insurance-quote")
    expect(
      path?.trace?.events.some((e) => e.rule?.id === "CORE-IN-21" && e.verdict === "pass"),
    ).toBe(true);
  expect(
    path?.trace?.events.some(
      (e) => e.rule?.id === "DER-18" && e.verdict === (id === "insurance-quote" ? "fail" : "pass"),
    ),
  ).toBe(true);
});

it.each([
  "cohort-count",
  "platform-income",
  "salary-benchmark",
])("exercises every %s joint path through separately gated participants", async (id) => {
  const { profile, scenario } = loadCase(root, id);
  const paths = await runScenario(profile, scenario, {
    registry: doubles(),
    testOnly: true,
    compare: false,
  });
  if (id === "salary-benchmark") {
    const branch = required(paths.find((path) => path.path === "branch-1"));
    expect(branch.blocked).toBeUndefined();
    expect(branch.trace?.events).toContainEqual(
      expect.objectContaining({
        part: "outbound-gate",
        check: "data-terms",
        verdict: "fail",
        reason: "prohibited",
      }),
    );
    expect(branch.actual).toMatchObject({ outcome: "stop", reason: "prohibited" });
    expect(branch.disagrees).toBe(false);
    expect(branch.expected).toMatchObject({ outcome: "stop", reason: "prohibited" });
    expect(
      branch.trace?.events.some(
        (event) =>
          event.kind === "message-out" &&
          event.messageId === "urn:awp:engine-salary-benchmark-branch-1:computer-agent:0013",
      ),
    ).toBe(false);
  }
  for (const path of paths.filter((p) => p.usedTestDouble)) {
    expect(path.blocked).toBeUndefined();
    expect(path.trace).toBeDefined();
    if (path.path === "main")
      expect(path.trace?.events.some((e) => e.rule?.id === "DER-14" && e.verdict === "pass")).toBe(
        true,
      );
    else if (id !== "salary-benchmark")
      expect(path.actual).toMatchObject({
        outcome: "stop",
        reason:
          id === "cohort-count" && path.path === "branch-2"
            ? "derivation-not-verified"
            : "prohibited",
      });
  }
}, 300_000);
it("the engine and publication entry point refuse test-double artifacts, while absent packages remain blocked", async () => {
  const { assertPublishable } = await import("../src/engine/publication.js");
  const { profile, scenario } = loadCase(root, "age-check");
  await expect(
    runScenario(profile, scenario, { registry: doubles(), compare: false }),
  ).rejects.toThrow("test-double");
  const paths = await runScenario(profile, scenario, {
    registry: doubles(),
    testOnly: true,
    compare: false,
  });
  expect(() => assertPublishable(required(paths[0]))).toThrow("Refusing to write");
  const missing = await runScenario(profile, scenario, { registry: verifierRegistry() });
  expect(missing[0]?.blocked).toBe(
    "needs a proof system: needs the sparq-zk-result/5 package, which is not installed",
  );
  expect(missing[0]?.trace).toBeUndefined();
});
it("repeats the same seeded nonce and proof request across independent runs", async () => {
  const { profile, scenario } = loadCase(root, "age-check");
  scenario.branches = [];
  const run = () =>
    runScenario(profile, scenario, { registry: doubles(), testOnly: true, compare: false });
  const first = required((await run())[0]),
    second = required((await run())[0]);
  expect(first.trace?.events).toEqual(second.trace?.events);
});

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("Required test fixture is missing");
  return value;
}

it("requires runtime-authored proof bytes for the current task and admitted request", async () => {
  const { profile } = loadCase(root, "age-check");
  const rule = required(profile.rules.find((rule) => "template" in rule));
  const operation = "urn:op:age-check:proof-answer";
  const purpose = "urn:purpose:age-check";
  const task = "urn:test:proof-task";
  const now = () => new Date("2026-11-13T09:00:00.000Z");
  const cast = new Cast(now);
  const holder = await cast.add(
    { name: "holder", actor: "urn:test:holder-agent", party: "urn:test:holder" },
    mandateOf("holder", [permit("distribute", operation, [purpose])]),
    [operation],
  );
  const receiver = await cast.add(
    { name: "receiver", actor: "urn:test:receiver-agent", party: "urn:test:receiver" },
    mandateOf("receiver", []),
    [],
  );
  cast.introduce("holder", "receiver");
  for (const [party, claimType] of [
    [holder.identity.party, "identity.birth-date"],
    [receiver.identity.party, "derivation.request"],
  ] as const)
    cast.rule("holder", {
      id: `urn:test:authority:${claimType}`,
      version: "1",
      source: party,
      subjects: [party],
      claimTypes: [claimType],
    });
  const system = new ToyProofSystem();
  const keys = await system.issuerKeygen(new Uint8Array([1]));
  const birth = {
    id: "urn:test:birth",
    claimType: "identity.birth-date",
    issuer: holder.identity.party,
    subject: holder.identity.party,
    method: "recorded-by-authority",
    value: "1990-01-01",
    asOf: now().toISOString(),
    terms: {
      policy: {
        id: "urn:test:birth-terms",
        permissions: [
          { type: "permission", action: "use", target: "urn:test:birth" },
          { type: "permission", action: "distribute", target: "urn:test:birth" },
        ],
      },
    },
  };
  const credential = await system.issue({
    issuerKey: keys.secretKey,
    subject: birth.subject,
    claims: { statements: [birth] },
  });
  const { runtime } = await cast.runtime("holder", [], [], undefined, {
    sourceKey: holder.ownerKey,
    gates: {
      ...verifierRegistry([system]),
      rules: [rule],
      proofCredentials: [{ statement: birth.id, digest: digestOf(birth), credential }],
      actionClaims: [{ action: operation, claims: [rule.output] }],
      reliance: {
        id: "urn:test:reliance",
        rules: profile.claims.map(({ kind, methods, maxAgeDays }) => ({
          id: `urn:test:reliance:${kind}`,
          claimType: kind,
          methods,
          maxAgeDays,
          text: kind,
        })),
      },
    },
  });
  const request: DerivedRequest = {
    nonce: "urn:test:proof-request:1",
    rule: rule.id,
    ruleDigest: digestOf(rule),
    subject: birth.subject,
    purpose,
    assurances: ["attested"],
    query: queryFor(rule),
    policy: {},
    consumed: false,
  };
  const admitRequest = async (value: DerivedRequest, scope: string) => {
    const jws = await signStatement(receiver.ownerKey, TYP.statement, {
      ...birth,
      id: value.nonce,
      claimType: "derivation.request",
      issuer: receiver.identity.party,
      subject: receiver.identity.party,
      value,
      terms: undefined,
    });
    expect(
      await runtime.admitStatements([{ jws }], { task: scope, taskId: scope, purpose }),
    ).toEqual({
      admitted: 1,
      refused: 0,
    });
  };
  const birthJws = await signStatement(holder.ownerKey, TYP.statement, birth);
  expect(
    await runtime.admitStatements([{ jws: birthJws }], { task, taskId: task, purpose }),
  ).toEqual({
    admitted: 1,
    refused: 0,
  });
  await admitRequest(request, task);
  const result = await runtime.proveDerived({
    request,
    recipient: receiver.identity.party,
    method: system.method,
    assurance: "attested",
    proofBinds: system.binds,
    inputs: [birth.id],
  });
  if (!result.ok) throw Error(result.reason);
  const intent: ActionIntent = {
    action: "distribute",
    operation,
    target: operation,
    purpose,
    recipient: receiver.identity.party,
    conversation: task,
    parameters: {},
  };
  const authorise = (value: string, conversation = task) =>
    // biome-ignore lint/complexity/useLiteralKeys: run the actual early outbound evidence check
    runtime["authorise"]({ ...intent, conversation }, false, [
      { value, role: "credential", format: "derivation+jws" },
    ]);
  expect(authorise(result.jws).outcome).toBe("permit");
  expect.soft(authorise(result.jws, "urn:test:other-task")).toMatchObject({
    outcome: "deny",
    reason: "evidence-missing",
  });

  const statement: JsonObject = { ...result.statement, id: "urn:test:unverified-proof" };
  const jws = await signStatement(holder.ownerKey, TYP.statement, statement);
  runtime.recordObservation({
    type: "proof-derivation",
    observedBy: "urn:test:observer",
    producer: "outbound-gate",
    statement,
    proofDigest: digestOf(jws),
    recipient: receiver.identity.party,
    purpose,
  });
  expect.soft(authorise(jws)).toMatchObject({ outcome: "deny", reason: "evidence-missing" });
  await admitRequest({ ...request, nonce: "urn:test:proof-request:2" }, task);
  expect(authorise(result.jws)).toMatchObject({ outcome: "deny", reason: "evidence-missing" });
});
it("holds raw inputs when the actual received request and installed profile allow a narrower proof", async () => {
  const { profile, scenario } = loadCase(root, "visa-application");
  scenario.branches = [];
  scenario.expect = [];
  const end = scenario.script.findIndex((s) => s.id === "receive-request");
  scenario.script = scenario.script.slice(0, end + 1);
  scenario.script.push({
    id: "raw-instead-of-proof",
    agent: "owner-agent",
    type: "start",
    peer: "receiver-agent",
    kind: "invoke",
    operation: "urn:op:visa-application:proof-answer",
    contents: { items: ["urn:scenario:visa-application:proof-funds"] },
    intent: {
      action: "distribute",
      operation: "urn:op:visa-application:proof-answer",
      target: "urn:op:visa-application:proof-answer",
      recipient: "urn:fictional:visa-application:receiver",
      purpose: "urn:purpose:visa-application",
      parameters: {},
    },
    purpose: "urn:purpose:visa-application",
    discover: false,
    evidence: ["proof-funds"],
    derivedEvidence: [],
    content: [],
  });
  const path = required(
    (
      await runScenario(profile, scenario, { registry: doubles(), testOnly: true, compare: false })
    )[0],
  );
  expect(path.actual).toMatchObject({
    outcome: "stop",
    reason: "excessive-scope",
    check: "disclosure",
  });
  expect(path.trace?.events.some((e) => e.rule?.id === "DER-21" && e.verdict === "fail")).toBe(
    true,
  );
});
it.each([
  ["visa-application", "proof-funds", 5000],
  ["age-check", "birth", "2020-01-01"],
  ["trial-eligibility", "complete-medication-snapshot", ["excluded-x"]],
  ["recycled-content", "audited-tier-2", 0.2],
] as const)("derives a negative %s answer from the actual changed source data", async (id, input, value) => {
  const { profile, scenario } = loadCase(root, id);
  scenario.branches = [];
  scenario.expect = [];
  required(scenario.statements.find((s) => s.id === input)).value.value = JSON.parse(
    JSON.stringify(value),
  );
  const check = required(scenario.script.find((s) => s.id === "check-answer"));
  if (check.type !== "assert") throw new Error("Missing answer assertion");
  check.expected = false;
  const path = required(
    (
      await runScenario(profile, scenario, {
        registry: doubles(),
        testOnly: true,
        compare: false,
        generateProofs: true,
      })
    )[0],
  );
  expect(path.trace?.events.some((e) => e.rule?.id === "DER-18" && e.verdict === "pass")).toBe(
    true,
  );
});
it("rechecks an outcome at the sender boundary and withholds a core-substituted numeric release", async () => {
  const { profile, scenario } = loadCase(root, "cohort-count");
  scenario.branches = [];
  scenario.expect = [];
  const index = scenario.script.findIndex(
    (s) => s.type === "joint-send" && s.operation === "outcome",
  );
  scenario.script = scenario.script.slice(0, index + 1);
  const send = required(scenario.script.at(-1));
  if (send.type !== "joint-send") throw new Error("Missing outcome step");
  send.derivedEvidence = [];
  send.payload.outcome = { type: "release", count: 999, evidence: {} };
  const path = required(
    (
      await runScenario(profile, scenario, { registry: doubles(), testOnly: true, compare: false })
    )[0],
  );
  expect(path.actual).toMatchObject({
    outcome: "stop",
    reason: "derivation-not-verified",
    check: "evidence",
  });
  const stop = required(
    path.trace?.events.findLast((e) => e.agent === "computer-agent" && e.outcome === "stop"),
  );
  expect(
    path.trace?.events.some(
      (e) => e.agent === "computer-agent" && e.seq > stop.seq && e.kind === "message-out",
    ),
  ).toBe(false);
});
