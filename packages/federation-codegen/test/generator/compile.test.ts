// AUTHORED-BY Claude Opus 4.8
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type CodegenConfig,
  compileManifest,
  isCompositeConfig,
  parseShapes,
} from "../../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const exampleDir = join(here, "..", "..", "examples", "bookmark");
const baseConfig = JSON.parse(
  readFileSync(join(exampleDir, "codegen.config.json"), "utf8"),
) as CodegenConfig;
const shapes = parseShapes(
  readFileSync(join(exampleDir, "bookmark.shacl.ttl"), "utf8"),
  baseConfig.shapesBase,
);

describe("compileManifest — config validation", () => {
  it("rejects a config with no entity for a shape's target class", () => {
    const config: CodegenConfig = { ...baseConfig, entities: [] };
    expect(() => compileManifest(shapes, config)).toThrow(/no codegen config entity/);
  });

  it("rejects a config that configures a non-existent field (untraceable guard)", () => {
    const config: CodegenConfig = structuredClone(baseConfig);
    const entity = config.entities[0];
    if (!entity || isCompositeConfig(entity)) throw new Error("no flat entity in base config");
    entity.fields = { nope: { emptyStringDrop: true } };
    expect(() => compileManifest(shapes, config)).toThrow(/configures unknown field "nope"/);
  });

  it("rejects a non-identifier entity name (model.d.ts injection guard)", () => {
    const config: CodegenConfig = structuredClone(baseConfig);
    const entity = config.entities[0];
    if (!entity || isCompositeConfig(entity)) throw new Error("no flat entity in base config");
    entity.name = 'Evil"; type X = ';
    expect(() => compileManifest(shapes, config)).toThrow(/not a valid identifier/);
  });
});
