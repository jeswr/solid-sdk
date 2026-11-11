// AUTHORED-BY Codex (GPT-6.1 Sol)
import { VALIDATED_DATATYPES, XSD } from "@jeswr/model-runtime";
import { describe, expect, it } from "vitest";
import { compileForm, FormAdmissionError, formToShapes } from "../src/index.js";
import { EX, form, graph, plain, required, SHAPE } from "./helpers.js";

describe("closed SHACL admission", () => {
  it.each([
    ["sh:datatype xsd:string", "text"],
    ["sh:datatype xsd:string; dash:singleLine false", "multiline"],
    ["sh:datatype xsd:integer", "integer"],
    ["sh:datatype xsd:decimal", "decimal"],
    ["sh:datatype xsd:float", "decimal"],
    ["sh:datatype xsd:double", "decimal"],
    ["sh:datatype xsd:boolean", "boolean"],
    ["sh:datatype xsd:date", "date"],
    ["sh:datatype xsd:dateTime", "dateTime"],
    ["sh:nodeKind sh:IRI", "iri"],
    ["sh:class ex:Person", "iri"],
    ['sh:datatype xsd:string; sh:in ("a" "b")', "choice"],
    ["sh:nodeKind sh:IRI; sh:in (ex:a ex:b)", "choice"],
  ])("maps %s to %s", (constraint, kind) => expect(form(constraint).fields[0]?.kind).toBe(kind));
  it.each(VALIDATED_DATATYPES)("admits the reviewed datatype %s", (datatype) =>
    expect(form(`sh:datatype <${datatype}>`).fields[0]?.datatype).toBe(datatype));
  it("orders fields and groups stably, retains labels, and suffixes key collisions", () => {
    const model = compileForm(
      graph(`ex:Form a sh:NodeShape; rdfs:label "Form"; sh:description "Description";
      sh:property [sh:path ex:a; sh:name "same"; rdfs:label "A"; sh:datatype xsd:string; sh:order 2; sh:group ex:G2],
      [sh:path ex:b; sh:name "same"; sh:datatype xsd:string; sh:order 1; sh:group ex:G1],
      [sh:path ex:c; sh:datatype xsd:string; sh:order 2], [sh:path ex:d; sh:datatype xsd:string].
      ex:G1 a sh:PropertyGroup; rdfs:label "First"; sh:order 1.
      ex:G2 a sh:PropertyGroup; sh:order 2.`),
      SHAPE,
    );
    expect(model.label).toBe("Form");
    expect(model.description).toBe("Description");
    expect(model.fields.map((f) => f.key)).toEqual(["same", "same_2", "c", "d"]);
    expect(model.fields[1]?.label).toBe("A");
    expect(model.groups.map((g) => g.iri)).toEqual([`${EX}G1`, `${EX}G2`]);
    expect(compileForm(formToShapes(model), SHAPE)).toEqual(model);
    expect(Object.isFrozen(model.fields[0])).toBe(true);
  });
  it("compiles four NodeShapes but rejects five and cycles", () => {
    const nested = (count: number) =>
      graph(
        Array.from(
          { length: count },
          (_, i) =>
            `ex:S${i} a sh:NodeShape ${i + 1 < count ? `; sh:property [sh:path ex:child; sh:node ex:S${i + 1}; sh:maxCount 1]` : ""}.`,
        ).join("\n"),
      );
    expect(compileForm(nested(4), `${EX}S0`).fields[0]?.kind).toBe("node");
    expect(() => compileForm(nested(5), `${EX}S0`)).toThrow(/depth/);
    expect(() =>
      compileForm(
        graph("ex:Form a sh:NodeShape; sh:property [sh:path ex:child; sh:node ex:Form]."),
        SHAPE,
      ),
    ).toThrow(/cyclic/);
  });
  it.each([
    "and",
    "or",
    "not",
    "xone",
    "qualifiedValueShape",
    "qualifiedMinCount",
    "qualifiedMaxCount",
    "qualifiedValueShapesDisjoint",
    "hasValue",
    "maxLength",
    "minExclusive",
    "maxExclusive",
    "closed",
    "ignoredProperties",
    "uniqueLang",
    "languageIn",
    "equals",
    "disjoint",
    "lessThan",
    "lessThanOrEquals",
    "flags",
    "deactivated",
    "sparql",
    "js",
    "unknownFutureConstraint",
  ])("rejects sh:%s on properties", (component) => {
    expect(() => form(`sh:datatype xsd:string; sh:${component} ex:any`)).toThrow(
      FormAdmissionError,
    );
    try {
      form(`sh:datatype xsd:string; sh:${component} ex:any`);
    } catch (error) {
      expect(String(error)).toContain(component);
      expect((error as FormAdmissionError).shape).toBeTruthy();
    }
  });
  it.each([
    "and",
    "or",
    "not",
    "closed",
    "targetNode",
    "targetSubjectsOf",
    "targetObjectsOf",
    "datatype",
    "minCount",
  ])("rejects sh:%s on nodes", (component) => {
    expect(() =>
      compileForm(graph(`ex:Form a sh:NodeShape; sh:${component} ex:any.`), SHAPE),
    ).toThrow(component);
  });
  it.each([
    "sh:path (ex:a ex:b)",
    "sh:path [sh:inversePath ex:a]",
    "sh:path [sh:alternativePath (ex:a ex:b)]",
    "sh:path [sh:zeroOrMorePath ex:a]",
  ])("rejects complex paths: %s", (path) =>
    expect(() =>
      compileForm(
        graph(`ex:Form a sh:NodeShape; sh:property [${path}; sh:datatype xsd:string].`),
        SHAPE,
      ),
    ).toThrow(/path/i));
  it.each([
    'sh:datatype xsd:string; sh:pattern "a+"',
    'sh:datatype xsd:string; sh:pattern "^https://"',
    'sh:datatype xsd:integer; sh:pattern "\\\\S"',
    "sh:datatype ex:Unknown",
    "sh:nodeKind sh:BlankNode",
    "sh:nodeKind sh:Literal",
    "sh:nodeKind sh:IRI; sh:datatype xsd:string",
    "sh:node ex:Missing",
    "sh:node [a sh:NodeShape]",
    "sh:node ex:Child; sh:minLength 1",
    "sh:datatype xsd:integer; sh:minLength 1",
    "sh:datatype xsd:string; sh:minInclusive 0",
    "sh:datatype xsd:string; sh:minCount 2; sh:maxCount 1",
    "sh:datatype xsd:decimal; sh:minInclusive 2; sh:maxInclusive 1",
    'sh:datatype xsd:string; sh:minCount "1"',
    "sh:datatype xsd:string; sh:minCount -1",
    "sh:datatype xsd:string; sh:minCount 1.5",
    'sh:datatype xsd:string; sh:maxCount "01x"^^xsd:integer',
    "sh:datatype xsd:decimal; sh:minInclusive 1.0000000000000001",
    "sh:datatype xsd:string; sh:severity sh:Other",
    "sh:datatype xsd:string; sh:severity sh:Warning, sh:Violation",
    "sh:datatype xsd:string, xsd:token",
    'sh:datatype xsd:string; sh:name "__proto__"',
    'sh:datatype xsd:string; sh:name "constructor"',
    "sh:datatype xsd:string; sh:group ex:Missing",
    'sh:datatype xsd:string; dash:singleLine "false"',
  ])("rejects invalid or conflicting parameters: %s", (constraint) =>
    expect(() => form(constraint, "ex:Child a sh:NodeShape.")).toThrow(FormAdmissionError));
  it.each([
    "sh:datatype xsd:string; sh:in ()",
    "sh:datatype xsd:string; sh:in (ex:a)",
    'sh:nodeKind sh:IRI; sh:in ("a")',
    "sh:nodeKind sh:IRI; sh:in (<javascript:alert(1)>)",
    "sh:nodeKind sh:IRI; sh:in (<data:text/plain,x>)",
    'sh:datatype xsd:integer; sh:in ("01"^^xsd:integer)',
    'sh:datatype xsd:boolean; sh:in ("1"^^xsd:boolean)',
    "sh:datatype xsd:decimal; sh:in (1.0000000000000001)",
    'sh:datatype xsd:date; sh:in ("2026-01-01Z"^^xsd:date)',
    'sh:datatype xsd:double; sh:in ("INF"^^xsd:double)',
    'sh:datatype xsd:string; sh:in [rdf:first "a"]',
    "sh:datatype xsd:string; sh:in ex:list",
  ])("rejects malformed/lossy enumeration: %s", (constraint) =>
    expect(() => form(constraint, 'ex:list rdf:first "a"; rdf:rest ex:list.')).toThrow(
      FormAdmissionError,
    ));
  it("rejects branching lists and duplicate predicates", () => {
    expect(() =>
      form(
        "sh:datatype xsd:string; sh:in ex:list",
        'ex:list rdf:first "a", "b"; rdf:rest rdf:nil.',
      ),
    ).toThrow(/first/);
    expect(() =>
      compileForm(
        graph(
          "ex:Form a sh:NodeShape; sh:property [sh:path ex:a; sh:datatype xsd:string], [sh:path ex:a; sh:datatype xsd:string].",
        ),
        SHAPE,
      ),
    ).toThrow(/duplicate/);
  });
  it.each([
    "ex:Form a rdfs:Class.",
    "ex:Form a ex:Class. ex:Class rdfs:subClassOf rdfs:Class.",
    "[] a sh:NodeShape, rdfs:Class.",
  ])("rejects implicit class targets including blank shapes: %s", (extra) =>
    expect(() => compileForm(graph(`ex:Form a sh:NodeShape. ${extra}`), SHAPE)).toThrow(
      /implicit class/,
    ));
  it("rejects unsupported orphan constraints and missing shapes", () => {
    expect(() => compileForm(graph("ex:Form a sh:NodeShape. ex:orphan sh:or ()."), SHAPE)).toThrow(
      /or/,
    );
    expect(() => compileForm(graph(""), SHAPE)).toThrow(/NodeShape/);
    expect(() => compileForm(graph(""), "_:blank")).toThrow(FormAdmissionError);
  });
  it("round trips patterns, bounds, messages, class constraints and IRI option labels", () => {
    const model = form(
      'sh:nodeKind sh:IRI; sh:pattern "^https://"; sh:minLength 4; sh:message "Use HTTPS"; sh:class ex:Person; sh:in (ex:a ex:b)',
      'ex:a rdfs:label "Alice".',
    );
    expect(compileForm(formToShapes(model), SHAPE)).toEqual(model);
    const numeric = form(
      "sh:datatype xsd:decimal; sh:minInclusive -1.5; sh:maxInclusive 2.5; sh:minCount 1; sh:maxCount 2; sh:severity sh:Warning",
    );
    expect(compileForm(formToShapes(numeric), SHAPE)).toEqual(numeric);
    const multi = form("sh:datatype xsd:string; dash:singleLine false");
    expect(compileForm(formToShapes(multi), SHAPE)).toEqual(multi);
  });
  it("accepts designer descriptors using only the original API fields", () => {
    const model = {
      shape: SHAPE,
      groups: [],
      fields: [
        {
          path: `${EX}title`,
          key: "Title",
          label: "Title",
          kind: "text" as const,
          datatype: `${XSD}string`,
          minCount: 0,
          maxCount: 1,
          severity: "violation" as const,
        },
      ],
    };
    const compiled = compileForm(formToShapes(model), SHAPE);
    expect(compiled.fields[0]?.key).toBe("Title");
    expect(compiled.fields[0]?.name).toBe("Title");
  });
  it("readmits designer edits and rejects inconsistent or unknown descriptors", () => {
    const model = plain(form("sh:datatype xsd:string; sh:maxCount 1"));
    required(model.fields[0]).minCount = 1;
    expect(compileForm(formToShapes(model), SHAPE).fields[0]?.minCount).toBe(1);
    required(model.fields[0]).kind = "boolean";
    expect(() => formToShapes(model)).toThrow(/kind/);
    const unknown = plain(form("sh:datatype xsd:string"));
    Object.assign(required(unknown.fields[0]), { maxLength: 30 });
    expect(() => formToShapes(unknown)).toThrow(/maxLength/);
  });
  it("caps fields and enum lengths", () => {
    const fields = Array.from(
      { length: 257 },
      (_, i) => `[sh:path ex:p${i}; sh:datatype xsd:string]`,
    ).join(",");
    expect(() =>
      compileForm(graph(`ex:Form a sh:NodeShape; sh:property ${fields}.`), SHAPE),
    ).toThrow(/field limit/);
    expect(() =>
      form(
        `sh:datatype xsd:integer; sh:in (${Array.from({ length: 1025 }, (_, i) => i).join(" ")})`,
      ),
    ).toThrow(/list/);
  });
  it("has the expected strict runtime string datatype inventory", () =>
    expect(VALIDATED_DATATYPES).toContain(`${XSD}token`));
});
