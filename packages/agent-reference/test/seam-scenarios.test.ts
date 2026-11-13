// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { verifierRegistry } from "../src/derive/verifiers.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { ToyJointProtocol } from "./doubles/joint.js";
import { ToyProofSystem } from "./doubles/proof.js";

const root = join(import.meta.dirname, "..");
const doubles = () =>
  verifierRegistry([
    new ToyProofSystem(),
    new ToyProofSystem("sparq-authrdf/1", ["rule", "issuers", "fresh", "complete"]),
    new ToyJointProtocol(),
  ]);
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
    compare: true,
    generateProofs: true,
  });
  const path = paths.find(
    (p) => p.path === (id === "right-to-work" ? "hidden-validity-proof" : "main"),
  );
  expect(path?.blocked).toBeUndefined();
  expect(path?.usedTestDouble).toBe(true);
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
    compare: true,
  });
  for (const path of paths.filter((p) => p.usedTestDouble)) {
    expect(path.blocked).toBeUndefined();
    expect(path.trace).toBeDefined();
    if (path.path === "main")
      expect(path.trace?.events.some((e) => e.rule?.id === "DER-14" && e.verdict === "pass")).toBe(
        true,
      );
    else
      expect(path.actual).toMatchObject({
        outcome: "stop",
        reason:
          id === "cohort-count" && path.path === "branch-2"
            ? "derivation-not-verified"
            : "prohibited",
      });
  }
});
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
