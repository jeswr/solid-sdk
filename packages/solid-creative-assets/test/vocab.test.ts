// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, it } from "vitest";
import model from "../src/generated/model.js";
import {
  CLASSES,
  FRAGMENTS,
  LEGACY_CLASSES,
  PREFIXES,
  PROV,
  prov,
  RDF_TYPE,
  SCHEMA,
  schema,
} from "../src/vocab.js";

const entities = model.manifest.entities as {
  name: string;
  typeIris: string[];
  aliasTypeIris?: string[];
}[];

describe("vocabulary constants match the generated manifest", () => {
  const byName = {
    image: "Image",
    video: "Video",
    model3d: "Model3D",
    creativeWork: "CreativeWork",
    collection: "Collection",
    aiModel: "AiModel",
    setting: "Setting",
    run: "Run",
  } as const;

  for (const [key, entityName] of Object.entries(byName)) {
    it(`${key} is the canonical type of ${entityName}`, () => {
      const entity = entities.find((e) => e.name === entityName);
      expect(entity?.typeIris).toEqual([CLASSES[key as keyof typeof CLASSES]]);
      const legacy = LEGACY_CLASSES[key as keyof typeof LEGACY_CLASSES];
      expect(entity?.aliasTypeIris).toEqual(legacy === undefined ? undefined : [legacy]);
    });
  }

  it("covers every generated entity", () => {
    expect(entities.map((e) => e.name).sort()).toEqual(Object.values(byName).sort());
  });

  it("uses only schema.org and PROV-O terms in every IRI of the generated manifest", () => {
    const all = model.manifest.entities as unknown as {
      typeIris: string[];
      aliasTypeIris?: string[];
      fields: { predicate: string; aliasPredicates?: string[] }[];
    }[];
    const allowed = [SCHEMA, PROV];
    let checked = 0;
    for (const entity of all) {
      for (const iri of [...entity.typeIris, ...entity.fields.map((f) => f.predicate)]) {
        expect(
          allowed.some((ns) => iri.startsWith(ns)),
          iri,
        ).toBe(true);
        checked++;
      }
      for (const alias of entity.aliasTypeIris ?? []) {
        expect(alias.startsWith("http://schema.org/"), alias).toBe(true);
      }
      for (const field of entity.fields) expect(field.aliasPredicates).toBeUndefined();
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("builds terms in the suite-vocab namespaces", () => {
    expect(SCHEMA).toBe("https://schema.org/");
    expect(schema("3DModel")).toBe("https://schema.org/3DModel");
    expect(prov("Activity")).toBe("http://www.w3.org/ns/prov#Activity");
    expect(RDF_TYPE).toBe("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
    for (const ns of Object.values(PREFIXES)) expect(ns).toMatch(/^https?:\/\/.+[#/]$/);
  });

  it("names the hash-IRI fragments of a description document", () => {
    expect(FRAGMENTS).toEqual({
      asset: "it",
      run: "run",
      prompt: "prompt",
      model: "model",
      thumbnail: "thumbnail",
      settingPrefix: "setting-",
    });
  });
});
