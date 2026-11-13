// AUTHORED-BY Claude Opus 5.5
import { copyFileSync, mkdirSync } from "node:fs";

// tsc consumes the generated declarations but does not copy their JS sibling.
const output = new URL("../dist/generated/", import.meta.url);
mkdirSync(output, { recursive: true });
for (const name of ["model.js", "model.d.ts"]) {
  copyFileSync(new URL(`../src/generated/${name}`, import.meta.url), new URL(name, output));
}
