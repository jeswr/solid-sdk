// AUTHORED-BY Claude Opus 5.5
import type { Quad } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  build,
  compileForm,
  FormAdmissionError,
  formToShapes,
  parse,
  validate,
} from "../src/index.js";
import { EX, form, graph, plain, required, SHAPE, SUBJECT } from "./helpers.js";

const { namedNode, literal, quad } = DataFactory;
const RDF_TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const SUBCLASS = namedNode("http://www.w3.org/2000/01/rdf-schema#subClassOf");
const SH = "http://www.w3.org/ns/shacl#";
const DASH = "http://datashapes.org/dash#";

/** ex:C0 rdfs:subClassOf ex:C1 … ex:C(links-1) rdfs:subClassOf ex:C(links). */
const chain = (links: number, top = `${EX}C${links}`): Quad[] =>
  Array.from({ length: links }, (_, i) =>
    quad(namedNode(`${EX}C${i}`), SUBCLASS, namedNode(i === links - 1 ? top : `${EX}C${i + 1}`)),
  );
const rejects = (ttl: string, construct?: string | RegExp): void => {
  let error: unknown;
  try {
    compileForm(graph(ttl), SHAPE);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(FormAdmissionError);
  if (construct) expect((error as FormAdmissionError).construct).toMatch(construct);
};

/** Counts rdfs:subClassOf lookups: a deterministic proxy for class-walk work (no wall clock). */
function countSubclassLookups(store: Store): { calls: number } {
  const counter = { calls: 0 };
  const isSubclass = (term: unknown) =>
    typeof term === "object" &&
    term !== null &&
    (term as { value?: unknown }).value === SUBCLASS.value;
  const readQuads = store.readQuads.bind(store);
  const match = store.match.bind(store);
  store.readQuads = ((...args: Parameters<Store["readQuads"]>) => {
    if (isSubclass(args[1])) counter.calls++;
    return readQuads(...args);
  }) as Store["readQuads"];
  store.match = ((...args: Parameters<Store["match"]>) => {
    if (isSubclass(args[1])) counter.calls++;
    return match(...args);
  }) as Store["match"];
  return counter;
}
// Without the operation-wide budget these fixtures need tens of millions of lookups;
// with the 100,000-read budget the total stays near that budget.
const WALK_CEILING = 200_000;

describe("operation-wide class-walk budget", () => {
  it("bounds parse of many class-checked values sharing a long subclass chain", () => {
    const model = form("sh:nodeKind sh:IRI; sh:class ex:Top");
    // Each walk alone fits the per-call cap: 1 type read + 9,998 subclass reads.
    const data = new Store(chain(9998, `${EX}Top`));
    for (let i = 0; i < 9999; i++) {
      const value = namedNode(`${EX}v${i}`);
      data.add(quad(namedNode(SUBJECT), namedNode(`${EX}value`), value));
      data.add(quad(value, RDF_TYPE, namedNode(`${EX}C0`)));
    }
    const lookups = countSubclassLookups(data);
    const values = parse(model, SUBJECT, data);
    expect(lookups.calls).toBeGreaterThan(0);
    expect(lookups.calls).toBeLessThan(WALK_CEILING);
    // Exhausting the shared budget stops recognising further values (fail closed).
    expect((values.value as string[]).length).toBeLessThan(20);
  });
  it("bounds parse of class-checked nested links the same way", () => {
    const model = form(
      "sh:node ex:Child; sh:class ex:Top",
      "ex:Child a sh:NodeShape; sh:property [sh:path ex:name; sh:datatype xsd:string; sh:maxCount 1].",
    );
    const data = new Store(chain(9998, `${EX}Top`));
    for (let i = 0; i < 4000; i++) {
      const child = namedNode(`${EX}child${i}`);
      data.add(quad(namedNode(SUBJECT), namedNode(`${EX}value`), child));
      data.add(quad(child, RDF_TYPE, namedNode(`${EX}C0`)));
    }
    const lookups = countSubclassLookups(data);
    const values = parse(model, SUBJECT, data);
    expect(lookups.calls).toBeGreaterThan(0);
    expect(lookups.calls).toBeLessThan(WALK_CEILING);
    expect((values.value as unknown[]).length).toBeLessThan(20);
  });
  it("still accepts many values whose class walks are short", () => {
    const model = form("sh:nodeKind sh:IRI; sh:class ex:Person");
    const data = new Store([quad(namedNode(`${EX}Worker`), SUBCLASS, namedNode(`${EX}Person`))]);
    for (let i = 0; i < 2000; i++) {
      const value = namedNode(`${EX}v${i}`);
      data.add(quad(namedNode(SUBJECT), namedNode(`${EX}value`), value));
      data.add(quad(value, RDF_TYPE, namedNode(`${EX}Worker`)));
    }
    expect((parse(model, SUBJECT, data).value as string[]).length).toBe(2000);
  });
  it("rejects a compile whose orphan subjects share a long subclass chain", () => {
    // Short IRIs fit 2,000 orphan shapes plus a 5,000-link chain inside the 512 Ki byte cap.
    const short = (i: number | string) => namedNode(`x:c${i}`);
    const quads = [
      quad(namedNode(SHAPE), RDF_TYPE, namedNode(`${SH}NodeShape`)),
      quad(namedNode(`${SH}NodeShape`), SUBCLASS, short(0)),
      ...Array.from({ length: 4999 }, (_, i) => quad(short(i), SUBCLASS, short(i + 1))),
      ...Array.from({ length: 2000 }, (_, i) =>
        quad(namedNode(`x:o${i}`), RDF_TYPE, namedNode(`${SH}NodeShape`)),
      ),
    ];
    // compileForm copies the shapes into its own store, so count on the prototype.
    let calls = 0;
    const original = Store.prototype.readQuads;
    Store.prototype.readQuads = function (this: Store, ...args: Parameters<Store["readQuads"]>) {
      if ((args[1] as { value?: unknown } | null)?.value === SUBCLASS.value) calls++;
      return original.apply(this, args);
    } as Store["readQuads"];
    try {
      expect(() => compileForm(new Store(quads), SHAPE)).toThrow(/class walk limit/);
    } finally {
      Store.prototype.readQuads = original;
    }
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThan(WALK_CEILING);
  });
});

describe("closed admission of non-SHACL predicates", () => {
  it("enforces dash:singleLine true on writes and reads", () => {
    const model = form("sh:datatype xsd:string; dash:singleLine true");
    expect(required(model.fields[0]).singleLine).toBe(true);
    expect(required(model.fields[0]).kind).toBe("text");
    for (const bad of ["a\nb", "a\rb", "a\r\nb"]) {
      expect(validate(model, { value: bad }).valid).toBe(false);
      expect(() => build(model, SUBJECT, { value: bad })).toThrow();
    }
    expect(parse(model, SUBJECT, build(model, SUBJECT, { value: ["ok"] }))).toEqual({
      value: ["ok"],
    });
    expect(parse(model, SUBJECT, graph(`<${SUBJECT}> ex:value "ok", "a\\nb", "c\\rd".`))).toEqual({
      value: ["ok"],
    });
    const advisory = form("sh:datatype xsd:string; dash:singleLine true; sh:severity sh:Warning");
    expect(validate(advisory, { value: "a\nb" }).valid).toBe(true);
    expect(build(advisory, SUBJECT, { value: ["a\nb", "kept"] }).size).toBe(1);
    expect(compileForm(formToShapes(model), SHAPE)).toEqual(model);
    const designed = plain(model);
    expect(validate(designed, { value: "a\nb" }).valid).toBe(false);
    (required(designed.fields[0]) as { singleLine?: unknown }).singleLine = false;
    expect(() => formToShapes(designed)).toThrow(FormAdmissionError);
  });
  it.each([
    ["ex:Form a sh:NodeShape; dash:abstract true.", `${DASH}abstract`],
    ["ex:Form a sh:NodeShape; owl:imports <https://example.org/other>.", /owl#imports/],
    ["ex:Form a sh:NodeShape; rdfs:subClassOf ex:Base.", /subClassOf/],
    [
      "ex:Form a sh:NodeShape; sh:property [sh:path ex:v; sh:datatype xsd:string; dash:editor dash:TextAreaEditor].",
      `${DASH}editor`,
    ],
    [
      "ex:Form a sh:NodeShape; sh:property [sh:path ex:v; sh:datatype xsd:string; ex:custom 1].",
      `${EX}custom`,
    ],
    ["ex:Form a sh:NodeShape. ex:Orphan a sh:PropertyShape; dash:hidden true.", `${DASH}hidden`],
    ["ex:Form a sh:NodeShape. ex:G a sh:PropertyGroup; dash:icon ex:x.", `${DASH}icon`],
    [
      'ex:Form a sh:NodeShape; sh:declare [sh:prefix "ex"; sh:namespace "https://example.org/"^^xsd:anyURI; rdfs:label "x"].',
      /label/,
    ],
    ["ex:Form a sh:NodeShape; dash:singleLine true.", `${DASH}singleLine`],
  ])("rejects unreviewed predicate in %s", (ttl, construct) =>
    rejects(`@prefix owl: <http://www.w3.org/2002/07/owl#>. ${ttl}`, construct));
  it("keeps reviewed display metadata", () => {
    const model = compileForm(
      graph(
        'ex:Form a sh:NodeShape; rdfs:label "Form"; rdfs:comment "c"; sh:property [a sh:PropertyShape; sh:path ex:v; sh:datatype xsd:string; rdfs:label "V"; rdfs:comment "c"; sh:group ex:G]. ex:G a sh:PropertyGroup; rdfs:label "G"; rdfs:comment "c".',
      ),
      SHAPE,
    );
    expect(model.label).toBe("Form");
    expect(model.groups).toEqual([{ iri: `${EX}G`, label: "G", order: undefined }]);
  });
});

describe("nested child identities", () => {
  it("mints disjoint children for sibling responses in one document", () => {
    const model = compileForm(
      graph(
        "ex:Form a sh:NodeShape; sh:property [sh:path ex:child; sh:node ex:Child; sh:maxCount 1]. ex:Child a sh:NodeShape; sh:property [sh:path ex:name; sh:datatype xsd:string; sh:maxCount 1].",
      ),
      SHAPE,
    );
    const doc = `${EX}responses`;
    const one = build(model, `${doc}#r1`, { child: { name: "Alice" } });
    const two = build(model, `${doc}#r2`, { child: { name: "Bob" } });
    expect([...one.getSubjects(null, null, null)].map((s) => s.value)).toContain(
      `${doc}#r1-form-node-1`,
    );
    const merged = new Store([...one, ...two]);
    expect(merged.size).toBe(one.size + two.size);
    expect(parse(model, `${doc}#r1`, merged)).toEqual({ child: { name: "Alice" } });
    expect(parse(model, `${doc}#r2`, merged)).toEqual({ child: { name: "Bob" } });
    // No fragment: children use a plain fragment; caller IRI identities are still skipped.
    const bare = build(model, doc, { child: { name: "Carol" } });
    expect(bare.countQuads(namedNode(`${doc}#form-node-1`), null, null, null)).toBe(1);
  });
});

describe("admission branch coverage", () => {
  it("caps the shapes quad count", () => {
    const quads = Array.from({ length: 10001 }, (_, i) =>
      quad(namedNode(SHAPE), namedNode(`${EX}p${i}`), literal("x")),
    );
    expect(() => compileForm(new Store(quads), SHAPE)).toThrow(/graph limit/);
  });
  it.each([
    [
      "an invalid language tag",
      quad(namedNode(SHAPE), namedNode(`${EX}p`), literal("x", "bad_tag")),
    ],
    [
      "an unsafe datatype IRI",
      quad(namedNode(SHAPE), namedNode(`${EX}p`), literal("x", namedNode("not an iri"))),
    ],
    ["an unsafe predicate IRI", quad(namedNode(SHAPE), namedNode("relative"), literal("x"))],
  ])("refuses unwritable terms: %s", (_, bad) => {
    let error: unknown;
    try {
      compileForm(
        new Store([quad(namedNode(SHAPE), RDF_TYPE, namedNode(`${SH}NodeShape`)), bad]),
        SHAPE,
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(FormAdmissionError);
    expect((error as FormAdmissionError).construct).toBe("RDF term");
  });
  it("refuses a literal sh:property and rdf:type as a path", () => {
    rejects('ex:Form a sh:NodeShape; sh:property "x".', `${SH}property`);
    rejects(
      "ex:Form a sh:NodeShape; sh:property [sh:path rdf:type; sh:nodeKind sh:IRI].",
      `${SH}path`,
    );
  });
  it.each([
    "sh:datatype xsd:integer; dash:singleLine false",
    "sh:datatype xsd:integer; dash:singleLine true",
    "sh:nodeKind sh:IRI; dash:singleLine true",
    'sh:datatype xsd:string; dash:singleLine "maybe"^^xsd:boolean',
    'sh:datatype xsd:string; dash:singleLine "true"',
    "sh:datatype xsd:string; dash:singleLine true, false",
  ])("refuses dash:singleLine misuse: %s", (property) =>
    rejects(`ex:Form a sh:NodeShape; sh:property [sh:path ex:value; ${property}].`, /singleLine/));
  it.each([
    ["ex:G a sh:PropertyGroup; sh:datatype xsd:string.", `${SH}datatype`],
    ['ex:G a sh:PropertyGroup; sh:order 1; sh:name "g".', `${SH}name`],
    [
      'ex:Form sh:declare [sh:prefix "ex"; sh:namespace "https://example.org/"^^xsd:anyURI; sh:order 1].',
      `${SH}order`,
    ],
  ])("refuses extra components on groups and declarations: %s", (extra, construct) =>
    rejects(`ex:Form a sh:NodeShape. ${extra}`, construct));
  it.each(['"a.b"', '"a[0]"', '"a]"'])("refuses ambiguous sh:name %s", (name) =>
    rejects(
      `ex:Form a sh:NodeShape; sh:property [sh:path ex:value; sh:datatype xsd:string; sh:name ${name}].`,
      `${SH}name`,
    ));
  it("refuses an ambiguous designer key", () => {
    const model = plain(form("sh:datatype xsd:string"));
    required(model.fields[0]).key = "a.b";
    expect(() => formToShapes(model)).toThrow(FormAdmissionError);
  });
});
