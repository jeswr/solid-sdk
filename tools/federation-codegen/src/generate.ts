// AUTHORED-BY Codex GPT-5

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  emitIndex,
  emitModel,
  emitPackageJson,
  emitReadme,
  emitTsconfig,
  emitVocab,
} from "./emit.ts";
import type { GenerateOptions } from "./model.ts";
import { parseSector } from "./parse.ts";

export const GENERATED_FILES = [
  "README.md",
  "ontology.ttl",
  "package.json",
  "shapes.ttl",
  "src/index.ts",
  "src/model.ts",
  "src/vocab.ts",
  "tsconfig.json",
] as const;

export async function generatePackage(options: GenerateOptions): Promise<void> {
  const model = await parseSector(options.ontologyPath, options.shapesPath);
  const [ontology, shapes] = await Promise.all([
    readFile(options.ontologyPath, "utf8"),
    readFile(options.shapesPath, "utf8"),
  ]);
  await mkdir(join(options.outDir, "src"), { recursive: true });

  const files: Readonly<Record<(typeof GENERATED_FILES)[number], string>> = {
    "README.md": emitReadme(options.ontologyPath, options.shapesPath),
    "ontology.ttl": ontology,
    "package.json": emitPackageJson(options.packageName),
    "shapes.ttl": shapes,
    "src/index.ts": emitIndex(),
    "src/model.ts": emitModel(model),
    "src/vocab.ts": emitVocab(model),
    "tsconfig.json": emitTsconfig(),
  };

  await Promise.all(
    GENERATED_FILES.map((file) => writeFile(join(options.outDir, file), files[file], "utf8")),
  );
}
