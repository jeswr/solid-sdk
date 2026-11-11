// AUTHORED-BY Codex GPT-6.1-Sol
import { copyFileSync, mkdirSync } from "node:fs";

// tsc reads the generated declarations; ship their fixed-template JS sibling too.
const output = new URL("../dist/generated/", import.meta.url);
mkdirSync(output, { recursive: true });
for (const name of ["model.js", "model.d.ts"]) {
  copyFileSync(new URL(`../src/generated/${name}`, import.meta.url), new URL(name, output));
}
