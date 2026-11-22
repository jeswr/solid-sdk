#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6
// Compile with: pnpm exec tsc -p tsconfig.build.json
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { deepStrictEqual } from "assert";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { spawnSync } from "child_process";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { performance } from "perf_hooks";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath } from "url";

const args = process.argv.slice(2);
const option = (name, fallback) =>
  args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
const iterations = Number(option("--iterations", "1"));
if (!Number.isSafeInteger(iterations) || iterations < 1)
  throw new Error("--iterations must be a positive integer");
const output = option("--output", undefined);
const comparison = option("--compare", undefined);
if (args.includes("--cpu-prof")) {
  const directory = option("--cpu-prof-dir", "/tmp/agent-reference-profile");
  mkdirSync(directory, { recursive: true });
  const child = spawnSync(
    process.execPath,
    [
      "--cpu-prof",
      `--cpu-prof-dir=${directory}`,
      fileURLToPath(import.meta.url),
      ...args.filter((arg) => arg !== "--cpu-prof"),
    ],
    { stdio: "inherit" },
  );
  process.exit(child.status ?? 1);
}
// tsc emits the TypeScript sources; the committed codegen runtime is JavaScript.
// Copy that runtime without invoking the build's trace-generation steps.
cpSync(
  new URL("../src/generated/", import.meta.url),
  new URL("../dist/generated/", import.meta.url),
  { recursive: true },
);
const { loadCase } = await import("../dist/engine/load.js");
const { runScenario } = await import("../dist/engine/run.js");
const { decisionsOf } = await import("./oracle-snapshot.mjs");
const root = fileURLToPath(new URL("../", import.meta.url));
const snapshots = [];
const expected = comparison ? JSON.parse(readFileSync(comparison, "utf8")) : undefined;
for (let iteration = 1; iteration <= iterations; iteration++) {
  for (const configuration of [undefined, "authenticity-data-integrity"]) {
    const { profile, scenario } = loadCase(root, "mortgage-main");
    // --main-only isolates the main journey; the default includes all refusal branches.
    if (args.includes("--main-only")) scenario.branches = [];
    const start = performance.now();
    const paths = await runScenario(profile, scenario, { configuration });
    const ms = performance.now() - start;
    console.log(
      JSON.stringify({
        iteration,
        configuration: configuration ?? "baseline",
        paths: paths.length,
        ms: Math.round(ms),
      }),
    );
    if (paths.some((path) => path.blocked || !path.trace))
      throw new Error("Journey did not execute");
    if (expected) {
      const before = expected.find(
        (entry) => entry.configuration === (configuration ?? "baseline"),
      );
      if (!before) throw new Error("Missing comparison configuration");
      deepStrictEqual(
        paths.map((path) => path.path),
        before.paths.map((path) => path.path),
      );
      let packets = 0;
      for (const path of paths) {
        const original = before.paths.find((entry) => entry.path === path.path);
        deepStrictEqual(decisionsOf(path.trace), decisionsOf(original.trace));
        const bytes = (trace) =>
          trace.events.flatMap(({ packet }) =>
            packet?.jsonld
              ? [{ jsonld: packet.jsonld, rdf: packet.rdf, attachments: packet.attachments }]
              : [],
          );
        const actual = bytes(path.trace);
        deepStrictEqual(actual, bytes(original.trace));
        packets += actual.length;
      }
      console.log(
        JSON.stringify({
          configuration: configuration ?? "baseline",
          identicalPackets: packets,
          decisions: "unchanged",
        }),
      );
    }
    if (output) snapshots.push({ iteration, configuration: configuration ?? "baseline", paths });
  }
}
if (output) writeFileSync(output, JSON.stringify(snapshots));
