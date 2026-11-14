// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readdirSync, readFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import {
  addedSegmentDifferences,
  confinementDifferences,
  patchDifferences,
} from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { matrixPrerequisite, matrixWorld } from "../src/engine/matrix.js";
import { patch, runScenario } from "../src/engine/run.js";
import type { Scenario } from "../src/engine/schema.js";
import { alternativeWireId, configurationById } from "../src/profile/configurations.js";
import type { LayerId } from "../src/suites/registry.js";
import type { TraceFile } from "../src/trace/types.js";

const root = join(import.meta.dirname, "..");
type Entry = Scenario["configurations"][number];
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(root, "test/fixtures", name), "utf8")) as {
    configuration: Record<string, unknown> & { id: string; world: Record<string, unknown> };
    removeCheck?: { check: string; gate: string };
    insertBefore?: string;
    steps?: unknown[];
  };

it("confines every scenario configuration (brief 31 C1 to C5) and preserves the final outcome", async () => {
  let tested = 0;
  for (const file of readdirSync(join(root, "scenarios")).filter((file) =>
    file.endsWith(".json"),
  )) {
    const { profile, scenario } = loadCase(root, file.slice(0, -5));
    if (!scenario.configurations.length) continue;
    const baseline = (await runScenario(profile, scenario))[0]?.trace;
    expect(baseline, `${scenario.title}: the baseline must run`).toBeDefined();
    const mains = new Map<string, TraceFile | undefined>();
    const main = async (entry: Entry) => {
      if (!mains.has(entry.id))
        mains.set(
          entry.id,
          (await runScenario(profile, scenario, { configuration: entry.id })).find(
            (result) => result.path === "main",
          )?.trace,
        );
      return mains.get(entry.id);
    };
    for (const entry of scenario.configurations) {
      // Design 26 §2 requires honest not-run cells when a mechanism is unresolved.
      if (configurationById(alternativeWireId(entry.id))?.status === "unresolved") {
        const changed = (await runScenario(profile, scenario, { configuration: entry.id })).find(
          (result) => result.path === "main",
        );
        expect(changed?.trace).toBeUndefined();
        expect(changed?.blocked).toMatch(
          /no executable runtime configuration|registered suite constraint/,
        );
        continue;
      }
      const patched = patchDifferences(scenario, entry);
      expect(patched, `${scenario.title}, ${entry.id} (C3):\n${patched.join("\n")}`).toEqual([]);
      const trace = await main(entry);
      if (!baseline || !trace) throw new Error(`${entry.id}: missing real configuration trace`);
      // With a prerequisite the comparison is that configuration's own main run.
      const prerequisite = matrixPrerequisite(scenario, entry);
      const reference = prerequisite ? await main(prerequisite) : baseline;
      if (!reference) throw new Error(`${entry.id}: the prerequisite must run`);
      const layer = Object.keys(entry.change)[0] as LayerId;
      const differences = confinementDifferences(reference, trace, layer);
      expect(differences, `${scenario.title}, ${layer}:\n${differences.join("\n")}`).toEqual([]);
      const added = addedSegmentDifferences(trace, entry, matrixWorld(scenario, entry).parties);
      expect(added, `${scenario.title}, ${entry.id} (C2, C5):\n${added.join("\n")}`).toEqual([]);
      tested++;
    }
  }
  expect(tested).toBeGreaterThanOrEqual(3);
}, 900_000);

it("refuses a transport configuration that adds a step, inside an added segment or not", async () => {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const wrong = fixture("confinement-wrong.json");
  const original = scenario.configurations.find((entry) => entry.id === "transport-email");
  if (!original) throw new Error("Missing email configuration");
  const outside = patch(original, wrong.configuration) as Entry;
  expect(patchDifferences(scenario, outside).join("\n")).toMatch(
    /confinement-fault is added outside an added segment/,
  );
  const marked = patch(outside, {
    world: { script: { "confinement-fault": { segment: "added", segmentEnd: "added" } } },
  }) as Entry;
  expect(patchDifferences(scenario, marked).join("\n")).toMatch(
    /transport configurations may not add exchanges/,
  );
  scenario.configurations = scenario.configurations.map((entry) =>
    entry.id === marked.id ? marked : entry,
  );
  await expect(runScenario(profile, scenario, { configuration: marked.id })).rejects.toThrow(
    /transport configurations may not add exchanges/,
  );
});

it("applies a prerequisite's patch first and admits only one prerequisite", () => {
  const { scenario } = loadCase(root, "mortgage-main");
  const byId = (id: string) => {
    const entry = scenario.configurations.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(id);
    return entry;
  };
  const prerequisite = patch(byId("data-access-by-reference-solid"), {
    world: { traceSteps: { "99": "Prerequisite marker" } },
  }) as Entry;
  const dependent = patch(byId("usage-control-solid-access-control"), {
    requires: prerequisite.id,
  }) as Entry;
  scenario.configurations = scenario.configurations.map((entry) =>
    entry.id === prerequisite.id ? prerequisite : entry.id === dependent.id ? dependent : entry,
  );
  const world = matrixWorld(scenario, dependent);
  expect(world.traceSteps?.["99"]).toBe("Prerequisite marker");
  // The dependent advertises itself where the baseline or prerequisite was advertised.
  expect(world.parties.flatMap((party) => party.configurations)).not.toContain(prerequisite.id);
  const chained = patch(prerequisite, { requires: "identity-webid" }) as Entry;
  scenario.configurations = scenario.configurations.map((entry) =>
    entry.id === chained.id ? chained : entry,
  );
  expect(() => matrixWorld(scenario, dependent)).toThrow(/only one prerequisite/);
});

/** A fixture configuration over the real mortgage journey, main path only. */
async function runFixture(name: string, sameStop = false) {
  const { profile, scenario } = loadCase(root, "mortgage-main");
  const loaded = fixture(name);
  scenario.branches = [];
  const original = scenario.configurations.find((entry) => entry.id === loaded.configuration.id);
  if (!original) throw new Error(`Missing ${loaded.configuration.id}`);
  const entry = patch(original, {
    ...loaded.configuration,
    world: { ...loaded.configuration.world, branches: [] },
  }) as Entry;
  if (loaded.insertBefore && loaded.steps) {
    const at = scenario.script.findIndex((step) => step.id === loaded.insertBefore);
    entry.world.script = [
      ...scenario.script.slice(0, at),
      ...loaded.steps,
      ...scenario.script.slice(at),
    ] as never;
  }
  scenario.configurations = scenario.configurations.map((candidate) =>
    candidate.id === entry.id ? entry : candidate,
  );
  const stop = sameStop ? (entry.world.stopAfter as string | undefined) : undefined;
  const baseline = (
    await runScenario(
      profile,
      { ...scenario, ...(stop ? { stopAfter: stop } : {}) },
      {
        compare: !stop,
      },
    )
  )[0]?.trace;
  const changed = (await runScenario(profile, scenario, { configuration: entry.id })).find(
    (result) => result.path === "main",
  )?.trace;
  if (!baseline || !changed) throw new Error("The fixture must exercise real gates");
  return {
    scenario,
    entry,
    baseline,
    changed,
    loaded,
    layer: Object.keys(entry.change)[0] as LayerId,
  };
}

it("detects an added exchange with a check missing, and passes it whole", async () => {
  const { scenario, entry, baseline, changed, loaded, layer } = await runFixture(
    "added-exchange-check-missing.json",
  );
  // Control: the untouched added register lookup satisfies every part of the rule.
  expect(patchDifferences(scenario, entry)).toEqual([]);
  expect(confinementDifferences(baseline, changed, layer)).toEqual([]);
  expect(addedSegmentDifferences(changed, entry, scenario.parties)).toEqual([]);
  expect(changed.events.filter((event) => event.addedBy).length).toBeGreaterThan(0);
  const removed = loaded.removeCheck;
  if (!removed) throw new Error("The fixture names the check to remove");
  const index = changed.events.findIndex(
    (event) => event.addedBy && event.check === removed.check && event.part === removed.gate,
  );
  expect(index).toBeGreaterThanOrEqual(0);
  const skipped = { ...changed, events: changed.events.filter((_, at) => at !== index) };
  expect(addedSegmentDifferences(skipped, entry, scenario.parties).join("\n")).toMatch(
    /check recipient is missing/,
  );
}, 300_000);

it("detects an added exchange with a failing check", async () => {
  const { scenario, entry, changed } = await runFixture("added-exchange-check-fails.json");
  const found = addedSegmentDifferences(changed, entry, scenario.parties).join("\n");
  expect(found).toMatch(/mandate ends fail/);
  expect(found).toMatch(/no message closes it/);
}, 300_000);

it("detects a patch that edits a baseline mandate rule", () => {
  const { scenario } = loadCase(root, "mortgage-main");
  const loaded = fixture("patch-edits-mandate-rule.json");
  const original = scenario.configurations.find((entry) => entry.id === loaded.configuration.id);
  if (!original) throw new Error("Missing configuration");
  const entry = patch(original, loaded.configuration) as Entry;
  expect(patchDifferences(scenario, entry).join("\n")).toMatch(
    /mandate:sam-agent#autonomous\/urn:rule:use:payment-request changes/,
  );
});

it("detects an added exchange that changes a later baseline verdict", async () => {
  const { scenario, entry, baseline, changed, layer } = await runFixture(
    "added-exchange-changes-later-verdict.json",
    true,
  );
  // The added lookup itself is ordinary; the damage is to the baseline exchange after it.
  expect(addedSegmentDifferences(changed, entry, scenario.parties)).toEqual([]);
  const found = confinementDifferences(baseline, changed, layer).join("\n");
  expect(found).toMatch(/"check":"fitness","verdict":"pass".*"check":"fitness","verdict":"fail"/);
  expect(found).toMatch(/Final outcome/);
}, 300_000);

it("judges agent gate runs only: a mechanism's events are skipped, an agent's missing check is caught", () => {
  // AUTHORED-BY Claude Opus 5.5 (brief 31 item 4: C2 scoped to agent gates)
  const event = (agent: string, part: string, kind: string, extra: object = {}) =>
    ({
      agent,
      part,
      kind,
      addedBy: "fixture",
      caption: "",
      ...extra,
    }) as unknown as TraceFile["events"][number];
  const trace = {
    events: [
      event("sams-agent", "outbound-gate", "check", {
        check: "mandate",
        verdict: "pass",
        segment: "added",
      }),
      event("sams-agent", "outbound-gate", "decision", { outcome: "go" }),
      event("forum", "outbound-gate", "check", { check: "recipient", verdict: "pass" }),
    ],
  };
  const entry = { id: "fixture", added: [{ segment: "first" }] } as unknown as Entry;
  const sam = { id: "sam-agent", traceId: "sams-agent", runs: "agent" as const };
  const parties = [sam, { id: "forum", runs: "issuer-only" as const }];
  const found = addedSegmentDifferences(trace, entry, parties).join("\n");
  expect(found).toMatch(/sams-agent outbound-gate run 1: check recipient is missing/);
  expect(found).not.toMatch(/forum/);
  // The same events from a party that runs an agent are a gate run without a decision.
  const asAgent = addedSegmentDifferences(trace, entry, [
    sam,
    { id: "forum", runs: "agent" as const },
  ]).join("\n");
  expect(asAgent).toMatch(/forum\|outbound-gate records checks without a decision/);
});
