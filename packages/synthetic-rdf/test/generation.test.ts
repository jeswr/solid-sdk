// AUTHORED-BY GPT-5.6 Sol via codex

import { readFileSync } from "node:fs";
import type { DatasetCore, Quad, Term } from "@rdfjs/types";
import { describe, expect, it, vi } from "vitest";
import { generate, generateUnchecked, type ValueGenerator } from "../src/index.js";
import { shaclEngineValidator } from "../src/validate.js";
import { EX, lit, nn, shapes, XSD_INTEGER, XSD_STRING } from "./helpers.js";

const GOLDEN_SHAPES = shapes(`
  ex:PersonShape a sh:NodeShape;
    sh:targetClass ex:Person;
    sh:closed true;
    sh:ignoredProperties (rdf:type);
    sh:property
      [ sh:path ex:name; sh:datatype xsd:string; sh:minLength 5; sh:maxLength 8;
        sh:pattern "[A-Z][a-z]{4,7}"; sh:order 1 ],
      [ sh:path ex:score; sh:datatype xsd:integer; sh:minInclusive 300;
        sh:maxInclusive 850; sh:order 2 ],
      [ sh:path ex:status; sh:in ("approved" "review"); sh:order 3 ],
      [ sh:path ex:fixed; sh:hasValue "v1"; sh:order 4 ],
      [ sh:path ex:tag; sh:datatype xsd:string; sh:minCount 2; sh:maxCount 3;
        sh:minLength 3; sh:maxLength 6; sh:order 5 ],
      [ sh:path ex:asOf; sh:datatype xsd:date; sh:minCount 1; sh:maxCount 1; sh:order 6 ],
      [ sh:path ex:address; sh:node ex:AddressShape; sh:minCount 1; sh:maxCount 1; sh:order 7 ] .

  ex:AddressShape a sh:NodeShape;
    sh:closed true;
    sh:property [ sh:path ex:postalCode; sh:datatype xsd:string;
      sh:pattern "\\\\d{5}"; sh:minCount 1; sh:maxCount 1 ] .
`);

function quadFingerprint(value: Quad): string {
  const term = (item: Term) =>
    item.termType === "Literal"
      ? `${item.termType}:${item.value}:${item.language}:${item.datatype.value}`
      : `${item.termType}:${item.value}`;
  return [term(value.subject), term(value.predicate), term(value.object), term(value.graph)].join(
    "|",
  );
}

describe("deterministic generation", () => {
  it.each([
    [0, ""],
    [2, undefined],
  ])("supports strings constrained only by sh:maxLength %i", (maxLength, expected) => {
    const bounded = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:datatype xsd:string;
          sh:maxLength ${maxLength}; sh:minCount 1; sh:maxCount 1 ] .
    `);
    const result = generateUnchecked({ shapes: bounded, seed: `max-length-${maxLength}` });
    const value = [...result.dataset.match(null, EX.name, null, null)][0]?.object.value;
    expect([...(value ?? "")]).toHaveLength(maxLength);
    if (expected !== undefined) expect(value).toBe(expected);
  });

  it("counts target-class triples already present on a constrained path", () => {
    const typeConstrained = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path rdf:type; sh:hasValue ex:Person;
          sh:minCount 1; sh:maxCount 1 ] .
    `);
    const result = generateUnchecked({ shapes: typeConstrained, seed: "existing-rdf-type" });
    expect(
      result.dataset.match(
        null,
        nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        nn("https://example.test/vocab#Person"),
        null,
      ).size,
    ).toBe(1);
    expect(result.dataset.size).toBe(1);
  });

  it("treats multiple sh:targetClass declarations as a union", () => {
    const unionTargets = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person, ex:Agent;
        sh:property [ sh:path rdf:type; sh:minCount 1; sh:maxCount 1 ] .
    `);
    const result = generateUnchecked({ shapes: unionTargets, seed: "target-class-union" });
    const types = [
      ...result.dataset.match(
        result.instances[0]?.focus,
        nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        null,
        null,
      ),
    ].map((quad) => quad.object.value);
    expect(types).toHaveLength(1);
    expect(
      types.every((value) =>
        ["https://example.test/vocab#Person", "https://example.test/vocab#Agent"].includes(value),
      ),
    ).toBe(true);
  });

  it("selects a target class that satisfies rdf:type property constraints", () => {
    const constrainedTarget = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person, ex:Agent;
        sh:property [ sh:path rdf:type; sh:in (ex:Agent);
          sh:minCount 1; sh:maxCount 1 ] .
    `);
    for (let index = 0; index < 16; index += 1) {
      const result = generateUnchecked({
        shapes: constrainedTarget,
        seed: `target-class-constraint-${index}`,
      });
      expect(
        result.dataset.match(
          result.instances[0]?.focus,
          nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
          nn("https://example.test/vocab#Agent"),
          null,
        ).size,
      ).toBe(1);
    }
  });

  it("discovers implicit node shapes from SHACL targets", () => {
    const implicit = shapes(`
      ex:PersonShape sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:hasValue "Implicit" ] .
    `);
    const generated = generateUnchecked({ shapes: implicit, seed: "implicit-node-shape" });
    expect(generated.instances).toHaveLength(1);
    expect([...generated.dataset.match(null, EX.name, null, null)][0]?.object.value).toBe(
      "Implicit",
    );
  });

  it("discovers an untargeted implicit node shape selected through options.targets", () => {
    const implicit = shapes(`
      ex:PersonShape sh:property [ sh:path ex:name; sh:hasValue "Selected" ] .
    `);
    const generated = generateUnchecked({
      shapes: implicit,
      seed: "implicit-options-target",
      targets: [{ shape: EX.PersonShape, count: 1 }],
    });
    expect([...generated.dataset.match(null, EX.name, null, null)][0]?.object.value).toBe(
      "Selected",
    );
  });

  it("matches the byte-stable golden Turtle and the independent SHACL engine", async () => {
    const options = {
      shapes: GOLDEN_SHAPES,
      seed: "golden-seed-v1",
      now: new Date("2026-07-15T12:00:00.000Z"),
      targets: [{ shape: EX.PersonShape, count: 1 }],
      overrides: [{ shape: EX.PersonShape, id: { fragment: "applicant" } }],
      validator: shaclEngineValidator(),
    } as const;

    const first = await generate(options);
    const second = await generate(options);
    const actual = first.toTurtle({ prefixes: { ex: "https://example.test/vocab#" } });
    const expected = readFileSync(new URL("./fixtures/golden.ttl", import.meta.url), "utf8");

    expect(actual).toBe(expected);
    expect(second.toTurtle({ prefixes: { ex: "https://example.test/vocab#" } })).toBe(actual);
    expect(first.instances).toHaveLength(1);
    expect(first.dataset.size).toBeGreaterThan(8);
  });

  it("does not perturb sibling coordinates when one override changes", () => {
    const localShapes = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1 ],
                    [ sh:path ex:score; sh:datatype xsd:integer; sh:minInclusive 300;
                      sh:maxInclusive 850; sh:minCount 1; sh:maxCount 1 ] .
    `);
    const run = (score: string) =>
      generateUnchecked({
        shapes: localShapes,
        seed: "non-perturbation",
        targets: [{ shape: EX.PersonShape, count: 2 }],
        overrides: [
          { shape: EX.PersonShape, values: { [EX.score.value]: lit(score, XSD_INTEGER) } },
        ],
      });
    const left = run("620");
    const right = run("640");
    const changedFocus = left.instances[0]?.focus.value;
    const withoutChangedField = (dataset: DatasetCore) =>
      [...dataset]
        .filter(
          (value) => !value.predicate.equals(EX.score) || value.subject.value !== changedFocus,
        )
        .map(quadFingerprint)
        .sort();

    expect(withoutChangedField(left.dataset)).toEqual(withoutChangedField(right.dataset));
    expect(
      [...left.dataset.match(null, EX.score, null, null)].map((value) => value.object.value),
    ).toContain("620");
    expect(
      [...right.dataset.match(null, EX.score, null, null)].map((value) => value.object.value),
    ).toContain("640");
  });

  it("replaces the complete rdf:type value set with an explicit override", () => {
    const typeShapes = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path rdf:type; sh:minCount 1; sh:maxCount 1 ] .
    `);
    const other = nn("https://example.test/vocab#Other");
    const result = generateUnchecked({
      shapes: typeShapes,
      seed: "replace-rdf-type",
      overrides: [
        {
          shape: EX.PersonShape,
          values: { [nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").value]: other },
        },
      ],
    });
    const focus = result.instances[0]?.focus;
    expect(
      result.dataset.match(
        focus,
        nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        nn("https://example.test/vocab#Person"),
        null,
      ).size,
    ).toBe(0);
    expect(
      result.dataset.match(
        focus,
        nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        other,
        null,
      ).size,
    ).toBe(1);
  });

  it("keeps existing coordinates stable when an unrelated property is added", () => {
    const original = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:score; sh:datatype xsd:integer; sh:minInclusive 300;
          sh:maxInclusive 850; sh:minCount 1; sh:maxCount 1 ] .
    `);
    const evolved = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:datatype xsd:string ],
                    [ sh:path ex:score; sh:datatype xsd:integer; sh:minInclusive 300;
                      sh:maxInclusive 850; sh:minCount 1; sh:maxCount 1 ] .
    `);
    const score = (shapeDataset: DatasetCore) =>
      [
        ...generateUnchecked({ shapes: shapeDataset, seed: "evolution" }).dataset.match(
          null,
          EX.score,
          null,
          null,
        ),
      ][0]?.object.value;
    expect(score(evolved)).toBe(score(original));
  });
});

describe("resolution tiers and facets", () => {
  it("implements hasValue, in, inclusive/exclusive bounds, length, pattern, and cardinality", () => {
    const tierShapes = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person; sh:closed true;
        sh:ignoredProperties (rdf:type);
        sh:property
          [ sh:path ex:fixed; sh:hasValue "fixed"; sh:in ("fixed" "other"); sh:datatype xsd:string ],
          [ sh:path ex:status; sh:in ("approved" "review"); sh:minCount 2; sh:maxCount 3 ],
          [ sh:path ex:score; sh:datatype xsd:integer; sh:minExclusive 299; sh:maxExclusive 851 ],
          [ sh:path ex:name; sh:datatype xsd:string; sh:minLength 5; sh:maxLength 8;
            sh:pattern "[A-Z][a-z]{4,7}" ] .
    `);
    const generated = generateUnchecked({ shapes: tierShapes, seed: "tiers" });
    const values = (predicate: string) =>
      [...generated.dataset.match(null, nn(predicate), null, null)].map(
        (value) => value.object.value,
      );

    expect(values("https://example.test/vocab#fixed")).toEqual(["fixed"]);
    expect(values("https://example.test/vocab#status").length).toBeGreaterThanOrEqual(2);
    expect(values("https://example.test/vocab#status").length).toBeLessThanOrEqual(3);
    expect(Number(values("https://example.test/vocab#score")[0])).toBeGreaterThan(299);
    expect(Number(values("https://example.test/vocab#score")[0])).toBeLessThan(851);
    expect(values("https://example.test/vocab#name")[0]).toMatch(/^[A-Z][a-z]{4,7}$/);
  });

  it("counts distinct RDF terms for cardinality-sensitive generation", () => {
    const enumerable = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:status; sh:in ("approved" "review");
          sh:minCount 2; sh:maxCount 2 ] .
    `);
    const result = generateUnchecked({ shapes: enumerable, seed: "distinct-enumeration" });
    expect([...result.dataset.match(null, EX.status, null, null)]).toHaveLength(2);

    const impossible = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:status; sh:in ("approved");
          sh:minCount 2; sh:maxCount 2 ] .
    `);
    expect(() => generateUnchecked({ shapes: impossible, seed: "impossible-enumeration" })).toThrow(
      /distinct value.*cardinality/,
    );
  });

  it("uses sh:hasValue terms as mandatory seeds while filling remaining cardinality", () => {
    const seeded = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:status; sh:hasValue "fixed"; sh:datatype xsd:string;
          sh:minCount 2; sh:maxCount 2 ] .
    `);
    const result = generateUnchecked({ shapes: seeded, seed: "has-value-cardinality" });
    const values = [...result.dataset.match(null, EX.status, null, null)].map(
      (value) => value.object.value,
    );
    expect(values).toHaveLength(2);
    expect(values).toContain("fixed");
  });

  it("filters sh:in candidates and retries patterns against conjunctive facets", () => {
    const conjunctive = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:status; sh:in ("no" "accepted"); sh:minLength 5 ],
                    [ sh:path ex:name; sh:pattern "[A-Z]{1,8}";
                      sh:minLength 5; sh:maxLength 8 ] .
    `);
    const result = generateUnchecked({ shapes: conjunctive, seed: "conjunctive-candidates" });
    expect([...result.dataset.match(null, EX.status, null, null)][0]?.object.value).toBe(
      "accepted",
    );
    expect(
      [...result.dataset.match(null, EX.name, null, null)][0]?.object.value.length,
    ).toBeGreaterThanOrEqual(5);
  });

  it("filters sh:in candidates through relational constraints", () => {
    const relational = shapes(`
      ex:OrganizationShape a sh:NodeShape; sh:targetClass ex:Organization .
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:employer; sh:in (ex:bad ex:good);
          sh:class ex:Organization; sh:minCount 1; sh:maxCount 1 ] .
    `);
    const result = generateUnchecked({
      shapes: relational,
      seed: "relational-enumeration",
      targets: [
        { shape: EX.OrganizationShape, count: 1 },
        { shape: EX.PersonShape, count: 1 },
      ],
      mintIri: (shape) =>
        shape.equals(EX.OrganizationShape)
          ? nn("https://example.test/vocab#good")
          : nn("https://example.test/vocab#person"),
    });
    expect(
      [...result.dataset.match(null, nn("https://example.test/vocab#employer"), null, null)][0]
        ?.object.value,
    ).toBe("https://example.test/vocab#good");
  });

  it("generates enough distinct coordinate-derived strings for high cardinality", () => {
    const manyStrings = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:datatype xsd:string;
          sh:minCount 9; sh:maxCount 9 ] .
    `);
    const result = generateUnchecked({ shapes: manyStrings, seed: "many-strings" });
    const values = [...result.dataset.match(null, EX.name, null, null)].map(
      (quad) => quad.object.value,
    );
    expect(values).toHaveLength(9);
    expect(new Set(values).size).toBe(9);
  });

  it("pads fixed and empty unanchored patterns to satisfy length facets", () => {
    const unanchored = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:pattern "A"; sh:minLength 2; sh:maxLength 2 ],
                    [ sh:path ex:status; sh:pattern ""; sh:minLength 2; sh:maxLength 2 ] .
    `);
    const result = generateUnchecked({ shapes: unanchored, seed: "unanchored-patterns" });
    const name = [...result.dataset.match(null, EX.name, null, null)][0]?.object.value ?? "";
    const status = [...result.dataset.match(null, EX.status, null, null)][0]?.object.value ?? "";
    expect(name).toHaveLength(2);
    expect(name).toMatch(/A/);
    expect(status).toBe("xx");
  });

  it("counts astral pattern characters as Unicode code points", () => {
    const astral = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:pattern "^😀$";
          sh:minLength 1; sh:maxLength 1 ] .
    `);
    const result = generateUnchecked({ shapes: astral, seed: "astral-pattern" });
    expect([...result.dataset.match(null, EX.name, null, null)][0]?.object.value).toBe("😀");
  });

  it("generates astral characters from character classes", () => {
    const astral = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:pattern "^[😀]$";
          sh:minLength 1; sh:maxLength 1 ] .
    `);
    const result = generateUnchecked({ shapes: astral, seed: "astral-character-class" });
    expect([...result.dataset.match(null, EX.name, null, null)][0]?.object.value).toBe("😀");
  });

  it("retries anchored alternatives to satisfy length facets", () => {
    const alternatives = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:pattern "^(A|BBBB)$";
          sh:minLength 4; sh:maxLength 4 ] .
    `);
    for (let index = 0; index < 16; index += 1) {
      const result = generateUnchecked({
        shapes: alternatives,
        seed: `pattern-alternative-${index}`,
      });
      expect([...result.dataset.match(null, EX.name, null, null)][0]?.object.value).toBe("BBBB");
    }
  });

  it("pads alternatives according to their original anchor scope", () => {
    const mixedAnchors = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:pattern "^A|B$";
          sh:minLength 2; sh:maxLength 2 ] .
    `);
    for (let index = 0; index < 16; index += 1) {
      const result = generateUnchecked({ shapes: mixedAnchors, seed: `mixed-anchor-${index}` });
      const value = [...result.dataset.match(null, EX.name, null, null)][0]?.object.value ?? "";
      expect(value).toHaveLength(2);
      expect(value).toMatch(/^A|B$/);
    }
  });

  it("emits no value for an optional empty sh:in", () => {
    const optional = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:in () ] .
    `);
    const result = generateUnchecked({ shapes: optional, seed: "optional-empty-in" });
    expect(result.dataset.match(null, EX.name, null, null).size).toBe(0);
  });

  it("allows valid overrides without sampling pattern length alternatives", () => {
    const alternatives = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:pattern "^(A|BBBB)$";
          sh:minLength 4; sh:maxLength 4 ] .
    `);
    expect(() =>
      generateUnchecked({
        shapes: alternatives,
        seed: "pinned-pattern-alternative",
        overrides: [{ shape: EX.PersonShape, values: { [EX.name.value]: lit("BBBB") } }],
      }),
    ).not.toThrow();
  });

  it("checks patterns against named nodes and long pinned lexical values", () => {
    const pins = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:status; sh:hasValue ex:Alice; sh:pattern "Alice" ],
                    [ sh:path ex:name; sh:pattern "^x+$" ] .
    `);
    expect(() =>
      generateUnchecked({
        shapes: pins,
        seed: "pattern-pins",
        overrides: [{ shape: EX.PersonShape, values: { [EX.name.value]: lit("x".repeat(300)) } }],
      }),
    ).not.toThrow();
  });

  it("recognizes a terminal anchor after an even backslash run", () => {
    const escaped = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:pattern "\\\\\\\\$" ] .
    `);
    const result = generateUnchecked({ shapes: escaped, seed: "even-backslash-anchor" });
    expect([...result.dataset.match(null, EX.name, null, null)][0]?.object.value).toBe("\\");
  });

  it("derives one-sided and strict combined numeric bounds and clamps XSD subtypes", () => {
    const numeric = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:lowerOnly; sh:datatype xsd:integer; sh:minInclusive 1000 ],
                    [ sh:path ex:combined; sh:datatype xsd:integer;
                      sh:minInclusive 100; sh:minExclusive 150;
                      sh:maxInclusive 900; sh:maxExclusive 800 ],
                    [ sh:path ex:small; sh:datatype xsd:unsignedByte ] .
    `);
    const result = generateUnchecked({ shapes: numeric, seed: "numeric-bounds" });
    const value = (path: string) =>
      Number(
        [...result.dataset.match(null, nn(`https://example.test/vocab#${path}`), null, null)][0]
          ?.object.value,
      );
    expect(value("lowerOnly")).toBeGreaterThanOrEqual(1000);
    expect(value("combined")).toBeGreaterThan(150);
    expect(value("combined")).toBeLessThan(800);
    expect(value("small")).toBeGreaterThanOrEqual(0);
    expect(value("small")).toBeLessThanOrEqual(255);
  });

  it("supports numeric facet intervals wider than 2^32", () => {
    const wide = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:score; sh:datatype xsd:integer;
          sh:minInclusive 0; sh:maxInclusive 5000000000 ] .
    `);
    const generated = generateUnchecked({ shapes: wide, seed: "wide-integer-range" });
    const value = Number([...generated.dataset.match(null, EX.score, null, null)][0]?.object.value);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(5_000_000_000);
  });

  it("derives decimal precision from narrow exclusive facet intervals", () => {
    const narrow = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:score; sh:datatype xsd:decimal;
          sh:minExclusive 0.001; sh:maxExclusive 0.005 ] .
    `);
    const result = generateUnchecked({ shapes: narrow, seed: "narrow-decimal" });
    const value = Number([...result.dataset.match(null, EX.score, null, null)][0]?.object.value);
    expect(value).toBeGreaterThan(0.001);
    expect(value).toBeLessThan(0.005);
  });

  it("handles exact fixed decimal facet intervals", () => {
    const fixed = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:score; sh:datatype xsd:decimal;
          sh:minInclusive 0.29; sh:maxInclusive 0.29 ] .
    `);
    const result = generateUnchecked({ shapes: fixed, seed: "fixed-decimal" });
    expect([...result.dataset.match(null, EX.score, null, null)][0]?.object.value).toBe("0.29");
  });

  it("falls back to a valid cardinality when a finite value space is exhausted", () => {
    const booleans = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:status; sh:datatype xsd:boolean;
          sh:minCount 1; sh:maxCount 3 ] .
    `);
    for (let index = 0; index < 32; index += 1) {
      const result = generateUnchecked({ shapes: booleans, seed: `boolean-${index}` });
      const count = result.dataset.match(null, EX.status, null, null).size;
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it("rejects unsatisfiable single-language uniqueLang cardinality", () => {
    const uniqueLanguage = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:languageIn ("en"); sh:uniqueLang true;
          sh:minCount 2; sh:maxCount 2 ] .
    `);
    expect(() => generateUnchecked({ shapes: uniqueLanguage, seed: "unique-language" })).toThrow(
      /uniqueLang/,
    );
  });

  it.each([
    ["byte", -128, 127],
    ["short", -32_768, 32_767],
    ["int", -2_147_483_648, 2_147_483_647],
    ["long", -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ["integer", -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ["unsignedByte", 0, 255],
    ["unsignedShort", 0, 65_535],
    ["unsignedInt", 0, 4_294_967_295],
    ["unsignedLong", 0, Number.MAX_SAFE_INTEGER],
    ["positiveInteger", 1, Number.MAX_SAFE_INTEGER],
    ["nonNegativeInteger", 0, Number.MAX_SAFE_INTEGER],
    ["negativeInteger", -Number.MAX_SAFE_INTEGER, -1],
    ["nonPositiveInteger", -Number.MAX_SAFE_INTEGER, 0],
  ])("keeps xsd:%s defaults inside the intrinsic value space", (datatype, minimum, maximum) => {
    const shapeDataset = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:score; sh:datatype xsd:${datatype} ] .
    `);
    const generated = generateUnchecked({ shapes: shapeDataset, seed: `intrinsic-${datatype}` });
    const value = Number([...generated.dataset.match(null, EX.score, null, null)][0]?.object.value);
    expect(value).toBeGreaterThanOrEqual(minimum);
    expect(value).toBeLessThanOrEqual(maximum);
  });

  it("expands the documented alternation and quantifier pattern subset", () => {
    const patternShapes = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:datatype xsd:string;
          sh:pattern "^(AB|CD)[A-Z]?\\\\d+[xy]*[0-9]{2,4}$" ] .
    `);
    const generated = generateUnchecked({ shapes: patternShapes, seed: "pattern-subset" });
    const value = [...generated.dataset.match(null, EX.name, null, null)][0]?.object.value;
    expect(value).toMatch(/^(AB|CD)[A-Z]?\d+[xy]*[0-9]{2,4}$/);
  });

  it.each([
    ["^a+$", "a", 10],
    ["^b*$", "b", 12],
  ])("expands unbounded quantifiers to satisfy length facets", (pattern, character, length) => {
    const patternShapes = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:pattern "${pattern}";
          sh:minLength ${length}; sh:maxLength ${length} ] .
    `);
    const generated = generateUnchecked({ shapes: patternShapes, seed: `long-${character}` });
    expect([...generated.dataset.match(null, EX.name, null, null)][0]?.object.value).toBe(
      character.repeat(length),
    );
  });

  it("consults plugins only at the fallback tier", () => {
    const plugin = { generate: vi.fn(() => [lit("plugin", XSD_STRING)]) } satisfies ValueGenerator;
    const tierShapes = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:datatype xsd:string ],
                    [ sh:path ex:fixed; sh:hasValue "fixed" ],
                    [ sh:path ex:status; sh:pattern "[A-Z]{3}" ] .
    `);
    const result = generateUnchecked({ shapes: tierShapes, seed: "plugin", plugins: [plugin] });
    expect([...result.dataset.match(null, EX.name, null, null)][0]?.object.value).toBe("plugin");
    expect([...result.dataset.match(null, EX.fixed, null, null)][0]?.object.value).toBe("fixed");
    expect(plugin).toBeDefined();
    expect(plugin.generate).toHaveBeenCalledTimes(1);
  });

  it("requires explicit now only when a temporal default fires", () => {
    const dateShapes = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:asOf; sh:datatype xsd:date ] .
    `);
    expect(() => generateUnchecked({ shapes: dateShapes, seed: "date" })).toThrow(/Explicit now/);
    const dated = generateUnchecked({
      shapes: dateShapes,
      seed: "date",
      now: new Date("2026-07-15T12:00:00.000Z"),
    });
    expect(
      [...dated.dataset.match(null, nn("https://example.test/vocab#asOf"), null, null)][0]?.object
        .value,
    ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("node and class resolution", () => {
  it("recurses through sh:node with stable blank-node labels", () => {
    const nestedShapes = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:address; sh:node ex:AddressShape; sh:minCount 1; sh:maxCount 1 ] .
      ex:AddressShape a sh:NodeShape;
        sh:property [ sh:path ex:name; sh:hasValue "Home" ] .
    `);
    const result = generateUnchecked({ shapes: nestedShapes, seed: "node" });
    const address = [
      ...result.dataset.match(null, nn("https://example.test/vocab#address"), null, null),
    ][0]?.object;
    expect(address?.termType).toBe("BlankNode");
    expect(address?.value).toMatch(/^i[0-9a-f]{16}$/);
    expect(result.dataset.match(address, EX.name, null, null).size).toBe(1);
  });

  it("keeps nested blank-node labels stable when an earlier nested property is added", () => {
    const original = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:address; sh:node ex:AddressShape ] .
      ex:AddressShape a sh:NodeShape; sh:property [ sh:path ex:name; sh:hasValue "Home" ] .
    `);
    const evolved = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:aaaNested; sh:node ex:ExtraShape ],
                    [ sh:path ex:address; sh:node ex:AddressShape ] .
      ex:AddressShape a sh:NodeShape; sh:property [ sh:path ex:name; sh:hasValue "Home" ] .
      ex:ExtraShape a sh:NodeShape; sh:property [ sh:path ex:name; sh:hasValue "Extra" ] .
    `);
    const addressId = (shapeDataset: DatasetCore) =>
      [
        ...generateUnchecked({ shapes: shapeDataset, seed: "blank-coordinate" }).dataset.match(
          null,
          nn("https://example.test/vocab#address"),
          null,
          null,
        ),
      ][0]?.object.value;
    expect(addressId(evolved)).toBe(addressId(original));
  });

  it("forks repeated nested nodes into distinct hierarchical coordinates", () => {
    const nestedShapes = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:address; sh:node ex:AddressShape;
          sh:minCount 2; sh:maxCount 2 ] .
      ex:AddressShape a sh:NodeShape;
        sh:property [ sh:path ex:postalCode; sh:datatype xsd:string;
          sh:pattern "\\\\d{5}"; sh:minCount 1; sh:maxCount 1 ] .
    `);
    const result = generateUnchecked({ shapes: nestedShapes, seed: "nested-coordinates" });
    const postalCodes = [
      ...result.dataset.match(null, nn("https://example.test/vocab#postalCode"), null, null),
    ].map((value) => value.object.value);
    expect(postalCodes).toHaveLength(2);
    expect(new Set(postalCodes).size).toBe(2);
  });

  it("links sh:class values into the existing generated instance pool", () => {
    const classShapes = shapes(`
      ex:OrganizationShape a sh:NodeShape; sh:targetClass ex:Organization;
        sh:property [ sh:path ex:name; sh:hasValue "Example Org" ] .
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:employer; sh:class ex:Organization; sh:minCount 1; sh:maxCount 1 ] .
    `);
    const result = generateUnchecked({
      shapes: classShapes,
      seed: "class-pool",
      targets: [
        { shape: EX.PersonShape, count: 1 },
        { shape: EX.OrganizationShape, count: 1 },
      ],
    });
    const employer = [
      ...result.dataset.match(null, nn("https://example.test/vocab#employer"), null, null),
    ][0]?.object;
    const organization = result.instances.find((instance) =>
      instance.shape.equals(EX.OrganizationShape),
    );
    expect(employer?.value).toBe(organization?.focus.value);
  });

  it("resolves sh:class membership through transitive rdfs:subClassOf", async () => {
    const classShapes = shapes(`
      ex:OrganizationShape a sh:NodeShape; sh:targetClass ex:Employee .
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:employer; sh:class ex:Organization;
          sh:minCount 1; sh:maxCount 1 ] .
    `);
    const ontology = shapes(`
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      ex:Employee rdfs:subClassOf ex:Worker .
      ex:Worker rdfs:subClassOf ex:Organization .
    `);
    const result = await generate({
      shapes: classShapes,
      ontology,
      seed: "subclass-pool",
      targets: [
        { shape: EX.PersonShape, count: 1 },
        { shape: EX.OrganizationShape, count: 1 },
      ],
      validator: shaclEngineValidator(),
    });
    const person = result.instances.find((instance) => instance.shape.equals(EX.PersonShape));
    const employee = result.instances.find((instance) =>
      instance.shape.equals(EX.OrganizationShape),
    );
    const employer = [
      ...result.dataset.match(person?.focus, nn("https://example.test/vocab#employer"), null, null),
    ][0]?.object;
    expect(employer?.equals(employee?.focus as never)).toBe(true);
  });

  it("accepts ontology-defined instances for sh:class pins", async () => {
    const classShapes = shapes(`
      ex:PersonShape a sh:NodeShape;
        sh:property [ sh:path ex:status; sh:hasValue ex:alice;
          sh:class ex:Person; sh:minCount 1; sh:maxCount 1 ] .
    `);
    const ontology = shapes(`
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      ex:alice a ex:Employee .
      ex:Employee rdfs:subClassOf ex:Person .
    `);
    await expect(
      generate({
        shapes: classShapes,
        ontology,
        seed: "ontology-instance",
        targets: [{ shape: EX.PersonShape, count: 1 }],
        validator: shaclEngineValidator(),
      }),
    ).resolves.toBeDefined();
  });

  it("fills a partial sh:class pool with fresh typed blank nodes", () => {
    const classShapes = shapes(`
      ex:OrganizationShape a sh:NodeShape; sh:targetClass ex:Organization .
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:employer; sh:class ex:Organization;
          sh:minCount 2; sh:maxCount 2 ] .
    `);
    const result = generateUnchecked({
      shapes: classShapes,
      seed: "partial-class-pool",
      targets: [
        { shape: EX.PersonShape, count: 1 },
        { shape: EX.OrganizationShape, count: 1 },
      ],
    });
    const person = result.instances.find((instance) => instance.shape.equals(EX.PersonShape));
    const organization = result.instances.find((instance) =>
      instance.shape.equals(EX.OrganizationShape),
    );
    const employers = [
      ...result.dataset.match(person?.focus, nn("https://example.test/vocab#employer"), null, null),
    ].map((quad) => quad.object);
    expect(employers).toHaveLength(2);
    expect(employers.some((value) => value.equals(organization?.focus as never))).toBe(true);
    expect(employers.some((value) => value.termType === "BlankNode")).toBe(true);
  });

  it("removes overridden rdf:type values from class instance pools", () => {
    const classShapes = shapes(`
      ex:OrganizationShape a sh:NodeShape; sh:targetClass ex:Organization;
        sh:property [ sh:path rdf:type; sh:minCount 1; sh:maxCount 1 ] .
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:employer; sh:class ex:Organization;
          sh:minCount 1; sh:maxCount 1 ] .
    `);
    const result = generateUnchecked({
      shapes: classShapes,
      seed: "overridden-class-pool",
      targets: [
        { shape: EX.PersonShape, count: 1 },
        { shape: EX.OrganizationShape, count: 1 },
      ],
      overrides: [
        {
          shape: EX.OrganizationShape,
          values: {
            [nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").value]: nn(
              "https://example.test/vocab#FormerOrganization",
            ),
          },
        },
      ],
    });
    const person = result.instances.find((instance) => instance.shape.equals(EX.PersonShape));
    const organization = result.instances.find((instance) =>
      instance.shape.equals(EX.OrganizationShape),
    );
    const employer = [
      ...result.dataset.match(person?.focus, nn("https://example.test/vocab#employer"), null, null),
    ][0]?.object;
    expect(employer?.termType).toBe("BlankNode");
    expect(employer?.equals(organization?.focus as never)).toBe(false);
  });

  it("fills a partial sh:node pool with fresh conforming blank nodes", () => {
    const nodeShapes = shapes(`
      ex:AddressShape a sh:NodeShape; sh:targetClass ex:Address;
        sh:property [ sh:path ex:name; sh:hasValue "Home" ] .
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:address; sh:node ex:AddressShape;
          sh:minCount 2; sh:maxCount 2 ] .
    `);
    const result = generateUnchecked({
      shapes: nodeShapes,
      seed: "partial-node-pool",
      targets: [
        { shape: EX.PersonShape, count: 1 },
        { shape: EX.AddressShape, count: 1 },
      ],
    });
    const person = result.instances.find((instance) => instance.shape.equals(EX.PersonShape));
    const address = result.instances.find((instance) => instance.shape.equals(EX.AddressShape));
    const addresses = [
      ...result.dataset.match(person?.focus, nn("https://example.test/vocab#address"), null, null),
    ].map((quad) => quad.object);
    expect(addresses).toHaveLength(2);
    expect(addresses.some((value) => value.equals(address?.focus as never))).toBe(true);
    expect(addresses.some((value) => value.termType === "BlankNode")).toBe(true);
    expect(result.dataset.match(null, EX.name, lit("Home"), null).size).toBe(2);
  });

  it("creates a typed blank node when sh:class has no target pool", () => {
    const classOnly = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:employer; sh:class ex:Organization;
          sh:minCount 1; sh:maxCount 1 ] .
    `);
    const result = generateUnchecked({ shapes: classOnly, seed: "class-without-pool" });
    const employer = [
      ...result.dataset.match(null, nn("https://example.test/vocab#employer"), null, null),
    ][0]?.object;
    expect(employer?.termType).toBe("BlankNode");
    expect(
      result.dataset.match(
        employer as never,
        nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        nn("https://example.test/vocab#Organization"),
        null,
      ).size,
    ).toBe(1);
  });

  it("falls back from a sh:node pool when its values do not satisfy sh:class", () => {
    const combined = shapes(`
      ex:AddressShape a sh:NodeShape; sh:targetClass ex:Address .
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:address; sh:node ex:AddressShape;
          sh:class ex:Location; sh:minCount 1; sh:maxCount 1 ] .
    `);
    const result = generateUnchecked({
      shapes: combined,
      seed: "combined-node-class",
      targets: [
        { shape: EX.AddressShape, count: 1 },
        { shape: EX.PersonShape, count: 1 },
      ],
    });
    const person = result.instances.find((instance) => instance.shape.equals(EX.PersonShape));
    const address = [
      ...result.dataset.match(person?.focus, nn("https://example.test/vocab#address"), null, null),
    ][0]?.object;
    expect(address?.termType).toBe("BlankNode");
    expect(
      result.dataset.match(
        address as never,
        nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        nn("https://example.test/vocab#Location"),
        null,
      ).size,
    ).toBe(1);
  });

  it("checks nested sh:class and sh:node constraints after higher-priority drivers", () => {
    const nestedClass = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:address; sh:node ex:AddressShape ] .
      ex:AddressShape a sh:NodeShape;
        sh:property [ sh:path ex:occupant; sh:hasValue ex:alice; sh:class ex:Person ] .
    `);
    expect(() => generateUnchecked({ shapes: nestedClass, seed: "nested-class" })).toThrow(
      /sh:class/,
    );

    const nestedNode = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:address; sh:hasValue ex:notAnAddress; sh:node ex:AddressShape ] .
      ex:AddressShape a sh:NodeShape;
        sh:property [ sh:path ex:postalCode; sh:hasValue "12345"; sh:minCount 1 ] .
    `);
    expect(() => generateUnchecked({ shapes: nestedNode, seed: "nested-node" })).toThrow(
      /cardinality/,
    );
  });

  it("errors on cycles and depth-cap exhaustion", () => {
    const cycle = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:next; sh:node ex:AddressShape ] .
      ex:AddressShape a sh:NodeShape;
        sh:property [ sh:path ex:next; sh:node ex:PersonShape ] .
    `);
    expect(() => generateUnchecked({ shapes: cycle, seed: "cycle" })).toThrow(/cycle detected/);

    const deep = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:next; sh:node ex:AddressShape ] .
      ex:AddressShape a sh:NodeShape;
        sh:property [ sh:path ex:next; sh:node ex:OrganizationShape ] .
      ex:OrganizationShape a sh:NodeShape; sh:property [ sh:path ex:name; sh:hasValue "Org" ] .
    `);
    expect(() => generateUnchecked({ shapes: deep, seed: "deep", maxDepth: 1 })).toThrow(
      /depth cap 1/,
    );
  });
});

describe("validation boundary", () => {
  it("requires and invokes the injected validator", async () => {
    const validator = {
      validate: vi.fn(async (_data: DatasetCore, _shapes: DatasetCore) => ({
        conforms: true,
        report: "ok",
      })),
    };
    const basic = shapes(`ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person .`);
    const result = await generate({ shapes: basic, seed: "checked", validator });
    expect(validator.validate).toHaveBeenCalledOnce();
    const validationShapes = validator.validate.mock.calls[0]?.[1] as DatasetCore | undefined;
    expect(
      validationShapes?.match(
        EX.PersonShape,
        nn("http://www.w3.org/ns/shacl#targetNode"),
        result.instances[0]?.focus,
        null,
      ).size,
    ).toBe(1);
    expect(
      validationShapes?.match(
        EX.PersonShape,
        nn("http://www.w3.org/ns/shacl#targetClass"),
        nn("https://example.test/vocab#Person"),
        null,
      ).size,
    ).toBe(1);
    await expect(generate({ shapes: basic, seed: "checked" } as never)).rejects.toThrow(
      /validator/i,
    );
  });

  it("adds focus-specific validation targets for explicitly requested untargeted shapes", async () => {
    const untargeted = shapes(`ex:PersonShape a sh:NodeShape .`);
    const validator = {
      validate: vi.fn(async (_data: DatasetCore, _shapes: DatasetCore) => ({
        conforms: true,
        report: "ok",
      })),
    };
    const result = await generate({
      shapes: untargeted,
      seed: "explicit-target",
      targets: [{ shape: EX.PersonShape, count: 1 }],
      validator,
    });
    const validationShapes = validator.validate.mock.calls[0]?.[1] as DatasetCore | undefined;
    expect(
      validationShapes?.match(
        EX.PersonShape,
        nn("http://www.w3.org/ns/shacl#targetNode"),
        result.instances[0]?.focus,
        null,
      ).size,
    ).toBe(1);
  });

  it("preserves other source targets that match generated data", async () => {
    const overlappingTargets = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person .
      ex:AddressShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:hasValue "required" ] .
    `);
    await expect(
      generate({
        shapes: overlappingTargets,
        seed: "overlapping-targets",
        targets: [{ shape: EX.PersonShape, count: 1 }],
        validator: shaclEngineValidator(),
      }),
    ).rejects.toThrow(/does not conform/);
  });

  it("preserves source target nodes even when they have no generated triples", async () => {
    const sourceTarget = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetNode ex:legacyPerson;
        sh:property [ sh:path ex:name; sh:hasValue "required" ] .
    `);
    await expect(
      generate({
        shapes: sourceTarget,
        seed: "source-target-node",
        validator: shaclEngineValidator(),
      }),
    ).rejects.toThrow(/does not conform/);
  });

  it("resolves predicate targets against the ontology-augmented validation data", async () => {
    const predicateTarget = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetSubjectsOf ex:flag .
    `);
    const ontology = shapes(`ex:ontologySubject ex:flag ex:ontologyObject .`);
    const validator = {
      validate: vi.fn(async (_data: DatasetCore, _shapes: DatasetCore) => ({
        conforms: true,
        report: "ok",
      })),
    };
    await generate({
      shapes: predicateTarget,
      ontology,
      seed: "ontology-predicate-target",
      validator,
    });
    const validationShapes = validator.validate.mock.calls[0]?.[1] as DatasetCore | undefined;
    expect(
      validationShapes?.match(
        EX.PersonShape,
        nn("http://www.w3.org/ns/shacl#targetNode"),
        nn("https://example.test/vocab#ontologySubject"),
        null,
      ).size,
    ).toBe(1);
  });

  it("rejects custom SHACL targets that cannot be resolved in core", async () => {
    const customTarget = shapes(`
      ex:PersonShape a sh:NodeShape; sh:target [ a ex:CustomTarget ] .
    `);
    await expect(
      generate({
        shapes: customTarget,
        seed: "custom-target",
        validator: shaclEngineValidator(),
      }),
    ).rejects.toThrow(/Unsupported custom SHACL target/);
  });

  it("surfaces independent validation failure reports", async () => {
    const basic = shapes(`ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person .`);
    await expect(
      generate({
        shapes: basic,
        seed: "rejected",
        validator: {
          async validate() {
            return { conforms: false, report: "independent report" };
          },
        },
      }),
    ).rejects.toThrow(/independent report/);
  });

  it("rejects out-of-shape and out-of-budget overrides", () => {
    const budget = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person; sh:closed true;
        sh:ignoredProperties (rdf:type);
        sh:property [ sh:path ex:score; sh:datatype xsd:integer;
          sh:minInclusive 300; sh:maxInclusive 850; sh:minCount 1; sh:maxCount 1 ] .
    `);
    expect(() =>
      generateUnchecked({
        shapes: budget,
        seed: "bad-path",
        overrides: [
          { shape: EX.PersonShape, values: { "https://example.test/vocab#unknown": lit("x") } },
        ],
      }),
    ).toThrow(/out-of-shape/);
    expect(() =>
      generateUnchecked({
        shapes: budget,
        seed: "bad-budget",
        overrides: [
          { shape: EX.PersonShape, values: { [EX.score.value]: lit("999", XSD_INTEGER) } },
        ],
      }),
    ).toThrow(/maxInclusive/);
    const inferredNumeric = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:score; sh:minInclusive 5; sh:minCount 1; sh:maxCount 1 ] .
    `);
    expect(() =>
      generateUnchecked({
        shapes: inferredNumeric,
        seed: "untyped-numeric",
        overrides: [{ shape: EX.PersonShape, values: { [EX.score.value]: lit("600") } }],
      }),
    ).toThrow(/minInclusive/);
  });

  it("rejects invalid lexical forms and intrinsic ranges in pinned numeric values", () => {
    const numericPins = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:score; sh:datatype xsd:unsignedByte;
          sh:minCount 1; sh:maxCount 1 ] .
    `);
    expect(() =>
      generateUnchecked({
        shapes: numericPins,
        seed: "invalid-range-pin",
        overrides: [
          {
            shape: EX.PersonShape,
            values: {
              [EX.score.value]: lit("999", nn("http://www.w3.org/2001/XMLSchema#unsignedByte")),
            },
          },
        ],
      }),
    ).toThrow(/invalid for datatype/);

    const invalidLexical = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:score; sh:hasValue "abc"^^xsd:integer ] .
    `);
    expect(() =>
      generateUnchecked({ shapes: invalidLexical, seed: "invalid-lexical-pin" }),
    ).toThrow(/invalid for datatype/);
  });

  it("accepts arbitrary-precision integer and decimal pins when generation is unnecessary", () => {
    const precisePins = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:score;
          sh:hasValue "123456789012345678901234567890"^^xsd:integer ],
                    [ sh:path ex:balance;
          sh:hasValue "123456789012345678901234567890.123456789"^^xsd:decimal ] .
    `);
    expect(() => generateUnchecked({ shapes: precisePins, seed: "precise-pins" })).not.toThrow();
  });

  it("accepts special XSD float lexicals when no ordering facet requires comparison", () => {
    const special = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:positive; sh:hasValue "INF"^^xsd:float ],
                    [ sh:path ex:negative; sh:hasValue "-INF"^^xsd:double ],
                    [ sh:path ex:unknown; sh:hasValue "NaN"^^xsd:double ] .
    `);
    expect(() => generateUnchecked({ shapes: special, seed: "special-floats" })).not.toThrow();
  });

  it("compares high-precision decimal pins exactly", () => {
    const precise = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:score; sh:datatype xsd:decimal;
          sh:minInclusive 1.0000000000000001; sh:minCount 1; sh:maxCount 1 ] .
    `);
    expect(() =>
      generateUnchecked({
        shapes: precise,
        seed: "precise-decimal-pin",
        overrides: [
          {
            shape: EX.PersonShape,
            values: {
              [EX.score.value]: lit(
                "1.0000000000000000",
                nn("http://www.w3.org/2001/XMLSchema#decimal"),
              ),
            },
          },
        ],
      }),
    ).toThrow(/minInclusive/);
  });

  it("validates XSD calendar values and permits timezone-less dateTimes", () => {
    const temporal = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:created; sh:datatype xsd:dateTime;
          sh:minCount 1; sh:maxCount 1 ] .
    `);
    expect(() =>
      generateUnchecked({
        shapes: temporal,
        seed: "timezone-less-datetime",
        overrides: [
          {
            shape: EX.PersonShape,
            values: {
              "https://example.test/vocab#created": lit(
                "2025-01-02T03:04:05",
                nn("http://www.w3.org/2001/XMLSchema#dateTime"),
              ),
            },
          },
        ],
      }),
    ).not.toThrow();

    const invalidDate = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:created; sh:datatype xsd:date;
          sh:hasValue "2025-02-30"^^xsd:date ] .
    `);
    expect(() => generateUnchecked({ shapes: invalidDate, seed: "invalid-calendar" })).toThrow(
      /invalid for datatype/,
    );
  });
});
