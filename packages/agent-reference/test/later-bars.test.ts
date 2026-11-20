// AUTHORED-BY Codex GPT-6.2 Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync } from "fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadSparqZkResult } from "../src/derive/adapters/sparq-zk-result.js";
import { verifierRegistry } from "../src/derive/verifiers.js";
import { loadCase } from "../src/engine/load.js";
import { patch, runScenario } from "../src/engine/run.js";
import type { Scenario } from "../src/engine/schema.js";
import { AgentRuntime } from "../src/runtime/agent.js";
import type { TraceEvent } from "../src/trace/types.js";

const root = new URL("..", import.meta.url).pathname;
const credit = "https://w3id.org/jeswr/awp#purpose/credit-assessment";

it("keeps the unsigned origin observation local even under a mandate that permits sharing", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const configuration = "authenticity-origin-hosted";
  const branch = scenario.branches.find((b) => b.id === "origin-record-forwarded")!;
  branch.change = patch(branch.change, {
    stopAfter: "origin-forward-proposed",
    mandates: {
      "sam-agent": {
        autonomous: {
          "urn:rule:test:origin-share": {
            type: "permission",
            action: "distribute",
            target: "https://w3id.org/jeswr/awp#op/evidence-disclosure",
            constraints: [
              {
                leftOperand: "purpose",
                operator: "eq",
                rightOperand: "https://w3id.org/jeswr/awp#purpose/product-search",
              },
              {
                leftOperand: "recipient",
                operator: "eq",
                rightOperand: "urn:fictional:bracken-lantern-valuations",
              },
            ],
          },
        },
      },
    },
  });
  branch.expect = { outcome: "stop", check: "evidence", reason: "evidence-invalid" };
  scenario.branches = [branch];
  const [, failure] = await runScenario(profile, scenario, { configuration, compare: false });
  const events = failure!.trace!.events;
  const stop = events.findLast((e) => e.kind === "decision")!;
  expect(stop).toMatchObject({ outcome: "stop", reason: "evidence-invalid" });
  const checks = events.filter(
    (e) =>
      e.agent === stop.agent &&
      e.part === stop.part &&
      e.gateRun === stop.gateRun &&
      e.kind === "check",
  );
  expect(checks).toEqual([
    expect.objectContaining({ check: "mandate", verdict: "pass" }),
    expect.objectContaining({ check: "evidence", verdict: "fail", reason: "evidence-invalid" }),
  ]);
  expect(events.slice(stop.seq).some((e) => e.kind === "message-out" || e.effectRelease)).toBe(
    false,
  );
}, 120_000);

describe("supplier terms after disclosure passes", () => {
  let held: TraceEvent[];
  beforeAll(async () => {
    const { profile, scenario } = loadCase(root, "mortgage-main");
    const configuration = "usage-control-human-approval";
    const entry = scenario.configurations.find((c) => c.id === configuration)!;
    const world = entry.world as { branches: Scenario["branches"] };
    const branch = world.branches.find((b) => b.id === "supplier-terms-hold")!;
    branch.change = patch(branch.change, {
      mandates: {
        "valuer-agent": {
          autonomous: {
            "urn:rule:use:balance-copy": {
              constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: credit }],
            },
          },
        },
      },
      script: { "balance-ask": { purpose: credit, intent: { purpose: credit } } },
    });
    entry.profileChange = patch(entry.profileChange, {
      operations: { "urn:op:balance-copy": { purposes: [credit] } },
    });
    branch.expect = { outcome: "stop", check: "data-terms", reason: "not-authorised" };
    world.branches = [branch];
    scenario.branches = [];
    const [, failure] = await runScenario(profile, scenario, { configuration, compare: false });
    const events = failure!.trace!.events;
    const disclosure = events.findLast(
      (e) =>
        e.check === "disclosure" &&
        e.agent === "sams-agent" &&
        e.actionScope?.operation === "urn:op:balance-copy",
    )!;
    expect(disclosure).toMatchObject({ verdict: "pass" });
    held = events.filter(
      (e) =>
        e.agent === disclosure.agent &&
        e.gateRun === disclosure.gateRun &&
        (e.part === "outbound-gate" || e.kind === "message-out") &&
        e.seq > disclosure.seq,
    );
  }, 120_000);

  it("reaches the terms check and never asks approval to override a supplier's terms", () => {
    expect(held).toContainEqual(expect.objectContaining({ check: "data-terms" }));
    expect(held.some((e) => e.kind === "ask-principal")).toBe(false);
  });

  it("stops a balance release to a valuer under the supplier's lender-only terms", () => {
    expect(held).toContainEqual(
      expect.objectContaining({
        check: "data-terms",
        verdict: "fail",
        reason: "not-authorised",
      }),
    );
    expect(held.find((e) => e.kind === "decision")).toMatchObject({
      outcome: "stop",
      reason: "not-authorised",
    });
    expect(held.some((e) => e.kind === "ask-principal" || e.kind === "message-out")).toBe(false);
  });
});

it("names the signed statements the borrower is being asked to share", async () => {
  const { profile, scenario } = loadCase(root, "hardship-request");
  const paths = await runScenario(profile, scenario, { compare: false });
  const oracle = JSON.parse(
    readFileSync(new URL("./oracle/pre-rdf.json", import.meta.url), "utf8"),
  );
  for (const [index, kind] of ["unstructured-content", "health.diagnosis"].entries()) {
    const path = paths[index]!;
    const events = path.trace!.events;
    const approval = events.find((e) => e.kind === "ask-principal" && e.agent === "owner-agent");
    expect(approval?.chat?.text).toContain("asks for one of your statements");
    expect(approval?.chat?.text).toContain(kind);
    const label = events.find((e) => e.fact?.claimType === kind)?.fact?.label;
    expect(label).toBeTruthy();
    expect(approval?.chat?.text).toContain(label);
    const key = `hardship-request/${path.path}`;
    expect(
      events.map(({ agent, part, kind, check, verdict, reason, outcome }) => ({
        agent,
        part,
        kind,
        check,
        verdict,
        reason,
        outcome,
      })),
    ).toEqual(oracle[key]);
  }
});

it("holds the insurer's proposed decision based on a photo reading", async () => {
  const { profile, scenario } = loadCase(root, "insurance-claim-photos");
  const branch = scenario.branches.find((b) => b.id === "branch-1")!;
  const change = branch.change as Pick<Scenario, "script" | "stopAfter">;
  // Lift both sides of submission coverage in this copy. Keep the decision's coverage.
  branch.profileChange = {
    actionClaims: profile.actionClaims!.filter(
      (rule) => rule.action !== "urn:op:insurance-claim-photos",
    ),
  };
  const tail = structuredClone(
    scenario.script.slice(scenario.script.findIndex((step) => step.id === "approve-exact-account")),
  );
  const read = tail.find((step) => step.id === "read-photo")!;
  const decision = tail.find((step) => step.id === "human-decision")!;
  if (read.type !== "read-content" || decision.type !== "effect")
    throw new Error("Missing insurance decision fixture");
  read.output["damage.severity"] = "minor";
  decision.intent = patch(decision.intent, {
    parameters: {
      support: [{ ["$ref"]: "steps.read-photo.readings.0.statement.id" }],
    },
  });
  change.script.push(...tail);
  change.stopAfter = decision.id;
  const [, path] = await runScenario(
    profile,
    { ...scenario, branches: [branch] },
    { compare: false, reportExpectationFailures: true },
  );
  const events = path!.trace!.events;
  const hold = events.findLast((e) => e.kind === "decision")!;
  expect(hold).toMatchObject({
    agent: "receiver-agent",
    part: "outbound-gate",
    outcome: "ask-more",
    reason: "structured-form-required",
  });
  expect(events).toContainEqual(
    expect.objectContaining({
      agent: hold.agent,
      gateRun: hold.gateRun,
      part: hold.part,
      check: "fitness",
      verdict: "ask-more",
      reason: hold.reason,
    }),
  );
  expect(events.some((e) => e.agent === hold.agent && e.effectRelease)).toBe(false);
}, 120_000);

it("asks the hiring principal even when rejection cites only the original reference", async () => {
  const { profile, scenario } = loadCase(root, "employment-reference");
  const branch = scenario.branches.find((b) => b.id === "branch-1")!;
  const change = branch.change as Pick<Scenario, "script">;
  const reject = change.script.at(-1)!;
  if (reject.type !== "effect") throw new Error("Missing rejection fixture");
  const original = scenario.script.at(-1)!;
  if (original.type !== "effect") throw new Error("Missing reference fixture");
  const reference = original.intent as {
    parameters: { support: string[]; originalDigest: string };
  };
  reject.intent = patch(reject.intent, { parameters: { support: reference.parameters.support } });
  change.script.push({
    id: "decline-rejection",
    type: "approve",
    agent: reject.agent,
    decision: "deny",
    note: "I do not approve this rejection.",
    evidence: [],
  });
  branch.expect = {
    outcome: "ask-principal",
    check: "limits-approval",
    reason: "approval-required",
  };
  const [, path] = await runScenario(
    profile,
    { ...scenario, branches: [branch] },
    { compare: false },
  );
  const events = path!.trace!.events;
  const ask = events.find((e) => e.agent === reject.agent && e.kind === "ask-principal")!;
  expect(ask.chat?.text).toContain("reject-candidate");
  expect(ask.chat?.text).toContain(reference.parameters.originalDigest);
  const denial = events.find(
    (e) => e.seq > ask.seq && e.kind === "decision" && e.outcome === "stop",
  )!;
  expect(denial).toMatchObject({ agent: reject.agent, reason: "approval-denied" });
  expect(events.some((e) => e.seq > ask.seq && (e.kind === "message-out" || e.effectRelease))).toBe(
    false,
  );
}, 120_000);

const resultAdapter = await loadSparqZkResult();
it.skipIf(!resultAdapter)(
  "withholds an attested right-to-work fact when the receiver requests proved",
  async () => {
    const { profile, scenario } = loadCase(root, "right-to-work");
    const branch = scenario.branches.find((b) => b.id === "hidden-validity-proof")!;
    const change = branch.change as Pick<Scenario, "script" | "stopAfter">;
    const request = change.script.find((step) => step.type === "proof-request")!;
    if (request.type !== "proof-request") throw new Error("Missing proof request fixture");
    request.assurances = ["proved"];
    change.stopAfter = "receive-answer";
    const issue = AgentRuntime.prototype.issueDerivationRequest;
    const fixture = vi
      .spyOn(AgentRuntime.prototype, "issueDerivationRequest")
      .mockImplementation(function (this: AgentRuntime, input) {
        const registered = issue.call(this, input);
        // Offer an attested proof for the same nonce through the ordinary inbound gate.
        return { ...registered, assurances: ["attested"] };
      });
    try {
      const [, path] = await runScenario(
        profile,
        { ...scenario, branches: [branch] },
        {
          compare: false,
          registry: verifierRegistry([resultAdapter!]),
          reportExpectationFailures: true,
        },
      );
      const events = path!.trace!.events;
      const receiver = events.filter((e) => e.agent === "employer-agent");
      expect(
        receiver.some((e) => e.kind === "store" && e.fact?.claimType === "right-to-work.answer"),
      ).toBe(false);
      expect(receiver).toContainEqual(
        expect.objectContaining({
          part: "inbound-gate",
          kind: "check",
          check: "source",
          verdict: "fail",
          reason: "assurance-insufficient",
          rule: expect.objectContaining({ id: "DER-16" }),
        }),
      );
      expect(receiver).toContainEqual(
        expect.objectContaining({
          part: "inbound-gate",
          kind: "check",
          check: "fitness",
          verdict: "ask-more",
          reason: "evidence-missing",
        }),
      );
      expect(
        receiver.findLast((e) => e.part === "inbound-gate" && e.kind === "decision"),
      ).toMatchObject({ outcome: "ask-more", reason: "evidence-missing" });
      expect(fixture).toHaveBeenCalledWith(expect.objectContaining({ assurances: ["proved"] }));
    } finally {
      fixture.mockRestore();
    }
  },
  180_000,
);
