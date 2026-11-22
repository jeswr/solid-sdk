#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readdirSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath } from "url";
import { availableAdapters } from "../dist/derive/adapters/index.js";
import { ProofCache } from "../dist/derive/cache.js";
import { loadCase } from "../dist/engine/load.js";
import { runScenario } from "../dist/engine/run.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const registry = await availableAdapters();
const proofCache = new ProofCache(join(root, "proofs"));
for (const file of readdirSync(join(root, "scenarios"))
  .filter((f) => f.endsWith(".json"))
  .sort()) {
  const { profile, scenario } = loadCase(root, file.slice(0, -5));
  if (
    !scenario.proofCredentials.length &&
    !scenario.branches.some(
      (b) => Array.isArray(b.change.proofCredentials) && b.change.proofCredentials.length,
    )
  )
    continue;
  const results = await runScenario(profile, scenario, {
    registry,
    proofCache,
    generateProofs: true,
    compare: false,
  });
  for (const result of results) {
    if (result.usedTestDouble) throw new Error("Test doubles cannot populate the proof cache.");
    if (result.blocked) console.log(`${scenario.id}/${result.path}: ${result.blocked}`);
  }
}
