// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readdirSync, readFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  applyChanges,
  DATA_ROOT,
  loadProfile,
  loadScenario,
  runScenario,
  runScenarioPaths,
  scenarioIds,
} from "../src/engine/run.js";
import { profileSchema, scenarioSchema, validateScenario } from "../src/engine/schema.js";

describe("executable scenario data", () => {
  it("validates every profile and scenario and pins the published JSON Schemas", () => {
    for (const file of readdirSync(join(DATA_ROOT, "profiles")))
      profileSchema.parse(JSON.parse(readFileSync(join(DATA_ROOT, "profiles", file), "utf8")));
    for (const id of scenarioIds()) validateScenario(loadScenario(id));
    for (const [name, schema] of [
      ["agent-profile", profileSchema],
      ["agent-scenario", scenarioSchema],
    ] as const)
      expect(
        JSON.parse(readFileSync(join(DATA_ROOT, "schemas", `${name}.schema.json`), "utf8")),
        // biome-ignore lint/style/useNamingConvention: JSON Schema keyword
      ).toEqual({ $comment: "AUTHORED-BY Codex GPT-6.1-Sol", ...z.toJSONSchema(schema) });
  });
  it("rejects malformed and duplicate identities, unknown principals, and unsafe paths", () => {
    const s = loadScenario("mortgage-core");
    expect(() => validateScenario({ ...s, schema: "agent-scenario/99" })).toThrow();
    expect(() => validateScenario({ ...s, parties: [...s.parties, s.parties[0]] })).toThrow(
      /duplicate party/,
    );
    expect(() =>
      validateScenario({ ...s, parties: s.parties.map((p) => ({ ...p, actsFor: "missing" })) }),
    ).toThrow(/unknown principal/);
    expect(() => applyChanges(s, [{ path: "/expect", value: [] }])).toThrow(
      /invalid scenario change path/,
    );
    expect(() => applyChanges(s, [{ path: "/core/__proto__/polluted", value: true }])).toThrow();
    expect(() => loadScenario("../mortgage-core")).toThrow(/invalid data identifier/);
  });
  it("runs named changes through the same engine and compares each branch outline", async () => {
    const scenario = loadScenario("mortgage-core");
    const over = loadScenario("mortgage-over-ask");
    scenario.branches.push({
      id: "over-ask",
      title: over.title,
      outcome: "stop",
      check: "mandate",
      reason: "not-authorised",
      expect: over.expect,
      changes: [
        { path: "/core", value: over.core },
        { path: "/script", value: over.script },
        { path: "/statements", value: over.statements },
      ],
    });
    const traces = await runScenarioPaths(loadProfile(scenario.profile), scenario);
    expect([...traces.keys()]).toEqual([scenario.id, `${scenario.id}-over-ask`]);
    expect(traces.get(`${scenario.id}-over-ask`)?.events.some((e) => e.outcome === "stop")).toBe(
      true,
    );
  });
  it("rejects an unsupported configuration instead of claiming a run", async () => {
    const s = loadScenario("mortgage-core");
    s.configuration.layers["data-access"] = "zk-query-proof";
    await expect(runScenario(loadProfile(s.profile), s)).rejects.toThrow(/not runnable/);
  });
  it("cannot satisfy an outline by changing expected verdicts", async () => {
    const s = loadScenario("mortgage-over-ask");
    s.expect = [];
    await expect(runScenario(loadProfile(s.profile), s)).rejects.toThrow(/outline mismatch/);
  });
  it("is byte reproducible for every main path", async () => {
    for (const id of scenarioIds()) {
      const scenario = loadScenario(id),
        profile = loadProfile(scenario.profile);
      expect(JSON.stringify(await runScenario(profile, scenario))).toBe(
        JSON.stringify(await runScenario(profile, scenario)),
      );
    }
  });
});
