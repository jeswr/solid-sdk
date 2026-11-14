// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { confinementDifferences } from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

it("shows only source-signed annual gross income and employer and completes the real mortgage", async () => {
  const { profile, scenario } = loadCase(new URL("../", import.meta.url).pathname, "mortgage-main");
  const baseline = (await runScenario(profile, { ...scenario, branches: [] }))[0]!.trace!;
  const entry = scenario.configurations.find((c) => c.id === "authenticity-selective-disclosure")!;
  entry.world.branches = [];
  const paths = await runScenario(profile, scenario, { configuration: entry.id });
  expect(paths[0]!.blocked).toBeUndefined();
  const trace = paths[0]!.trace!;
  expect(
    JSON.stringify(
      trace.events.find((e) => e.packet?.kind === "description")?.packet?.layers.content.raw,
    ),
  ).toContain("mortgage-evidence-annual-income");
  expect(confinementDifferences(baseline, trace, "authenticity")).toEqual([]);
  expect(trace.events.some((e) => e.packet?.jsonld?.includes("selective-disclosure+jws"))).toBe(
    true,
  );
  expect(JSON.stringify(trace)).not.toContain("FICTIONAL-PRIVATE-INSURANCE-NUMBER");
  expect(
    trace.events.some(
      (e) =>
        e.kind === "message-in" &&
        e.agent === "lender" &&
        e.packet?.jsonld?.includes("employerName"),
    ),
  ).toBe(true);
}, 180_000);
it("withholds the requested private number, continues on permitted claims and refuses a holder’s changed disclosure", async () => {
  const { profile, scenario } = loadCase(new URL("../", import.meta.url).pathname, "mortgage-main");
  const entry = scenario.configurations.find((c) => c.id === "authenticity-selective-disclosure")!;
  entry.world.branches = scenario.branches
    .filter((branch) => branch.onlyUnder === entry.id)
    .filter((b) => ["withheld-claim-asked-for", "disclosure-not-in-signed-set"].includes(b.id));
  const paths = await runScenario(profile, scenario, { configuration: entry.id });
  const withheld = paths.find((p) => p.path === "withheld-claim-asked-for")!;
  expect(
    withheld.trace!.events.some(
      (e) =>
        e.agent === "sams-agent" &&
        e.check === "disclosure" &&
        e.reason === "excessive-scope" &&
        e.verdict !== "pass",
    ),
  ).toBe(true);
  expect(
    withheld.trace!.events.some(
      (e) =>
        e.packet?.kind === "receipt" && (e.packet.layers.content.raw as { final?: boolean })?.final,
    ),
  ).toBe(true);
  expect(JSON.stringify(withheld.trace)).not.toContain("FICTIONAL-PRIVATE-INSURANCE-NUMBER");
  const changed = paths.find((p) => p.path === "disclosure-not-in-signed-set")!;
  expect(changed.trace!.events.findLast((e) => e.kind === "decision")).toMatchObject({
    outcome: "refuse",
    reason: "bad-signature",
  });
  expect(changed.trace!.events.findLast((e) => e.kind === "check")).toMatchObject({
    check: "integrity",
    verdict: "fail",
    reason: "bad-signature",
  });
}, 180_000);
