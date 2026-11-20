// AUTHORED-BY Codex GPT-6.2 Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync } from "fs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { patch, runScenario } from "../src/engine/run.js";
import type { Scenario } from "../src/engine/schema.js";
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
    // Use the run's existing evidence-complete witness so the scenario runner hands the
    // trace to the gate assertions below even when the supplier bar fails.
    branch.expect = { outcome: "go", check: "evidence", reason: "evidence-complete" };
    world.branches = [branch];
    scenario.branches = [];
    const [, failure] = await runScenario(profile, scenario, { configuration, compare: false });
    const events = failure!.trace!.events.filter((e) => e.addedBy === configuration);
    const disclosure = events.findLast(
      (e) => e.check === "disclosure" && e.agent === "sams-agent",
    )!;
    expect(disclosure).toMatchObject({ verdict: "pass" });
    held = events.filter((e) => e.agent === "sams-agent" && e.seq > disclosure.seq);
  }, 120_000);

  it("reaches the terms check and never asks approval to override a supplier's terms", () => {
    expect(held).toContainEqual(expect.objectContaining({ check: "data-terms" }));
    expect(held.some((e) => e.kind === "ask-principal")).toBe(false);
  });

  // The recipient check currently treats the valuer's own-list entry as proof of lender status.
  it.fails("stops a balance release to a valuer under the supplier's lender-only terms", () => {
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
