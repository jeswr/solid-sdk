// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { patch, runScenario } from "../src/engine/run.js";

const root = join(import.meta.dirname, "..");

it("rejects unsigned payroll mail and signed requests without employee representation before any update", async () => {
  const { profile, scenario } = loadCase(root, "salary-account-change");
  const paths = await runScenario(profile, scenario);
  for (const [index, reason] of ["unsigned-not-allowed", "representation-missing"].entries()) {
    const path = paths[index + 1];
    expect(
      path?.trace?.events.some(
        (e) => e.agent === "receiver-agent" && e.outcome === "refuse" && e.reason === reason,
      ),
    ).toBe(true);
    expect(path?.actual).toMatchObject({ outcome: "stop", reason: "evidence-invalid" });
    expect(path?.disagrees).toBe(true);
  }
});

it("admits a permitted low-stakes reading through real gates and binds bounded booking amounts", async () => {
  for (const attack of [
    "none",
    "over",
    "missing",
    "string",
    "negative",
    "precision",
    "currency",
    "adapter",
    "method",
  ]) {
    const { profile, scenario } = loadCase(root, "repair-request");
    scenario.branches = [];
    scenario.expect = [];
    scenario.result = undefined;
    scenario.script = scenario.script.filter((s) => s.type !== "assert");
    const effect = scenario.script.find((s) => s.type === "effect");
    if (effect?.type !== "effect") throw new Error("missing fixture");
    if (attack === "over") effect.intent.parameters = { amount: 180, currency: "GBP" };
    if (attack === "missing") effect.intent.parameters = { currency: "GBP" };
    if (attack === "string") effect.intent.parameters = { amount: "80", currency: "GBP" };
    if (attack === "negative") effect.intent.parameters = { amount: -1, currency: "GBP" };
    if (attack === "precision") effect.intent.parameters = { amount: 1.001, currency: "GBP" };
    if (attack === "currency") effect.intent.parameters = { amount: 80, currency: "USD" };
    if (attack !== "none" && attack !== "method")
      effect.params = structuredClone(
        effect.intent.parameters as import("../src/core/types.js").JsonObject,
      );
    if (attack === "adapter") effect.params.amount = 81;
    if (attack === "method") {
      const rule = profile.claims.find((c) => c.kind === "repair.booking");
      if (!rule) throw new Error("missing reading rule");
      rule.methods = ["recorded-by-authority"];
    }
    const [path] = await runScenario(profile, scenario, { compare: false });
    const events = path?.trace?.events ?? [];
    const last = events.findLast((e) => e.kind === "decision");
    expect(last?.outcome, attack).toBe(
      attack === "none"
        ? "go"
        : attack === "over"
          ? "ask-principal"
          : attack === "method"
            ? "ask-more"
            : "stop",
    );
    if (["missing", "string", "negative", "precision", "currency"].includes(attack))
      expect(last?.reason, attack).toBe("malformed");
    if (attack === "over") expect(last?.reason).toBe("limit-exceeded");
    if (attack === "adapter") expect(last?.reason).toBe("not-authorised");
    if (attack === "method") expect(last?.reason).toBe("structured-form-required");
  }
});

it("runs independent joint-mortgage refusals without claiming a joint agreement", async () => {
  const { profile, scenario } = loadCase(root, "joint-mortgage");
  const paths = await runScenario(profile, scenario);
  expect(paths[0]?.trace).toBeUndefined();
  expect(paths[1]?.actual).toMatchObject({ outcome: "stop", reason: "mandate-invalid" });
  expect(paths[1]?.expected).toMatchObject({ outcome: "stop", reason: "mandate-withdrawn" });
  expect(paths[1]?.disagrees).toBe(true);
  expect(paths[2]?.actual).toMatchObject({ outcome: "stop", reason: "prohibited" });
  for (const path of paths.slice(1)) {
    const events = path.trace?.events ?? [];
    const stop = events.find((e) => e.outcome === "stop");
    expect(stop).toBeDefined();
    expect(events.some((e) => e.agent === "owner-agent" && e.kind === "message-out")).toBe(false);
  }
});

it("keeps catalogue expectations separate from observed refusals", async () => {
  for (const id of ["fit-note-to-employer", "wearable-data"]) {
    const { profile, scenario } = loadCase(root, id);
    const paths = await runScenario(profile, scenario);
    expect(paths[0]?.disagrees).toBe(false);
    expect(paths[1]?.disagrees).toBe(true);
    expect(paths[1]?.actual?.outcome).toBe("stop");
    expect(paths[1]?.expected).toEqual(scenario.branches[0]?.catalogueExpected);
    expect(paths[1]?.trace?.events.some((e) => e.reason === paths[1]?.actual?.reason)).toBe(true);
  }
});

it("requires currently accepted completeness for the exact list, subject and period before any proof", async () => {
  for (const attack of [
    "none",
    "missing",
    "false",
    "subject",
    "period",
    "claim",
    "source",
    "method",
    "stale",
    "expired",
    "terms",
  ]) {
    const { profile, scenario } = loadCase(root, "trial-eligibility");
    const branch = scenario.branches[0];
    if (!branch) throw new Error("missing branch");
    const world = patch(scenario, branch.change);
    world.branches = [];
    world.blocked = [];
    world.expect = [];
    const complete = world.statements.find((s) => s.id === "completeness");
    const medicine = world.statements.find((s) => s.id === "medicines");
    if (!complete || !medicine) throw new Error("missing claims");
    complete.value.complete = attack !== "false";
    if (attack === "missing") world.statements = world.statements.filter((s) => s !== complete);
    if (attack === "missing") {
      const step = world.script[0];
      if (step?.type !== "admit") throw new Error("missing admission");
      step.statements = ["medicines"];
    }
    if (attack === "subject") complete.subject = "urn:fictional:another-patient";
    if (attack === "period") complete.value.period = { start: "2026-10-01", end: "2026-10-31" };
    if (attack === "claim") complete.value.forClaim = "another.list";
    if (attack === "source") complete.issuer = "receiver";
    if (attack === "method") complete.method = "self-reported";
    if (attack === "stale") complete.asOf = "2026-01-01T00:00:00.000Z";
    if (attack === "expired") complete.value.validUntil = "2026-11-12T00:00:00.000Z";
    if (attack === "terms") complete.terms = undefined;
    if (attack === "terms")
      complete.terms = { policy: { id: "urn:terms:no-use", permissions: [] } };
    const [result] = await runScenario(profile, world, { compare: false });
    const events = result?.trace?.events ?? [];
    const medicineDecision = events.findLast((e) => e.kind === "decision");
    expect(medicineDecision?.outcome, attack).toBe(attack === "none" ? "admit" : "ask-more");
    if (attack !== "none")
      expect(medicineDecision?.reason, attack).toBe("completeness-not-established");
    expect(
      events.some((e) => e.kind === "message-out"),
      attack,
    ).toBe(false);
  }
  const { profile, scenario } = loadCase(root, "trial-eligibility");
  const paths = await runScenario(profile, scenario);
  expect(paths[0]).toMatchObject({ blocked: "needs a proof system" });
  expect(paths[0]?.trace).toBeUndefined();
  expect(paths[1]?.actual).toMatchObject({
    outcome: "ask-more",
    reason: "completeness-not-established",
  });
});
