// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { patch, runScenario } from "../src/engine/run.js";

const root = join(import.meta.dirname, "..");
it("keeps each original issuer's signature and standing behind the holder envelope", async () => {
  const { profile, scenario } = loadCase(root, "records-to-new-practice");
  const paths = await runScenario(profile, scenario);
  const events = required(required(paths[0]).trace).events;
  for (const source of [
    "The patient",
    "The clinician",
    "The old practice holding original statements",
  ])
    expect(
      events.some(
        (e) => e.check === "source" && e.caption.startsWith(source) && e.verdict === "pass",
      ),
    ).toBe(true);
  expect(paths[1]?.disagrees).toBe(true);
  expect(paths[1]?.note).toBe("branch does not diverge from the main path");
  expect(
    paths[1]?.trace?.events.some(
      (e) => e.reason === "superseded-by-better-source" && e.verdict === "pass",
    ),
  ).toBe(true);
});
it("rejects a holder that changes an original even after updating and signing its own envelope", async () => {
  const { profile, scenario } = loadCase(root, "records-to-new-practice");
  scenario.branches = [];
  scenario.script = scenario.script.slice(0, 1);
  scenario.expect = [];
  scenario.stress = ["integrity"];
  const step = scenario.script[0];
  if (step?.type !== "read-reference") throw Error("fixture");
  step.alterOriginal = true;
  const [path] = await runScenario(profile, scenario, { compare: false });
  expect(path?.actual).toMatchObject({ outcome: "refuse", reason: "evidence-invalid" });
  expect(
    path?.trace?.events.some((e) => e.kind === "store" && e.fact?.claimType === "health.allergy"),
  ).toBe(false);
});
it("honours source and freshness order, asks with both identifiers when no order exists, and separates periods", async () => {
  for (const order of ["source-first", "newer-first", "unordered", "different-period"]) {
    const { profile, scenario } = loadCase(root, "records-to-new-practice");
    const world = patch(scenario, required(scenario.branches[0]).change);
    world.branches = [];
    world.expect = [];
    world.script = world.script.slice(0, 2);
    const rule = required(profile.claims[0]);
    if (!rule.precedence) throw Error("fixture");
    required(world.statements[1]).asOf = "2026-11-13T08:59:00.000Z";
    if (order === "newer-first") rule.precedence.freshness = "newer-first";
    if (order === "unordered") rule.precedence.sources = [];
    if (order === "different-period") {
      required(world.statements[0]).value.period = { start: "2026-09-01", end: "2026-09-30" };
      required(world.statements[1]).value.period = { start: "2026-10-01", end: "2026-10-31" };
    }
    const [path] = await runScenario(profile, world, { compare: false });
    const events = path?.trace?.events ?? [];
    if (order === "unordered") {
      const request = events.find((e) => e.reason === "completeness-not-established");
      expect(request?.caption).toContain("The patient's health allergy statement");
      expect(request?.caption).toContain("The clinician's health allergy statement");
      expect(request?.refs?.map((ref) => ref.id)).toEqual(
        expect.arrayContaining([
          "urn:scenario:records-to-new-practice:patient-note",
          "urn:scenario:records-to-new-practice:clinical",
        ]),
      );
      expect(events.some((e) => e.outcome === "ask-more")).toBe(true);
    } else if (order === "different-period")
      expect(events.some((e) => e.reason === "superseded-by-better-source")).toBe(false);
    else {
      const selected = events.find((e) => e.reason === "superseded-by-better-source");
      expect(selected?.caption).toContain(
        order === "source-first"
          ? "The patient's health allergy statement is retained but superseded by The clinician's health allergy statement"
          : "The clinician's health allergy statement is retained but superseded by The patient's health allergy statement",
      );
      expect(selected?.refs?.map((ref) => ref.id)).toEqual(
        expect.arrayContaining([
          "urn:scenario:records-to-new-practice:patient-note",
          "urn:scenario:records-to-new-practice:clinical",
        ]),
      );
    }
  }
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing test fixture");
  return value;
}
