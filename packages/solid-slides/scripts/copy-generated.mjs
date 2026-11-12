// AUTHORED-BY Codex (GPT-6.1 Sol)
import { copyFileSync, mkdirSync } from "node:fs";

const target = new URL("../dist/generated/", import.meta.url);
mkdirSync(target, { recursive: true });
for (const file of ["model.js", "model.d.ts"])
  copyFileSync(new URL(`../src/generated/${file}`, import.meta.url), new URL(file, target));
