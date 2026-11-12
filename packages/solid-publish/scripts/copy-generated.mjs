// AUTHORED-BY Codex (GPT-6.1 Sol)
import { copyFileSync, mkdirSync } from "node:fs";

const destination = new URL("../dist/generated/", import.meta.url);
mkdirSync(destination, { recursive: true });
for (const name of ["model.js", "model.d.ts"])
  copyFileSync(new URL(`../src/generated/${name}`, import.meta.url), new URL(name, destination));
