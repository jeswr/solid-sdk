// AUTHORED-BY Codex GPT-6.2 Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync } from "fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { availableAdapters } from "../src/derive/adapters/index.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import * as mandate from "../src/mechanisms/mandate.js";
import { mandateDataset, mandateFromStore } from "../src/model/store/policy.js";
import { outlineOf } from "../src/trace/types.js";
import { readNQuads, writeNQuads } from "../src/wire/store-quads.js";
import { sampledScenario, samplePlan } from "./helpers/model-corpus.js";

const root = new URL("../", import.meta.url).pathname;
const full = process.env.FULL_CORPUS === "1";
const manifest = JSON.parse(readFileSync(root + "scenario-runs.json", "utf8")) as {
  paths: { scenario: string; configuration?: string; path: string; trace?: string }[];
};
const groupKey = (row: (typeof manifest.paths)[number]) =>
  [row.scenario, row.configuration ?? ""].join("\0");
const traces = new Map<string, Map<string, string>>();
for (const row of manifest.paths) {
  if (!row.trace) continue;
  const key = groupKey(row);
  let paths = traces.get(key);
  if (!paths) {
    paths = new Map();
    traces.set(key, paths);
  }
  paths.set(row.path, row.trace);
}
const groups = full
  ? new Map(manifest.paths.map((row) => [groupKey(row), new Set<string>()]))
  : samplePlan(root).groups;

// Optional split for running the same corpus in two workers. The default runs all groups.
const part = process.env.STATE_CORPUS_PART;
if (part !== undefined && part !== "0" && part !== "1")
  throw new Error("Expected STATE_CORPUS_PART 0 or 1");
const cases = [...groups].flatMap(([group, selected], index) => {
  if (part !== undefined && Number(part) !== index % 2) return [];
  const [scenario, configuration] = group.split("\0") as [string, string];
  return [
    {
      label: scenario + "/" + (configuration || "baseline"),
      group,
      scenario,
      configuration,
      selected,
    },
  ];
});

describe("native state and policy projections", () => {
  let registry: Awaited<ReturnType<typeof availableAdapters>>;
  let compared = 0;
  let outlines = 0;
  const nativeEvaluate = mandate.evaluateIntent;
  beforeAll(async () => {
    registry = await availableAdapters();
    vi.stubEnv("AWP_STORE_RDF", "1");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    // A filtered diagnostic may run a scenario that has no owner-mandate decision.
    if (part !== undefined || full) {
      expect(compared).toBeGreaterThan(0);
      expect(outlines).toBeGreaterThan(0);
    }
  });

  it.each(cases)("$label", async ({ group, scenario: name, configuration, selected }) => {
    const decoded = new WeakMap<mandate.LoadedMandate, mandate.OwnerMandate>();
    const failures = new Set<string>();
    const evaluate = vi.spyOn(mandate, "evaluateIntent").mockImplementation((input) => {
      evaluate.mockClear();
      const decision = nativeEvaluate(input);
      if (input.loaded?.credential && input.loaded.verification) {
        const loaded = input.loaded as mandate.LoadedMandate;
        try {
          if (!decoded.has(loaded))
            decoded.set(
              loaded,
              mandateFromStore(readNQuads(writeNQuads(mandateDataset(loaded))), loaded),
            );
          const restored = nativeEvaluate({
            ...input,
            loaded: { ...loaded, mandate: decoded.get(loaded)! },
          });
          expect(restored).toEqual(decision);
          compared++;
        } catch (error) {
          failures.add(loaded.mandate.id + ": " + String(error));
        }
      }
      return decision;
    });
    try {
      const { profile, scenario } = loadCase(root, name);
      const input = full
        ? scenario
        : sampledScenario(scenario, configuration || undefined, selected);
      const recorded = traces.get(group);
      const expected = new Set(full ? recorded?.keys() : selected);
      if (recorded?.has("main")) expected.add("main");
      for (const row of await runScenario(profile, input, {
        configuration: configuration || undefined,
        registry,
      })) {
        if (!expected.delete(row.path)) continue;
        const path = recorded?.get(row.path);
        // Paths that need the optional sparq adapters produce no trace unless all three are
        // loaded (CI has none), as in the record and model corpora.
        if (!row.trace && registry.loaded.length < 3) continue;
        if (!row.trace || !path) throw new Error(`Missing trace for ${group}/${row.path}`);
        const original = JSON.parse(readFileSync(root + "traces/" + path, "utf8"));
        expect(outlineOf(row.trace), group + "/" + row.path).toEqual(outlineOf(original));
        outlines++;
      }
      expect([...expected], `Missing sampled paths for ${group}`).toEqual([]);
      if (failures.size) throw new Error([...failures].join("\n"));
    } finally {
      evaluate.mockRestore();
    }
  }, 600_000);
});
