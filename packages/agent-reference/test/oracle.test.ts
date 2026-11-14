// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readdirSync, readFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";

const root = join(import.meta.dirname, "..");

it("preserves every pre-RDF decision, reason and check position in every executable path", async () => {
  const saved = JSON.parse(readFileSync(join(root, "test/oracle/pre-rdf.json"), "utf8"));
  const actual: Record<string, unknown> = {};
  for (const file of readdirSync(join(root, "scenarios"))
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const id = file.slice(0, -5);
    const { profile, scenario } = loadCase(root, id);
    for (const path of await runScenario(profile, scenario)) {
      if (!path.trace) continue;
      actual[`${id}/${path.path}`] = path.trace.events.map((event) => ({
        agent: event.agent,
        part: event.part,
        kind: event.kind,
        ...(event.check === undefined ? {} : { check: event.check }),
        ...(event.verdict === undefined ? {} : { verdict: event.verdict }),
        ...(event.reason === undefined ? {} : { reason: event.reason }),
        ...(event.outcome === undefined ? {} : { outcome: event.outcome }),
      }));
    }
  }
  expect(Object.keys(actual)).toHaveLength(161);
  expect(actual).toEqual(saved);
}, 600_000);
