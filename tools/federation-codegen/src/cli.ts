// AUTHORED-BY Codex GPT-5

import { resolve } from "node:path";
import { generatePackage } from "./generate.ts";

interface CliOptions {
  ontology?: string;
  out?: string;
  packageName?: string;
  shapes?: string;
}

function parseArguments(arguments_: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${flag ?? "argument"}`);
    switch (flag) {
      case "--ontology":
        options.ontology = value;
        break;
      case "--shapes":
        options.shapes = value;
        break;
      case "--out":
        options.out = value;
        break;
      case "--package-name":
        options.packageName = value;
        break;
      default:
        throw new Error(`Unknown option ${flag}`);
    }
  }
  return options;
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined) throw new Error(`Missing required ${flag}`);
  return value;
}

const options = parseArguments(process.argv.slice(2));
await generatePackage({
  ontologyPath: resolve(required(options.ontology, "--ontology")),
  shapesPath: resolve(required(options.shapes, "--shapes")),
  outDir: resolve(required(options.out, "--out")),
  packageName: required(options.packageName, "--package-name"),
});
