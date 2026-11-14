// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

for (const [id, missing] of [
  ["benefit-claim", "benefit.rent"],
  ["insurance-claim-photos", "repair.estimate"],
  ["small-business-loan", "business.tax-filing"],
])
  it(`${id}: asks for omitted evidence before the operation, retains passing claims, and admits the supplied evidence`, async () => {
    const { profile, scenario } = loadCase(join(import.meta.dirname, ".."), id!);
    scenario.branches = scenario.branches.filter((b) => b.id === "needed-claim-left-out");
    const paths = await runScenario(profile, scenario, { compare: false });
    const path = paths.find((p) => p.path === "needed-claim-left-out");
    expect(path?.blocked).toBeUndefined();
    const events = path!.trace!.events;
    const coverage = events.findIndex(
      (e) =>
        e.agent === "receiver-agent" &&
        e.rule?.id === "CORE-IN-21" &&
        e.reason === "evidence-missing",
    );
    expect(coverage).toBeGreaterThan(0);
    expect(events[coverage]!.refs).toContainEqual(expect.objectContaining({ id: missing }));
    expect(events[coverage]!.caption).toContain(missing!.replace(/[.-]/g, " "));
    expect(events[coverage]!.caption).toContain("Accepted sources:");
    expect(events[coverage]!.caption).toContain("Accepted methods:");
    const reply = events
      .slice(coverage)
      .find((e) => e.agent === "receiver-agent" && e.kind === "message-out");
    expect(reply?.packet?.kind).toBe("challenge");
    const retry = events.findIndex(
      (e, i) =>
        i > coverage &&
        e.agent === "receiver-agent" &&
        e.rule?.id === "CORE-IN-21" &&
        e.verdict === "pass",
    );
    expect(retry).toBeGreaterThan(coverage);
    expect(
      events.slice(coverage, retry).some((e) => e.agent === "receiver-agent" && e.part === "core"),
    ).toBe(false);
    expect(
      events.slice(retry).some((e) => e.agent === "receiver-agent" && e.outcome === "admit"),
    ).toBe(true);
  }, 120_000);
