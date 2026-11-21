#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdirSync, readFileSync, writeFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath } from "url";

export function decisionsOf(trace) {
  return trace.events.map((event) => ({
    agent: event.agent,
    part: event.part,
    kind: event.kind,
    ...(event.check === undefined ? {} : { check: event.check }),
    ...(event.verdict === undefined ? {} : { verdict: event.verdict }),
    ...(event.reason === undefined ? {} : { reason: event.reason }),
    ...(event.outcome === undefined ? {} : { outcome: event.outcome }),
  }));
}

export function snapshot(root) {
  const manifest = JSON.parse(readFileSync(new URL("scenario-runs.json", root), "utf8"));
  const oracle = {};
  for (const row of manifest.paths) {
    // The pre-RDF oracle covers the default configuration and predates the ZK proof methods.
    if (row.status === "blocked" || row.configuration) continue;
    // Only the branch changes and required methods matter here, independently of the envelope.
    const { branches, requiredMethods } = JSON.parse(
      readFileSync(new URL(`scenarios/${row.scenario}.json`, root), "utf8"),
    );
    const branch = branches.find((branch) => branch.id === row.path);
    const methods = branch?.change.requiredMethods ?? requiredMethods ?? [];
    if (methods.some((method) => method !== "sparq-aggregate/1")) continue;
    oracle[`${row.scenario}/${row.path}`] = decisionsOf(
      JSON.parse(readFileSync(new URL(`traces/${row.trace}`, root), "utf8")),
    );
  }
  return oracle;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL("../", import.meta.url);
  const output = new URL(process.argv[2] ?? "test/oracle/pre-rdf.json", root);
  mkdirSync(new URL(".", output), { recursive: true });
  const result = snapshot(root);
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Captured ${Object.keys(result).length} executable paths`);
}
