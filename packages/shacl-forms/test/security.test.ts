// AUTHORED-BY Codex (GPT-6.1 Sol)
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  build,
  compileForm,
  FormAdmissionError,
  formToShapes,
  parse,
  serialize,
  validate,
} from "../src/index.js";
import { EX, form, graph, plain, required, SHAPE, SUBJECT } from "./helpers.js";

describe("adversarial review regressions", () => {
  it.each([
    "http:example.org/a",
    "https:/example.org/a",
    "https:example.org/a",
  ])("rejects non-authority subject spelling %s", (subject) => {
    const model = form("sh:datatype xsd:string");
    expect(() => build(model, subject, {})).toThrow();
    expect(parse(model, subject, new Store())).toEqual({});
  });
  it("rejects unknown patterns and invalid datatypes on orphan properties", () => {
    for (const constraints of [
      'sh:datatype xsd:string; sh:pattern "arbitrary"',
      "sh:datatype ex:Unknown",
      "sh:nodeKind sh:BlankNode",
      'sh:datatype xsd:string; sh:minCount "1"',
    ]) {
      expect(() =>
        compileForm(
          graph(`ex:Form a sh:NodeShape. ex:Unused a sh:PropertyShape; ${constraints}.`),
          SHAPE,
        ),
      ).toThrow(FormAdmissionError);
    }
  });
  it("deduplicates emitted terms before enforcing the writer's maximum", () => {
    const model = form("sh:datatype xsd:string; sh:maxCount 2");
    expect(parse(model, SUBJECT, build(model, SUBJECT, { value: ["a", "a", "b"] }))).toEqual({
      value: ["a", "b"],
    });
  });
  it("grades a nonconforming nested child at its incoming link", () => {
    const model = form(
      "sh:node ex:Child; sh:maxCount 1; sh:minCount 1",
      "ex:Child a sh:NodeShape; sh:property [sh:path ex:age; sh:datatype xsd:integer; sh:severity sh:Warning; sh:minCount 1].",
    );
    expect(validate(model, { value: {} }).valid).toBe(false);
    expect(() => build(model, SUBJECT, { value: {} })).toThrow();
    const advisory = form(
      "sh:node ex:Child; sh:maxCount 1; sh:severity sh:Warning",
      "ex:Child a sh:NodeShape; sh:property [sh:path ex:age; sh:datatype xsd:integer; sh:severity sh:Warning; sh:minCount 1].",
    );
    expect(validate(advisory, { value: {} }).valid).toBe(true);
    expect(build(advisory, SUBJECT, { value: {} }).size).toBe(0);
  });
  it("retains group declaration order when field display ordering changes", () => {
    const model = compileForm(
      graph(
        "ex:Form a sh:NodeShape; sh:property [sh:path ex:a; sh:datatype xsd:string; sh:group ex:GroupA; sh:order 2], [sh:path ex:b; sh:datatype xsd:string; sh:group ex:GroupB; sh:order 1]. ex:GroupA a sh:PropertyGroup. ex:GroupB a sh:PropertyGroup.",
      ),
      SHAPE,
    );
    expect(model.groups.map((group) => group.iri)).toEqual([`${EX}GroupA`, `${EX}GroupB`]);
    expect(compileForm(formToShapes(model), SHAPE)).toEqual(model);
  });
  it("bounds shapes bytes and refuses named graphs", () => {
    expect(() =>
      compileForm(graph(`ex:Form a sh:NodeShape; rdfs:label "${"x".repeat(524289)}".`), SHAPE),
    ).toThrow(FormAdmissionError);
    const quad = DataFactory.quad(
      DataFactory.namedNode(SHAPE),
      DataFactory.namedNode(`${EX}p`),
      DataFactory.literal("x"),
      DataFactory.namedNode(`${EX}graph`),
    );
    expect(() => compileForm(new Store([quad]), SHAPE)).toThrow(/named graph/);
  });
  it("refuses unsafe or conflicting prefix declarations", () => {
    for (const declaration of [
      'sh:prefix "bad:"; sh:namespace "https://example.org/"^^xsd:anyURI',
      'sh:prefix "ex"; sh:namespace "relative"^^xsd:anyURI',
      'sh:prefix "ex"; sh:namespace "https://example.org/"',
    ]) {
      expect(() =>
        compileForm(graph(`ex:Form a sh:NodeShape; sh:declare [${declaration}].`), SHAPE),
      ).toThrow(FormAdmissionError);
    }
    expect(() =>
      compileForm(
        graph(
          'ex:Form a sh:NodeShape; sh:declare [sh:prefix "ex"; sh:namespace "https://example.org/"^^xsd:anyURI], [sh:prefix "ex"; sh:namespace "https://other.org/"^^xsd:anyURI].',
        ),
        SHAPE,
      ),
    ).toThrow(/prefix/);
  });
  it("keeps normalization policy identical to the reviewed IRI guard", () => {
    const model = form("sh:nodeKind sh:IRI; sh:maxCount 1");
    expect(
      parse(model, SUBJECT, build(model, SUBJECT, { value: " https://EXAMPLE.org:443/<safe>\n" })),
    ).toEqual({ value: "https://example.org/%3Csafe%3E" });
    expect(() => build(model, "https://example.org/<unsafe>", {})).toThrow();
  });
  it("never writes prototype keys supplied by a designer", () => {
    const model = plain(form("sh:datatype xsd:string"));
    required(model.fields[0]).name = "__proto__";
    required(model.fields[0]).key = "__proto__";
    expect(() => build(model, SUBJECT, {})).toThrow();
    expect(parse(model, SUBJECT, new Store())).toEqual({});
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("fails closed on an over-budget class walk", () => {
    const model = form("sh:class ex:Parent; sh:maxCount 1");
    const types = Array.from({ length: 10001 }, (_, i) => `ex:Type${i}`).join(",");
    const data = graph(
      `<${SUBJECT}> ex:value ex:child. ex:child a ${types}. ex:Type10000 rdfs:subClassOf ex:Parent.`,
    );
    expect(parse(model, SUBJECT, data)).toEqual({});
  });
  it("does not serialize a graph whose lexical terms change on writing", async () => {
    const data = new Store([
      DataFactory.quad(
        DataFactory.namedNode(SUBJECT),
        DataFactory.namedNode(`${EX}p`),
        DataFactory.literal("test", "bad_tag"),
      ),
    ]);
    await expect(serialize(data)).rejects.toThrow();
  });
});
