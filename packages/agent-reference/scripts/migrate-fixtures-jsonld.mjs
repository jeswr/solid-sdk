#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.2 Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readdirSync, readFileSync, writeFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath } from "url";
import { digestOf } from "../dist/core/canonical.js";
import { loadProfile, loadScenario } from "../dist/engine/load.js";
import { SCENARIO_CONTEXT } from "../dist/wire/store-contexts.js";

const root = new URL("../", import.meta.url);
const snapshot = new URL("test/fixtures/fixture-digests.json", root);
const groups = [
  ["profiles", loadProfile, "agent-profile"],
  ["scenarios", loadScenario, "agent-scenario"],
];

function fixtures(directory) {
  return readdirSync(new URL(`${directory}/`, root))
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => `${directory}/${file}`);
}

function engineDigests() {
  return Object.fromEntries(
    groups.flatMap(([directory, load]) =>
      fixtures(directory).map((file) => [file, digestOf(load(fileURLToPath(new URL(file, root))))]),
    ),
  );
}

function migratedText(path, schema, source, document) {
  const firstLine = /^(\s*\{)(\r?\n)([ \t]+)"/.exec(source);
  const oldSchema = new RegExp(`^(\\s*?"schema"\\s*:\\s*")${schema}/0\\.1(")`, "gm");
  if (
    Object.hasOwn(document, "@context") ||
    document.schema !== `${schema}/0.1` ||
    !firstLine ||
    [...source.matchAll(oldSchema)].length !== 1
  )
    throw new Error(`${path}: cannot migrate the envelope without reformatting`);
  const [, start, newline, indent] = firstLine;
  return source
    .replace(oldSchema, `$1${schema}/0.2$2`)
    .replace(
      firstLine[0],
      `${start}${newline}${indent}"@context": "${SCENARIO_CONTEXT}",${newline}${indent}"`,
    );
}

function fixtureEdits() {
  const edits = [];
  for (const [directory, , schema] of groups)
    for (const path of fixtures(directory)) {
      const url = new URL(path, root);
      const source = readFileSync(url, "utf8");
      const document = JSON.parse(source);
      if (
        Object.keys(document)[0] === "@context" &&
        document["@context"] === SCENARIO_CONTEXT &&
        document.schema === `${schema}/0.2`
      )
        continue;
      edits.push([path, url, migratedText(path, schema, source, document)]);
    }
  return edits;
}

export function checkMigration() {
  const edits = fixtureEdits();
  if (edits.length)
    throw new Error(`Unmigrated fixtures: ${edits.map(([path]) => path).join(", ")}`);
  const { digests: expected } = JSON.parse(readFileSync(snapshot, "utf8"));
  const digests = engineDigests();
  const changed = [...new Set([...Object.keys(expected), ...Object.keys(digests)])].filter(
    (path) => expected[path] !== digests[path],
  );
  if (changed.length) throw new Error(`Changed fixture digests: ${changed.join(", ")}`);
  return Object.keys(digests).length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flag = process.argv[2];
  if (flag === "--snapshot") {
    const digests = engineDigests();
    writeFileSync(
      snapshot,
      `${JSON.stringify({ "x-authored-by": "AUTHORED-BY Codex GPT-6.2 Sol", digests }, null, 2)}\n`,
      { flag: "wx" },
    );
    console.log(`Captured ${Object.keys(digests).length} fixture digests`);
  } else if (flag === "--check") {
    console.log(`Verified ${checkMigration()} fixture digests`);
  } else if (flag === undefined) {
    const edits = fixtureEdits();
    for (const [, url, text] of edits) writeFileSync(url, text);
    console.log(`Migrated ${edits.length} fixtures`);
  } else throw new Error(`Unknown option ${flag}`);
}
