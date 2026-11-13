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

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing test fixture value");
  return value;
}

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
  const main = required(required(results[0]).trace);
  for (const check of scenario.stress)
    expect(main.events.some((e) => e.check === check)).toBe(true);
  expect(main.events.some((e) => e.kind === "message-out" && e.packet?.kind === "deliver")).toBe(
    true,
  );
  const outside = required(required(results.find((p) => p.path === "tenth-request")).trace);
  expect(
    outside.events.filter((e) => e.outcome === "stop" && e.reason === "not-authorised"),
  ).toHaveLength(10);
  const firstStop = outside.events.findIndex(
    (e) => e.agent === "person-agent" && e.outcome === "stop",
  );
  expect(
    outside.events
      .slice(firstStop + 1)
      .some((e) => e.agent === "person-agent" && (e.kind === "message-out" || e.kind === "store")),
  ).toBe(false);
  expect(
    outside.events.filter(
      (e) => e.agent === "person-agent" && e.kind === "message-in" && e.packet?.kind === "invoke",
    ),
  ).toHaveLength(10);
  const conversations = outside.events
    .filter((e) => e.kind === "message-in")
    .map((e) => (e.packet?.layers.header.raw as { conversation?: string }).conversation);
  expect(new Set(conversations).size).toBe(1);
  expect(
    required(required(results.find((p) => p.path === "round-limit")).trace).events.at(-1),
  ).toMatchObject({
    outcome: "stop",
    reason: "round-limit",
  });
  for (const result of results)
    for (const event of required(result.trace).events)
      if (event.reason) expect(CORE_REASON_CODES).toContain(event.reason);
});

it("reproduces every event with fixed keys and rejects outline drift and the wrong branch outcome", async () => {
  const { profile, scenario } = loaded();
  expect(await runScenario(profile, scenario)).toEqual(await runScenario(profile, scenario));
  const changed = structuredClone(scenario);
  changed.expect.pop();
  await expect(runScenario(profile, changed)).rejects.toThrow("outline differs");
  const wrong = structuredClone(scenario);
  required(wrong.branches[0]).expect.reason = "approval-denied";
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
    stress: ["mandate"],
    script: required(scenario.branches[0]).change.script,
    branches: [],
    expect: [],
  };
  const r = await runScenario({ ...profile, id: "another-domain" }, alternate, { compare: false });
  expect(required(required(r[0]).trace).scenario.id).toBe("another-domain");
  expect(required(required(r[0]).trace).events.filter((e) => e.outcome === "stop")).toHaveLength(
    10,
  );
});

describe("data contracts", () => {
  it("rejects malformed inputs, duplicate references and undeclared keys", () => {
    const { profile, scenario } = loaded();
    expect(() => scenarioSchema.parse({ ...scenario, schema: "anything-else" })).toThrow();
    expect(() => domainProfileSchema.parse({ ...profile, arbitrary: true })).toThrow();
    expect(() =>
      validateReferences(profile, {
        ...scenario,
        parties: [...scenario.parties, required(scenario.parties[0])],
      }),
    ).toThrow("duplicate party");
    const wrong = structuredClone(scenario);
    required(wrong.script[0]).agent = "absent";
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
      expect(outline.entries).toEqual(outlineOf(required(path.trace)));
    }
  });
});

it("applies hostile wire mutations to a real inbound verification", async () => {
  const { profile, scenario } = loaded();
  const hostile = {
    ...scenario,
    branches: [],
    expect: [],
    stress: ["integrity"],
    script: scenario.script.slice(0, 5),
    inject: [
      {
        step: "acceptance-arrives",
        target: "wire",
        path: ["jws"],
        value: "not-a-JWS",
        resign: false,
      },
    ],
  };
  const result = await runScenario(profile, hostile, { compare: false });
  const events = required(required(result[0]).trace).events;
  expect(
    events.some(
      (e) => e.agent === "service-agent" && e.check === "integrity" && e.verdict === "fail",
    ),
  ).toBe(true);
  expect(events.filter((e) => e.agent === "service-agent").at(-1)?.outcome).toBe("refuse");
});

it("resumes a scripted principal's approval through the executor", async () => {
  const { profile, scenario } = loaded();
  const modified = structuredClone(scenario);
  modified.branches = [];
  modified.expect = [];
  const mandate = required(modified.mandates.find((m) => m.agent === "person-agent"));
  const rule = required(mandate.autonomous.find((r) => r.action === "distribute"));
  mandate.autonomous = mandate.autonomous.filter((r) => r !== rule);
  mandate.withApproval = [rule];
  modified.script.splice(4, 0, {
    id: "principal-approves",
    agent: "person-agent",
    type: "approve",
    decision: "approve",
    note: "Share this contact code for the named query.",
    evidence: [],
  });
  const result = await runScenario(profile, modified, { compare: false });
  const events = required(required(result[0]).trace).events;
  expect(events.some((e) => e.kind === "ask-principal" && e.reason === undefined)).toBe(true);
  expect(events.some((e) => e.kind === "message-out" && e.packet?.kind === "deliver")).toBe(true);
});
