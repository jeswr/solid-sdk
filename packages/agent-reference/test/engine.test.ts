// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readdirSync, readFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CORE_REASON_CODES } from "../src/core/types.js";
import { loadCase, validateReferences } from "../src/engine/load.js";
import { patch, resolveTemplate, runScenario } from "../src/engine/run.js";
import { domainProfileSchema, scenarioSchema } from "../src/engine/schema.js";
import { outlineOf } from "../src/trace/types.js";

const root = join(import.meta.dirname, "..");
const loaded = () => loadCase(root, "probing-counterparty");

it("loads every declared case and preserves every catalogue branch, without claiming blocked paths ran", async () => {
  let runs = 0;
  let blocked = 0;
  for (const file of readdirSync(join(root, "scenarios"))) {
    const { profile, scenario } = loadCase(root, file.slice(0, -5));
    const results = await runScenario(profile, scenario);
    expect(results).toHaveLength(scenario.branches.length + 1);
    for (const result of results) {
      if (result.blocked) {
        blocked++;
        expect(result.trace).toBeUndefined();
      } else {
        runs++;
        expect(result.matches).toBe(true);
      }
    }
  }
  expect(runs).toBe(3);
  expect(blocked).toBe(28);
});

it("runs both probing branches through real gates, with no later disclosure or effect after a stop", async () => {
  const { profile, scenario } = loaded();
  const results = await runScenario(profile, scenario);
  const main = results[0]!.trace!;
  for (const check of scenario.stress)
    expect(main.events.some((e) => e.check === check)).toBe(true);
  expect(main.events.some((e) => e.kind === "message-out" && e.packet?.kind === "deliver")).toBe(
    true,
  );
  const outside = results.find((p) => p.path === "tenth-request")!.trace!;
  expect(
    outside.events.filter((e) => e.outcome === "stop" && e.reason === "not-authorised"),
  ).toHaveLength(10);
  expect(outside.events.some((e) => e.kind === "message-out" || e.kind === "store")).toBe(false);
  expect(results.find((p) => p.path === "round-limit")!.trace!.events.at(-1)).toMatchObject({
    outcome: "stop",
    reason: "round-limit",
  });
  for (const result of results)
    for (const event of result.trace!.events)
      if (event.reason) expect(CORE_REASON_CODES).toContain(event.reason);
});

it("reproduces every event with fixed keys and rejects outline drift and the wrong branch outcome", async () => {
  const { profile, scenario } = loaded();
  expect(await runScenario(profile, scenario)).toEqual(await runScenario(profile, scenario));
  const changed = structuredClone(scenario);
  changed.expect.pop();
  await expect(runScenario(profile, changed)).rejects.toThrow("outline differs");
  const wrong = structuredClone(scenario);
  wrong.branches[0]!.expect.reason = "approval-denied";
  await expect(runScenario(profile, wrong)).rejects.toThrow("expected mandate/approval-denied");
});

it("is independent of domain identifiers and fixture names", async () => {
  const { profile, scenario } = loaded();
  // This path exercises only the general executor, avoiding the contact statement's fixed id.
  const alternate = {
    ...scenario,
    id: "another-domain",
    profile: "another-domain",
    title: "Another domain",
    script: scenario.branches[0]!.change.script,
    branches: [],
    expect: [],
  };
  const r = await runScenario({ ...profile, id: "another-domain" }, alternate, { compare: false });
  expect(r[0]!.trace!.scenario.id).toBe("another-domain");
  expect(r[0]!.trace!.events.filter((e) => e.outcome === "stop")).toHaveLength(10);
});

describe("data contracts", () => {
  it("rejects malformed inputs, duplicate references and undeclared keys", () => {
    const { profile, scenario } = loaded();
    expect(() => scenarioSchema.parse({ ...scenario, schema: "anything-else" })).toThrow();
    expect(() => domainProfileSchema.parse({ ...profile, arbitrary: true })).toThrow();
    expect(() =>
      validateReferences(profile, {
        ...scenario,
        parties: [...scenario.parties, scenario.parties[0]!],
      }),
    ).toThrow("duplicate party");
    const wrong = structuredClone(scenario);
    wrong.script[0]!.agent = "absent";
    expect(() => validateReferences(profile, wrong)).toThrow("unknown party");
  });
  it("resolves only whole-value references, refuses missing paths, and cannot patch prototypes", () => {
    expect(
      resolveTemplate({ id: { ["$ref"]: "world.id" } }, { world: { id: "urn:test:id" } }),
    ).toEqual({ id: "urn:test:id" });
    expect(() => resolveTemplate({ ["$ref"]: "world.missing" }, { world: {} })).toThrow(
      "unresolved reference",
    );
    expect(() => resolveTemplate({ ["$ref"]: "world.__proto__" }, { world: {} })).toThrow();
    expect(() => patch({}, JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow("unsafe patch");
  });
  it("publishes JSON Schemas from the exact validators used on load", () => {
    for (const [name, validator] of [
      ["domain-profile", domainProfileSchema],
      ["agent-scenario", scenarioSchema],
    ] as const) {
      const published = JSON.parse(
        readFileSync(join(root, "schemas", `${name}.schema.json`), "utf8"),
      );
      expect(published).toEqual({
        ...z.toJSONSchema(validator, { target: "draft-2020-12" }),
        "x-authored-by": "Codex GPT-6",
        ["$id"]: `urn:agent-reference:schema:${name}:0.1`,
      });
    }
  });
  it("commits matching outlines for every runnable data path", async () => {
    const { profile, scenario } = loaded();
    for (const path of await runScenario(profile, scenario)) {
      const stem = path.path === "main" ? scenario.id : `${scenario.id}--${path.path}`;
      const outline = JSON.parse(
        readFileSync(join(root, "outlines", `${stem}--baseline.json`), "utf8"),
      );
      expect(outline.entries).toEqual(outlineOf(path.trace!));
    }
  });
});
