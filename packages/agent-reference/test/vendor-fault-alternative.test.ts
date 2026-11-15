// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// Brief 32 tests 1, 2 and 6: the vendor-fault suite's three paths.
import { describe, expect, it } from "vitest";
import {
  addedSegmentDifferences,
  confinementDifferences,
  patchDifferences,
} from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import type { Scenario } from "../src/engine/schema.js";
import type { TraceFile } from "../src/trace/types.js";

const root = new URL("..", import.meta.url).pathname;
const vendor = "accountability-vendor-fault";
const standIn = (trace: TraceFile) =>
  trace.events.filter((event) => /^Stand-in, this branch only: a faulty gate/.test(event.caption));

describe("accountability-vendor-fault", () => {
  it("runs the main path, the gate-fault branch and the principal's-fault branch", async () => {
    const { profile, scenario } = loadCase(root, "mortgage-main");
    const baseline = (await runScenario(profile, { ...scenario, branches: [] }))[0]!.trace!;
    const entry = scenario.configurations.find((c) => c.id === vendor)!;
    const paths = await runScenario(profile, scenario, { configuration: vendor });
    expect(paths.map((path) => path.path)).toEqual([
      "main",
      "gate-released-outside-mandate",
      "fault-was-the-principals",
    ]);
    for (const path of paths) expect(path.blocked).toBeUndefined();

    // Test 1: main — no stand-in, every audit check passes, no claim is sent.
    const main = paths[0]!.trace!;
    expect(patchDifferences(scenario, entry)).toEqual([]);
    expect(confinementDifferences(baseline, main, "accountability")).toEqual([]);
    expect(addedSegmentDifferences(main, entry, scenario.parties)).toEqual([]);
    expect(standIn(main)).toEqual([]);
    expect(main.standIns?.some((s) => s.what.startsWith("Gate fault"))).toBe(false);
    const audit = main.events.filter((e) => e.part === "record" && e.check === "evidence");
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.every((e) => e.verdict === "pass" && e.reason === "within-mandate")).toBe(true);
    expect(main.events.findLast((e) => e.part === "record" && e.kind === "decision")).toMatchObject(
      { outcome: "go" },
    );
    expect(main.events.some((e) => e.agent === "gate-operator-agent")).toBe(false);

    // Test 2: the fault branch.
    const fault = paths[1]!.trace!;
    const marks = standIn(fault);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ part: "outbound-gate", kind: "record" });
    expect(marks[0]?.check ?? marks[0]?.verdict ?? marks[0]?.outcome).toBeUndefined();
    const at = fault.events.indexOf(marks[0]!);
    // The real outbound gate records no pass or go for the stand-in's action.
    const next = fault.events.slice(at + 1, at + 3);
    expect(next.some((e) => e.part === "outbound-gate")).toBe(false);
    expect(fault.standIns?.some((s) => s.what.startsWith("Gate fault"))).toBe(true);
    const outside = fault.events.filter(
      (e) => e.part === "record" && e.check === "evidence" && e.verdict === "fail",
    );
    expect(outside).toHaveLength(1);
    expect(outside[0]?.reason).toBe("not-authorised");
    const operatorChecks = fault.events.filter(
      (e) => e.agent === "gate-operator-agent" && e.part === "inbound-gate" && e.kind === "check",
    );
    expect(new Set(operatorChecks.map((e) => e.check))).toEqual(
      new Set(["integrity", "source", "authority", "terms", "fitness"]),
    );
    expect(operatorChecks.every((e) => e.verdict === "pass")).toBe(true);
    expect(fault.events.findLast((e) => e.kind === "decision")).toMatchObject({
      agent: "sams-agent",
      part: "inbound-gate",
    });

    // Test 6 (no finding): the principal's own claim stops at evidence.
    const principal = paths[2]!.trace!;
    expect(standIn(principal)).toEqual([]);
    expect(principal.events.findLast((e) => e.kind === "decision")).toMatchObject({
      part: "outbound-gate",
      reason: "evidence-invalid",
    });
    expect(principal.events.some((e) => e.agent === "gate-operator-agent")).toBe(false);
  }, 600_000);

  it("stops a record-backed claim for another digest or to a recipient the component statement does not name", async () => {
    for (const variant of ["other-digest", "other-operator"] as const) {
      const { profile, scenario } = loadCase(root, "mortgage-main");
      const entry = scenario.configurations.find((c) => c.id === vendor)!;
      const world = entry.world as {
        branches: Scenario["branches"];
        statements: Record<string, { value: { gate: { operatedBy: string } } }>;
      };
      const branch = world.branches.find((b) => b.id === "gate-released-outside-mandate")!;
      const script = (branch.change as { script: { id: string; value?: { action?: unknown } }[] })
        .script;
      if (variant === "other-digest") {
        const claim = script.find((step) => step.id === "fault-claim-statement")!;
        // The first judged release, which the audit found inside the mandate.
        claim.value!.action = JSON.parse('{"$ref":"steps.audit-record.released.0.actionDigest"}');
      } else
        world.statements["sam-agent-components"]!.value.gate.operatedBy =
          "urn:fictional:another-gate-operator";
      world.branches = [
        {
          ...branch,
          change: { ...branch.change, stopAfter: "fault-claim-approved" },
          expect: { outcome: "stop", check: "evidence", reason: "evidence-invalid" },
        },
      ] as Scenario["branches"];
      scenario.branches = scenario.branches.filter((b) => b.onlyUnder !== vendor);
      const [, path] = await runScenario(profile, scenario, {
        configuration: vendor,
        compare: false,
      });
      const trace = path!.trace!;
      expect(
        trace.events.some((e) => e.agent === "gate-operator-agent"),
        variant,
      ).toBe(false);
      expect(
        trace.events.findLast((e) => e.kind === "decision"),
        variant,
      ).toMatchObject({
        part: "outbound-gate",
        reason: "evidence-invalid",
      });
    }
  }, 600_000);
});
