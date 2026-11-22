#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.2 Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readdirSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath } from "url";
import { readCaseGraph } from "../dist/engine/load.js";

let checked = 0;
let failed = 0;
for (const [directory, kind] of [
  ["profiles", "profile"],
  ["scenarios", "scenario"],
]) {
  const root = new URL(`../${directory}/`, import.meta.url);
  for (const file of readdirSync(root)
    .filter((entry) => entry.endsWith(".json"))
    .sort()) {
    try {
      const { dataset, root: id } = await readCaseGraph(fileURLToPath(new URL(file, root)));
      if (id !== `urn:${kind}:${file.slice(0, -5)}` || !dataset.countQuads(id, null, null, null))
        throw new Error(`${directory}/${file}: fixture root does not match the file name`);
      checked++;
    } catch (error) {
      console.error(error.message);
      failed++;
    }
  }
}
console.log(`Checked ${checked} JSON-LD fixtures, ${failed} failed`);
if (failed) process.exitCode = 1;
