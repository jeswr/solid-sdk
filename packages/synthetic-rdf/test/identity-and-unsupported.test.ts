// AUTHORED-BY GPT-5.6 Sol via codex

import { describe, expect, it } from "vitest";
import { generateUnchecked } from "../src/index.js";
import { EX, lit, nn, shapes } from "./helpers.js";

describe("identity pins", () => {
  const basic = shapes(`ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person .`);
  const webId = nn("https://alice.example/profile/card#me");

  it("uses destination-relative fragments without affecting coordinate draws", () => {
    const result = generateUnchecked({
      shapes: basic,
      seed: "fragment",
      overrides: [{ shape: EX.PersonShape, id: { fragment: "applicant" } }],
    });
    expect(result.instances[0]?.focus.value).toMatch(
      /^urn:synthetic:person-[0-9a-f]{8}\/0#applicant$/,
    );
  });

  it("rejects unregistered and placeholder-base external identities", () => {
    expect(() =>
      generateUnchecked({
        shapes: basic,
        seed: "external",
        overrides: [{ shape: EX.PersonShape, id: { external: webId } }],
      }),
    ).toThrow(/not exact-listed/);

    const placeholder = nn("urn:synthetic:persona/alice");
    expect(() =>
      generateUnchecked({
        shapes: basic,
        seed: "placeholder",
        overrides: [{ shape: EX.PersonShape, id: { external: placeholder } }],
        allowedExternalIris: new Set([placeholder.value]),
      }),
    ).toThrow(/placeholder base/);
  });

  it("preserves exact-listed real external identities", () => {
    const result = generateUnchecked({
      shapes: basic,
      seed: "allowed-external",
      overrides: [{ shape: EX.PersonShape, id: { external: webId } }],
      allowedExternalIris: new Set([webId.value]),
    });
    expect(result.instances[0]?.focus.equals(webId)).toBe(true);
  });

  it("separates equal shape slugs and rejects duplicate resolved focuses", () => {
    const collidingSlugs = shapes(`
      <https://one.example/PersonShape> a sh:NodeShape .
      <https://two.example/PersonShape> a sh:NodeShape .
    `);
    const targets = [
      { shape: nn("https://one.example/PersonShape"), count: 1 },
      { shape: nn("https://two.example/PersonShape"), count: 1 },
    ];
    const generated = generateUnchecked({ shapes: collidingSlugs, seed: "slug", targets });
    expect(new Set(generated.instances.map((instance) => instance.focus.value)).size).toBe(2);

    expect(() =>
      generateUnchecked({
        shapes: collidingSlugs,
        seed: "duplicate-focus",
        targets,
        mintIri: () => nn("https://example.test/same"),
      }),
    ).toThrow(/same focus IRI/);
  });

  it("rejects IRIREF-forbidden characters in every identity source", () => {
    expect(() =>
      generateUnchecked({
        shapes: basic,
        seed: "unsafe-base",
        base: "https://example.test/bad path",
      }),
    ).toThrow(/safe absolute IRI/);
    expect(() =>
      generateUnchecked({
        shapes: basic,
        seed: "unsafe-mint",
        mintIri: () => nn("https://example.test/> . <https://attacker.test/"),
      }),
    ).toThrow(/safe absolute IRI/);
    const external = nn("https://example.test/bad\\iri");
    expect(() =>
      generateUnchecked({
        shapes: basic,
        seed: "unsafe-external",
        overrides: [{ shape: EX.PersonShape, id: { external } }],
        allowedExternalIris: new Set([external.value]),
      }),
    ).toThrow(/safe absolute IRI/);
  });
});

describe("documented unsupported constraints fail loudly", () => {
  it.each([
    ["sh:lessThan ex:other", "lessThan"],
    ['sh:sparql [ sh:message "unsupported" ]', "sparql"],
    ["sh:qualifiedValueShape [ sh:class ex:Person ]", "qualifiedValueShape"],
  ])("rejects %s", (constraint, expected) => {
    const unsupported = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; ${constraint} ] .
    `);
    expect(() => generateUnchecked({ shapes: unsupported, seed: "unsupported" })).toThrow(expected);
  });

  it("rejects non-predicate paths", () => {
    const unsupported = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path (ex:name); sh:minCount 1 ] .
    `);
    expect(() => generateUnchecked({ shapes: unsupported, seed: "path" })).toThrow(/non-predicate/);
  });

  it("rejects lexical string facets on non-string datatypes", () => {
    const unsupported = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:score; sh:datatype xsd:integer; sh:minLength 5 ] .
    `);
    expect(() => generateUnchecked({ shapes: unsupported, seed: "numeric-lexical" })).toThrow(
      /lexical string facets for non-string datatype/,
    );
  });

  it.each([
    ["sh:property [ sh:path ex:nested; sh:minCount 1 ]", "property"],
    ["sh:closed true", "closed"],
    ["sh:ignoredProperties (rdf:type)", "ignoredProperties"],
  ])("rejects unsupported property-shape constraint %s", (constraint, expected) => {
    const unsupported = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; ${constraint} ] .
    `);
    expect(() => generateUnchecked({ shapes: unsupported, seed: "property-shape" })).toThrow(
      expected,
    );
  });

  it("rejects duplicate paths even when sh:order separates them", () => {
    const duplicate = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:order 0 ],
                    [ sh:path ex:status; sh:order 1 ],
                    [ sh:path ex:name; sh:order 2 ] .
    `);
    expect(() => generateUnchecked({ shapes: duplicate, seed: "duplicate-path" })).toThrow(
      /Multiple property shapes for path/,
    );
  });

  it.each([
    "sh:class ex:Person",
    "sh:node ex:AddressShape",
    "sh:datatype xsd:string",
  ])("rejects node-level property constraint %s", (constraint) => {
    const unsupported = shapes(`
        ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person; ${constraint} .
        ex:AddressShape a sh:NodeShape .
      `);
    expect(() => generateUnchecked({ shapes: unsupported, seed: "node-level" })).toThrow(
      /Unsupported node-level SHACL constraint/,
    );
  });

  it("rejects custom targets on the unchecked path", () => {
    const customTarget = shapes(`
      ex:PersonShape a sh:NodeShape; sh:target [ a ex:CustomTarget ] .
    `);
    expect(() => generateUnchecked({ shapes: customTarget, seed: "custom-target" })).toThrow(
      /Unsupported custom SHACL target/,
    );
  });

  it("rejects non-IRI target classes and generation facets above the safety caps", () => {
    const malformedTarget = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass "Person" .
    `);
    expect(() => generateUnchecked({ shapes: malformedTarget, seed: "malformed-target" })).toThrow(
      /targetClass.*named node/,
    );

    for (const constraint of ["sh:minCount 1025", "sh:minLength 257"]) {
      const oversized = shapes(`
        ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
          sh:property [ sh:path ex:name; ${constraint} ] .
      `);
      expect(() => generateUnchecked({ shapes: oversized, seed: "oversized-facet" })).toThrow(
        /may not exceed/,
      );
    }
  });

  it("ignores blank sh:node references on deactivated property shapes", () => {
    const deactivated = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:address; sh:deactivated true;
          sh:node [ sh:property [ sh:path ex:name; sh:minCount 1 ] ] ] .
    `);
    expect(() =>
      generateUnchecked({ shapes: deactivated, seed: "deactivated-node" }),
    ).not.toThrow();
  });

  it("ignores blank sh:node references owned by deactivated node shapes", () => {
    const deactivated = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person; sh:deactivated true;
        sh:property [ sh:path ex:address;
          sh:node [ sh:property [ sh:path ex:name; sh:minCount 1 ] ] ] .
    `);
    expect(() =>
      generateUnchecked({ shapes: deactivated, seed: "deactivated-parent" }),
    ).not.toThrow();
  });

  it("rejects extreme numeric facet exponents before BigInt expansion", () => {
    const extreme = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:score; sh:datatype xsd:decimal;
          sh:minInclusive 0e100000000 ] .
    `);
    expect(() => generateUnchecked({ shapes: extreme, seed: "extreme-exponent" })).toThrow(
      /exponent/,
    );
  });

  it("caps explicit target allocation counts", () => {
    const targetShape = shapes(`ex:PersonShape a sh:NodeShape .`);
    expect(() =>
      generateUnchecked({
        shapes: targetShape,
        seed: "target-cap",
        targets: [{ shape: EX.PersonShape, count: 1_025 }],
      }),
    ).toThrow(/no greater than 1024/);
  });

  it("rejects ordering facets for non-numeric datatypes", () => {
    const temporal = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:created; sh:datatype xsd:date;
          sh:minInclusive "2025-01-01"^^xsd:date ] .
    `);
    expect(() => generateUnchecked({ shapes: temporal, seed: "temporal-facet" })).toThrow(
      /non-numeric datatype/,
    );
  });

  it("rejects an empty sh:in when a value is required, but permits an empty override", () => {
    const unsupported = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:in (); sh:minCount 1 ] .
    `);
    expect(() => generateUnchecked({ shapes: unsupported, seed: "empty-in" })).toThrow(
      /empty sh:in/,
    );
    const optional = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:in () ] .
    `);
    const empty = generateUnchecked({
      shapes: optional,
      seed: "empty-in-override",
      overrides: [{ shape: EX.PersonShape, values: { [EX.name.value]: [] } }],
    });
    expect(empty.dataset.match(null, EX.name, null, null).size).toBe(0);
  });

  it("rejects repeated regex alternations before native matching", () => {
    const ambiguous = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:pattern "^(a|aa)+$" ] .
    `);
    expect(() => generateUnchecked({ shapes: ambiguous, seed: "ambiguous-pattern" })).toThrow(
      /repeated alternations/,
    );
  });

  it("bounds native regex matching complexity and input length", () => {
    const adjacent = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:pattern "${"a?".repeat(9)}a" ] .
    `);
    expect(() => generateUnchecked({ shapes: adjacent, seed: "adjacent-quantifiers" })).toThrow(
      /variable quantifiers/,
    );

    const boundedInput = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:pattern "^a+$" ] .
    `);
    expect(() =>
      generateUnchecked({
        shapes: boundedInput,
        seed: "bounded-pattern-input",
        overrides: [{ shape: EX.PersonShape, values: { [EX.name.value]: lit("a".repeat(1_025)) } }],
      }),
    ).toThrow(/bounded SHACL pattern match input/);
  });

  it.each([
    "\\\\s",
    "\\\\D",
    "\\\\S",
    "\\\\W",
    "\\\\b",
    "\\\\n",
  ])("rejects unsupported alphabetic regex escape %s", (escapeSequence) => {
    const unsupported = shapes(`
        ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
          sh:property [ sh:path ex:name; sh:pattern "${escapeSequence}+" ] .
      `);
    expect(() => generateUnchecked({ shapes: unsupported, seed: "regex-escape" })).toThrow(
      /unsupported escape/,
    );
  });

  it("rejects unbounded explicit quantifiers", () => {
    const unsupported = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:pattern "^a{1,}$" ] .
    `);
    expect(() => generateUnchecked({ shapes: unsupported, seed: "explicit-unbounded" })).toThrow(
      /unbounded explicit quantifiers/,
    );
  });

  it.each([
    ['sh:languageIn ("fr")', "languageIn"],
    ["sh:uniqueLang true", "uniqueLang"],
  ])("rejects unsupported language constraint %s", (constraint, expected) => {
    const unsupported = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; ${constraint} ] .
    `);
    expect(() => generateUnchecked({ shapes: unsupported, seed: "language" })).toThrow(expected);
  });

  it("caps optional English unique-language generation at one value", () => {
    const english = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:languageIn ("en"); sh:uniqueLang true;
          sh:minCount 1; sh:maxCount 2 ] .
    `);
    for (let index = 0; index < 16; index += 1) {
      const result = generateUnchecked({ shapes: english, seed: `unique-language-${index}` });
      expect(result.dataset.match(null, EX.name, null, null).size).toBe(1);
    }
  });

  it("supports exactly one English language and rejects unsupported regex syntax", () => {
    const english = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:languageIn ("en"); sh:uniqueLang true ] .
    `);
    const generated = generateUnchecked({ shapes: english, seed: "english" });
    const value = [...generated.dataset.match(null, EX.name, null, null)][0]?.object;
    expect(value?.termType).toBe("Literal");
    expect(value?.termType === "Literal" ? value.language : undefined).toBe("en");

    const lookahead = shapes(`
      ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
        sh:property [ sh:path ex:name; sh:pattern "(?=bad)bad" ] .
    `);
    expect(() => generateUnchecked({ shapes: lookahead, seed: "pattern" })).toThrow(/lookarounds/);
  });
});
