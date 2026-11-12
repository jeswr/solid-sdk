// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  type CompositeManifestEntity,
  createParseScope,
  defineModel,
  type ManifestEntity,
  type ModelManifest,
  type ParseScope,
} from "./index.js";

const EX = "https://scope.test/";
const DOC = `${EX}doc`;
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const SUBCLASS = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const manifest = (...entities: ModelManifest["entities"]): ModelManifest => ({
  manifestVersion: 1,
  runtime: { name: "@jeswr/model-runtime", major: 0 },
  prefixes: {},
  entities,
});
const shape = (typeIris = [`${EX}Target`]): ManifestEntity => ({
  name: "Thing",
  typeIris,
  subject: { convention: "self" },
  fields: [],
});
const entity = (owner: ManifestEntity | CompositeManifestEntity = shape()) => {
  const result = defineModel(manifest(owner)).entities[owner.name];
  if (!result) throw new Error("missing entity");
  return result;
};
const store = (body: string): Store =>
  new Store(
    new Parser().parse(
      `@prefix ex: <${EX}> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . ${body}`,
    ),
  );

/** Count yielded raw quads, including duplicate terms across graphs. */
function counting(store: Store, lazy = true) {
  const reads = { types: 0, subclasses: 0 };
  const count = (predicate: string) => {
    if (predicate === TYPE) reads.types++;
    if (predicate === SUBCLASS) reads.subclasses++;
  };
  const dataset: DatasetCore = new Proxy(store, {
    get(target, key) {
      if (key === "readQuads") {
        if (!lazy) return undefined;
        return function* (...args: Parameters<Store["readQuads"]>) {
          for (const quad of target.readQuads(...args)) {
            count(quad.predicate.value);
            yield quad;
          }
        };
      }
      if (key === "match")
        return (...args: Parameters<Store["match"]>) => {
          const matches = target.match(...args);
          for (const quad of matches) count(quad.predicate.value);
          return matches;
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { dataset, reads };
}

function chain(length: number, subjects: number, reachesTarget: boolean): Store {
  return store(
    Array.from({ length: subjects }, (_, i) => `ex:s${i} a ex:c0 .`).join("\n") +
      Array.from(
        { length },
        (_, i) =>
          `ex:c${i} rdfs:subClassOf ex:${reachesTarget && i === length - 1 ? "Target" : `c${i + 1}`} .`,
      ).join("\n"),
  );
}

describe("parse scope scan costs", () => {
  it.each([
    false,
    true,
  ])("walks a 10,000-edge chain once for 2,000 subjects (reaches=%s)", (reaches) => {
    const e = entity();
    const { dataset, reads } = counting(chain(10_000, 2000, reaches));
    const scope = createParseScope(dataset);
    const start = performance.now();
    let recognised = 0;
    for (let i = 0; i < 2000; i++)
      if (e.parse(`${EX}s${i}`, dataset, { scope }) !== undefined) recognised++;
    const elapsed = performance.now() - start;
    expect(recognised).toBe(reaches ? 2000 : 0);
    expect(reads).toEqual({ types: 2000, subclasses: 10_000 });
    expect(scope.exhausted).toBe(false);
    expect(elapsed).toBeLessThan(1000);
  });

  it("preserves the no-scope 10,000-read limit, independently for each call", () => {
    const e = entity();
    const { dataset, reads } = counting(chain(10_000, 2, true));
    expect(e.parse(`${EX}s0`, dataset)).toBeUndefined();
    expect(e.parse(`${EX}s1`, dataset, {})).toBeUndefined();
    expect(reads).toEqual({ types: 2, subclasses: 20_000 });
    expect(e.parse(`${EX}s0`, dataset, { scope: createParseScope(dataset) })).toEqual({});
  });

  it("preserves successful no-scope recognition and Wrapper.isInstance", () => {
    const e = entity();
    const ds = chain(9998, 1, true);
    expect(e.parse(`${EX}s0`, ds)).toEqual({});
    expect(new e.Wrapper(`${EX}s0`, ds, DataFactory).isInstance).toBe(true);
  });

  it.each([true, false])("supports streaming and DatasetCore-only datasets (lazy=%s)", (lazy) => {
    const e = entity();
    const { dataset, reads } = counting(chain(3, 2, true), lazy);
    const scope = createParseScope(dataset);
    expect(e.parse(`${EX}s0`, dataset, { scope })).toEqual({});
    expect(e.parse(`${EX}s1`, dataset, { scope })).toEqual({});
    expect(reads).toEqual({ types: 2, subclasses: 3 });
  });
});

describe("parse scope budgets and binding", () => {
  it("shares one budget across subjects, then rejects even cached and direct membership", () => {
    const e = entity();
    const ds = chain(2, 3, true);
    ds.addQuad(
      DataFactory.namedNode(DOC),
      DataFactory.namedNode(TYPE),
      DataFactory.namedNode(`${EX}Target`),
    );
    const { dataset, reads } = counting(ds);
    const scope = createParseScope(dataset, { maxClassReads: 4 });
    expect(e.parse(`${EX}s0`, dataset, { scope })).toEqual({});
    expect(e.parse(`${EX}s1`, dataset, { scope })).toEqual({});
    expect(scope.exhausted).toBe(false);
    expect(e.parse(`${EX}s2`, dataset, { scope })).toBeUndefined();
    expect(scope.exhausted).toBe(true);
    const before = { ...reads };
    expect(e.parse(`${EX}s0`, dataset, { scope })).toBeUndefined();
    expect(e.parse(DOC, dataset, { scope })).toBeUndefined();
    expect(reads).toEqual(before);
    expect(e.parse(DOC, dataset)).toEqual({});
  });

  it("does not memoise a budget-truncated negative as a complete walk", () => {
    const e = entity();
    const ds = chain(3, 2, true);
    const scope = createParseScope(ds, { maxClassReads: 2 });
    expect(e.parse(`${EX}s0`, ds, { scope })).toBeUndefined();
    expect(scope.exhausted).toBe(true);
    expect(e.parse(`${EX}s1`, ds, { scope })).toBeUndefined();
    expect(e.parse(`${EX}s1`, ds, { scope: createParseScope(ds) })).toEqual({});
  });

  it.each([0, 1, 1_000_000])("accepts the budget boundary %s", (maxClassReads) => {
    const e = entity();
    const ds = store("ex:doc a ex:Target .");
    const scope = createParseScope(ds, { maxClassReads });
    expect(e.parse(DOC, ds, { scope })).toEqual(maxClassReads === 0 ? undefined : {});
    expect(scope.exhausted).toBe(maxClassReads === 0);
  });

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1_000_001,
  ])("rejects an invalid budget %s", (maxClassReads) => {
    expect(() => createParseScope(new Store(), { maxClassReads })).toThrow(RangeError);
  });

  it("does not exhaust an empty dataset without reading any class terms", () => {
    const ds = new Store();
    const scope = createParseScope(ds, { maxClassReads: 0 });
    expect(entity().parse(DOC, ds, { scope })).toBeUndefined();
    expect(scope.exhausted).toBe(false);
  });

  it.each([DOC, "relative"])("rejects reuse with another dataset before parsing %s", (id) => {
    const ds = store("ex:doc a ex:Target .");
    const scope = createParseScope(ds, { maxClassReads: 0 });
    entity().parse(DOC, ds, { scope });
    expect(() => entity().parse(id, new Store([...ds]), { scope })).toThrow(/different dataset/);
  });

  it("rejects forged scopes and exposes immutable exhaustion state", () => {
    const e = entity();
    const ds = store("ex:doc a ex:Target .");
    expect(() => e.parse(DOC, ds, { scope: { exhausted: false } as ParseScope })).toThrow(
      TypeError,
    );
    const scope = createParseScope(ds, { maxClassReads: 0 });
    e.parse(DOC, ds, { scope });
    expect(() => Object.assign(scope, { exhausted: false })).toThrow(TypeError);
    expect(scope.exhausted).toBe(true);
  });
});

describe("parse scope class memo correctness", () => {
  it("keys by the whole required-class set, independent of order", () => {
    const ds = chain(2, 1, true);
    const { dataset, reads } = counting(ds);
    const scope = createParseScope(dataset);
    const yes = entity(shape([`${EX}Target`, `${EX}Other`]));
    const reordered = entity(shape([`${EX}Other`, `${EX}Target`]));
    const no = entity(shape([`${EX}Other`]));
    expect(yes.parse(`${EX}s0`, dataset, { scope })).toEqual({});
    expect(reordered.parse(`${EX}s0`, dataset, { scope })).toEqual({});
    expect(reads.subclasses).toBe(2);
    expect(no.parse(`${EX}s0`, dataset, { scope })).toBeUndefined();
    expect(reads.subclasses).toBe(4);
  });

  it("accepts alias classes and reuses completed negative subgraphs", () => {
    const e = entity({ ...shape(), aliasTypeIris: [`${EX}OldTarget`] });
    const { dataset, reads } = counting(
      store(
        "ex:doc a ex:c0 . ex:next a ex:c1 . ex:alias a ex:OldTarget . ex:c0 rdfs:subClassOf ex:c1 . ex:c1 rdfs:subClassOf ex:c0 .",
      ),
    );
    const scope = createParseScope(dataset);
    expect(e.parse(DOC, dataset, { scope })).toBeUndefined();
    expect(e.parse(`${EX}next`, dataset, { scope })).toBeUndefined();
    expect(e.parse(`${EX}alias`, dataset, { scope })).toEqual({});
    expect(reads.subclasses).toBe(2);
  });

  it("does not claim that every visited branch in a successful walk reaches the class", () => {
    const e = entity();
    const ds = store(
      "ex:doc a ex:start . ex:other a ex:dead . ex:start rdfs:subClassOf ex:dead, ex:good . ex:good rdfs:subClassOf ex:Target . ex:dead rdfs:subClassOf ex:startDead . ex:startDead rdfs:subClassOf ex:dead .",
    );
    const scope = createParseScope(ds);
    expect(e.parse(DOC, ds, { scope })).toEqual({});
    expect(e.parse(`${EX}other`, ds, { scope })).toBeUndefined();
  });

  it.each([
    false,
    true,
  ])("uses cached parent membership in a different walk (reaches=%s)", (reaches) => {
    const e = entity();
    const { dataset, reads } = counting(
      store(
        `ex:doc a ex:c0 . ex:next a ex:start . ex:c0 rdfs:subClassOf ex:${reaches ? "Target" : "dead"} . ex:start rdfs:subClassOf ex:c0 .`,
      ),
    );
    const scope = createParseScope(dataset);
    expect(e.parse(DOC, dataset, { scope })).toEqual(reaches ? {} : undefined);
    expect(e.parse(`${EX}next`, dataset, { scope })).toEqual(reaches ? {} : undefined);
    expect(reads.subclasses).toBe(2);
  });

  it("distinguishes blank and named class terms with the same value", () => {
    const e = entity();
    const { namedNode, blankNode } = DataFactory;
    const ds = new Store();
    ds.addQuad(namedNode(DOC), namedNode(TYPE), namedNode("c0"));
    ds.addQuad(namedNode(`${EX}blank`), namedNode(TYPE), blankNode("c0"));
    ds.addQuad(namedNode("c0"), namedNode(SUBCLASS), namedNode(`${EX}Target`));
    const scope = createParseScope(ds);
    expect(e.parse(DOC, ds, { scope })).toEqual({});
    expect(e.parse(`${EX}blank`, ds, { scope })).toBeUndefined();
  });

  it("ignores invalid class terms, follows blank classes, and tries every asserted type", () => {
    const e = entity();
    const ds = store(
      'ex:doc a "invalid", ex:dead, _:child . _:child rdfs:subClassOf "invalid", ex:Target .',
    );
    expect(e.parse(DOC, ds, { scope: createParseScope(ds) })).toEqual({});
    expect(e.parse(DOC, ds)).toEqual({});
  });

  it("counts duplicate raw class edges across named graphs", () => {
    const e = entity();
    const ds = chain(1, 1, false);
    const edge = ds.getQuads(null, SUBCLASS, null, null)[0];
    if (!edge) throw new Error("missing edge");
    ds.addQuad(edge.subject, edge.predicate, edge.object, DataFactory.namedNode(`${EX}g`));
    const scope = createParseScope(ds, { maxClassReads: 2 });
    expect(e.parse(`${EX}s0`, ds, { scope })).toBeUndefined();
    expect(scope.exhausted).toBe(true);
  });
});

function composite(required = true): CompositeManifestEntity {
  return {
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
            name: "link",
            predicate: `${EX}link`,
            kind: "nested",
            node: "child",
            hasClass: `${EX}Target`,
            guards: { requiredFailClosed: required },
          },
        ],
      },
      {
        name: "child",
        typeIris: [`${EX}Target`],
        fragment: "child",
        fields: [
          { name: "title", predicate: `${EX}title`, kind: "literal", datatype: "xsd:string" },
        ],
      },
    ],
  };
}

describe("composite scopes and mutation isolation", () => {
  const data = () =>
    store(
      `<${DOC}#it> a ex:Root; ex:link ex:child . <${EX}other#it> a ex:Root; ex:link ex:child . ex:child a ex:c0; ex:title "child" . ex:c0 rdfs:subClassOf ex:Target .`,
    );

  it("shares the memo between roots and explicit nested sh:class checks", () => {
    const e = entity(composite());
    const { dataset, reads } = counting(data());
    const scope = createParseScope(dataset);
    expect(e.parse(DOC, dataset, { scope })).toEqual({ title: "child" });
    expect(e.parse(`${EX}other`, dataset, { scope })).toEqual({ title: "child" });
    expect(reads).toEqual({ types: 4, subclasses: 1 });
  });

  it.each([
    true,
    false,
  ])("grades an exhausted nested class check normally (required=%s)", (required) => {
    const e = entity(composite(required));
    const ds = data();
    const scope = createParseScope(ds, { maxClassReads: 2 });
    expect(e.parse(DOC, ds, { scope })).toEqual(required ? undefined : {});
    expect(scope.exhausted).toBe(true);
    expect(e.parse(`${EX}other`, ds, { scope })).toBeUndefined();
    expect(e.parse(DOC, ds)).toEqual({ title: "child" });
  });

  it("rejects a composite scope/dataset mismatch", () => {
    const ds = data();
    expect(() =>
      entity(composite()).parse(DOC, new Store([...ds]), { scope: createParseScope(ds) }),
    ).toThrow(TypeError);
  });

  it("keeps build, guarded setters and mark independent of an exhausted scope", () => {
    const owner = shape();
    owner.fields = [
      { name: "title", predicate: `${EX}title`, kind: "literal", datatype: "xsd:string" },
    ];
    const e = entity(owner);
    const ds = store("ex:doc a ex:Target .");
    const scope = createParseScope(ds, { maxClassReads: 0 });
    expect(e.parse(DOC, ds, { scope })).toBeUndefined();
    const w = new e.Wrapper(DOC, ds, DataFactory);
    Object.assign(w, { title: "clean\u0000text" });
    w.mark();
    expect(e.parse(DOC, ds, { scope: createParseScope(ds) })).toEqual({ title: "cleantext" });
    expect(e.parse(DOC, e.build(DOC, { title: "built" }))).toEqual({ title: "built" });
    expect(scope.exhausted).toBe(true);
  });
});
