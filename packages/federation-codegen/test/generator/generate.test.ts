// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8
// AUTHORED-BY Codex GPT-6
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Parser } from "n3";
import { describe, expect, it } from "vitest";
import { type CodegenConfig, type GenerateInput, generateModel } from "../../src/index.js";
import { serializeCanonicalTurtle } from "../../src/rdf.js";
import { flat } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = join(here, "..", "..", "..", "solid-bookmark");
const generatedDir = join(packageDir, "src", "generated");

function readExample(name: string): string {
  return readFileSync(join(packageDir, name), "utf8");
}
function readGenerated(name: string): string {
  return readFileSync(join(generatedDir, name), "utf8");
}

function input(): GenerateInput {
  return {
    ontologyTtl: readExample("bookmark.ttl"),
    shapesTtl: readExample("bookmark.shacl.ttl"),
    config: JSON.parse(readExample("codegen.config.json")) as CodegenConfig,
  };
}

/** Re-serialise a Turtle document with its triples in REVERSED order (N-Triples). */
function permute(ttl: string): string {
  const quads = new Parser().parse(ttl).reverse();
  return serializeCanonicalTurtle(quads, {}, "N-Triples");
}

describe("generateModel — pilot generation", () => {
  it("admits the package (the clean pilot) with no errors", () => {
    const result = generateModel(input());
    expect(result.admission.ok).toBe(true);
    expect(result.admission.violations.filter((v) => v.severity === "error")).toEqual([]);
  });

  it("produces exactly the committed package artifacts (no drift)", () => {
    const { artifacts } = generateModel(input());
    for (const name of [
      "shapes.ttl",
      "model.json",
      "model.js",
      "model.d.ts",
      "codegen-manifest.json",
    ]) {
      expect(artifacts[name], `${name} drifted from the committed package`).toBe(
        readGenerated(name),
      );
    }
  });

  it("the manifest has one Bookmark entity with the 8 shape fields", () => {
    const { manifest } = generateModel(input());
    expect(manifest.entities).toHaveLength(1);
    const entity = flat(manifest.entities[0]);
    expect(entity.name).toBe("Bookmark");
    expect(entity.fields.map((f) => f.name).sort()).toEqual([
      "archived",
      "created",
      "description",
      "modified",
      "notes",
      "tags",
      "title",
      "url",
    ]);
  });
});

describe("determinism (design §5)", () => {
  it("two builds are byte-identical", () => {
    const a = generateModel(input()).artifacts;
    const b = generateModel(input()).artifacts;
    expect(a).toEqual(b);
  });

  it("shapes.ttl + model.json are byte-identical under permuted input triple order", () => {
    const base = generateModel(input());
    const permuted = generateModel({
      ...input(),
      ontologyTtl: permute(input().ontologyTtl),
      shapesTtl: permute(input().shapesTtl),
    });
    expect(permuted.artifacts["shapes.ttl"]).toBe(base.artifacts["shapes.ttl"]);
    expect(permuted.artifacts["model.json"]).toBe(base.artifacts["model.json"]);
    expect(permuted.artifacts["model.d.ts"]).toBe(base.artifacts["model.d.ts"]);
  });
});

describe("the generated model round-trips a bookmark", () => {
  it("build → serialize → parse a fully-populated bookmark", async () => {
    const { manifest } = generateModel(input());
    // Sanity: the model.js shim is importable and produces a working model.
    const model = (await import("../../../solid-bookmark/src/generated/model.js")).default;
    const bm = model.entities.Bookmark;
    const res = "http://localhost:3000/alice/bm/x";
    const store = bm.build(res, {
      url: "https://example.org/a",
      title: "T",
      tags: ["z", "a"],
      archived: true,
    });
    // The store carries the manifest's rdf:type.
    expect(
      store.getQuads(
        bm.subject(res),
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        flat(manifest.entities[0]).typeIris[0] ?? "",
        null,
      ),
    ).toHaveLength(1);
    const back = bm.parse(res, store);
    expect(back?.url).toBe("https://example.org/a");
    expect(back?.tags).toEqual(["a", "z"]);
    expect(back?.archived).toBe(true);
  });
});
