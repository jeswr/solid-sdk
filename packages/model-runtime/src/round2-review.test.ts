// AUTHORED-BY Codex GPT-6
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  defineModel,
  type ManifestEntity,
  ManifestError,
  type ManifestField,
  type ModelManifest,
  validateManifest,
} from "./index.js";

const EX = "https://ex.test/";
const RES = `${EX}doc`;
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const field = (extra: Partial<ManifestField> = {}): ManifestField => ({
  name: "val",
  predicate: `${EX}p`,
  aliasPredicates: [`${EX}oldP`],
  kind: "literal",
  datatype: "xsd:string",
  maxCount: 1,
  ...extra,
});
const flat = (name = "Thing", fields = [field()]): ManifestEntity => ({
  name,
  typeIris: [`${EX}${name}`],
  subject: { convention: "hash-it" },
  fields,
});
const manifest = (entities: ModelManifest["entities"] = [flat()]): ModelManifest => ({
  manifestVersion: 1,
  runtime: { name: "@jeswr/model-runtime", major: 0 },
  prefixes: {},
  entities,
});
const tree = (fields = [field()]): ModelManifest["entities"][number] => ({
  name: "Tree",
  kind: "composite",
  root: "root",
  nodes: [
    {
      name: "root",
      typeIris: [`${EX}Root`],
      fragment: "it",
      fields: [
        {
          name: "child",
          predicate: `${EX}child`,
          kind: "nested",
          node: "child",
          guards: { requiredFailClosed: true },
        },
      ],
    },
    { name: "child", typeIris: [`${EX}Child`], fragment: "child", fields },
  ],
});
const store = (body = "") => new Store(new Parser().parse(`<${RES}#it> a <${EX}Thing> . ${body}`));

describe("M1: defaults cannot supply required raw presence or exceed maxCount zero", () => {
  for (const composite of [false, true]) {
    for (const required of [false, true]) {
      it(`ignores absent read defaults (composite=${composite}, required=${required})`, () => {
        const f = field({
          default: "fallback",
          ...(required ? { minCount: 1, guards: { requiredFailClosed: true } } : { maxCount: 0 }),
        });
        const entity = defineModel(manifest(composite ? [tree([f])] : [flat("Thing", [f])]))
          .entities[composite ? "Tree" : "Thing"];
        if (!entity) throw new Error("missing entity");
        const ds = composite
          ? new Store(
              new Parser().parse(
                `<${RES}#it> a <${EX}Root>; <${EX}child> <${EX}child> . <${EX}child> a <${EX}Child> .`,
              ),
            )
          : store();
        expect(entity.parse(RES, ds)).toEqual(required ? undefined : {});
      });
    }
  }
  it("uses raw canonical and alias presence before defaulting", () => {
    const d = defineModel(manifest([flat("Thing", [field({ default: "fallback" })])])).entities
      .Thing;
    const must = defineModel(
      manifest([
        flat("Thing", [field({ default: "fallback", guards: { requiredFailClosed: true } })]),
      ]),
    ).entities.Thing;
    if (!d || !must) throw new Error("missing entity");
    expect(d.parse(RES, store())).toEqual({ val: "fallback" });
    for (const predicate of [`${EX}p`, `${EX}oldP`]) {
      const valid = store(`<${RES}#it> <${predicate}> "present" .`);
      expect(must.parse(RES, valid)).toEqual({ val: "present" });
      const malformed = store(`<${RES}#it> <${predicate}> <${EX}notLiteral> .`);
      expect(d.parse(RES, malformed)).toEqual({});
      expect(must.parse(RES, malformed)).toBeUndefined();
    }
  });
});

describe("M2: structural predicates cannot be claimed by fields", () => {
  for (const slot of ["canonical", "alias"] as const) {
    for (const operation of ["build", "setter", "serialization"] as const) {
      it(`rejects rdf:type in a ${slot} field before ${operation} can remove or migrate types`, async () => {
        const m = manifest([
          flat("Thing", [
            field(slot === "canonical" ? { predicate: TYPE } : { aliasPredicates: [TYPE] }),
          ]),
        ]);
        // Defining the model must fail before any operation can damage the structural triple.
        await expect(async () => {
          const e = defineModel(m).entities.Thing;
          if (!e) throw new Error("missing entity");
          if (operation === "build") e.build(RES, {});
          if (operation === "setter") {
            const w = new e.Wrapper(`${RES}#it`, store(), DataFactory) as unknown as Record<
              string,
              unknown
            >;
            w.val = undefined;
          }
          if (operation === "serialization") await e.storeToTurtle(store());
        }).rejects.toThrow(ManifestError);
      });
    }
    it(`reserves nested link predicates from ${slot} flat fields across the manifest`, () => {
      const f = field(
        slot === "canonical" ? { predicate: `${EX}child` } : { aliasPredicates: [`${EX}child`] },
      );
      expect(() => validateManifest(manifest([tree([]), flat("Other", [f])]))).toThrow(
        ManifestError,
      );
    });
  }
  it("rejects rdf:type as a nested link predicate", () => {
    const t = tree([]);
    if (t.kind !== "composite" || !t.nodes[0]?.fields[0]) throw new Error("missing root");
    t.nodes[0].fields[0].predicate = TYPE;
    expect(() => validateManifest(manifest([t]))).toThrow(ManifestError);
  });
});

describe("M3: type alias ownership spans flat entities and composite nodes", () => {
  for (const order of [false, true]) {
    for (const collision of ["canonical", "alias", "nodeCanonical", "nodeAlias"] as const) {
      it(`rejects ${collision} ownership collision (reversed=${order})`, () => {
        const a = flat("A", []);
        a.aliasTypeIris = [`${EX}Legacy`];
        const b = collision.startsWith("node") ? tree([]) : flat("B", []);
        const owner = b.kind === "composite" ? b.nodes[1] : b;
        if (!owner) throw new Error("missing owner");
        if (collision.endsWith("Canonical") || collision === "canonical")
          owner.typeIris = [`${EX}Legacy`];
        else owner.aliasTypeIris = [`${EX}Legacy`];
        expect(() => validateManifest(manifest(order ? [b, a] : [a, b]))).toThrow(ManifestError);
      });
    }
  }
});

describe("M6: composite links preserve exact safe RDF identity", () => {
  for (const target of ["https://EX.test:443/child", "https://ex.test/café"]) {
    it(`follows the exact populated subject ${target}`, () => {
      const e = defineModel(manifest([tree([field({ guards: { requiredFailClosed: true } })])]))
        .entities.Tree;
      if (!e) throw new Error("missing tree");
      const ds = new Store(
        new Parser().parse(
          `<${RES}#it> a <${EX}Root>; <${EX}child> <${target}> . <${target}> a <${EX}Child>; <${EX}p> "real" . <${new URL(target).href}> a <${EX}Child>; <${EX}p> "decoy" .`,
        ),
      );
      expect(e.parse(RES, ds)).toEqual({ val: "real" });
    });
  }
  for (const target of [
    "https://ex.test/a|b",
    "https://ex.test/?{x}",
    "https://ex.test/a b",
    "urn:child",
    "relative",
  ]) {
    it(`rejects unsafe or non-http linked subject ${target}`, () => {
      const e = defineModel(manifest([tree([])])).entities.Tree;
      const ds = new Store(new Parser().parse(`<${RES}#it> a <${EX}Root> .`));
      ds.addQuad(
        DataFactory.namedNode(`${RES}#it`),
        DataFactory.namedNode(`${EX}child`),
        DataFactory.namedNode(target),
      );
      ds.addQuad(
        DataFactory.namedNode(target),
        DataFactory.namedNode(TYPE),
        DataFactory.namedNode(`${EX}Child`),
      );
      expect(e?.parse(RES, ds)).toBeUndefined();
    });
  }
});
