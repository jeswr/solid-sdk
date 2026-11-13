// AUTHORED-BY Claude Opus 5.5
/**
 * Generator lane C: the opt-in exact xsd:decimal mapping (`"decimal": "exact"` field
 * config) and the reviewed closed `^[A-Z]{3}$` string pattern (`upper-alpha-3`).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { defineModel, type ModelManifest } from "@jeswr/model-runtime";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { Parser, Store } from "n3";
import { afterAll, describe, expect, it } from "vitest";
import { stringPatternFor, stringPatternGuard } from "../../src/compile.js";
import {
  admit,
  assertFidelity,
  type CodegenConfig,
  compileManifest,
  FIELD_CONFIG_GUARD_KEYS,
  FidelityError,
  type FieldConfig,
  generateModel,
  owlRdfsAdapter,
  parseShapes,
  parseTurtle,
} from "../../src/index.js";
import { flat } from "../helpers.js";

const EX = "https://ex.test/";
const DOC = `${EX}doc`;
const H = `@prefix ex: <${EX}> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`;

const ontologyTtl = `${H}
ex:Price a owl:Class ; rdfs:label "Price" ; rdfs:comment "A price." .
ex:Item a owl:Class ; rdfs:label "Item" ; rdfs:comment "An item." .
ex:amount a owl:DatatypeProperty ; rdfs:label "amount" ; rdfs:comment "Amount." ; rdfs:domain ex:Price ; rdfs:range xsd:decimal .
ex:fee a owl:DatatypeProperty ; rdfs:label "fee" ; rdfs:comment "Fee." ; rdfs:domain ex:Price ; rdfs:range xsd:decimal .
ex:currency a owl:DatatypeProperty ; rdfs:label "currency" ; rdfs:comment "Currency." ; rdfs:domain ex:Price ; rdfs:range xsd:string .
ex:count a owl:DatatypeProperty ; rdfs:label "count" ; rdfs:comment "Count." ; rdfs:domain ex:Price ; rdfs:range xsd:integer .
ex:item a owl:ObjectProperty ; rdfs:label "item" ; rdfs:comment "Item." ; rdfs:domain ex:Price ; rdfs:range ex:Item .
ex:price a owl:DatatypeProperty ; rdfs:label "price" ; rdfs:comment "Item price." ; rdfs:domain ex:Item ; rdfs:range xsd:decimal .`;

const CURRENCY = '"^[A-Z]{3}$"';

interface ShapeOpts {
  amountExtra?: string;
  currencyPattern?: string;
  currencyDatatype?: string;
  currencyExtra?: string;
  extraProperty?: string;
}
const shapesTtl = (o: ShapeOpts = {}) => `${H}
ex:PriceShape a sh:NodeShape ; sh:targetClass ex:Price ;
  sh:property [ sh:path ex:amount ; sh:name "amount" ; sh:datatype xsd:decimal ; sh:minCount 1 ; sh:maxCount 1 ${o.amountExtra ?? ""} ] ;
  sh:property [ sh:path ex:fee ; sh:name "fee" ; sh:datatype xsd:decimal ; sh:maxCount 1 ] ;
  sh:property [ sh:path ex:currency ; sh:name "currency" ; sh:datatype ${o.currencyDatatype ?? "xsd:string"} ;
    sh:minCount 1 ; sh:maxCount 1 ; sh:pattern ${o.currencyPattern ?? CURRENCY} ${o.currencyExtra ?? ""} ]
  ${o.extraProperty ?? ""} .
ex:ItemShape a sh:NodeShape ; sh:targetClass ex:Item ;
  sh:property [ sh:path ex:price ; sh:name "price" ; sh:datatype xsd:decimal ; sh:maxCount 1 ] .`;

const config = (fields?: Record<string, FieldConfig>): CodegenConfig => ({
  shapesBase: `${EX}shapes/`,
  prefixes: { ex: EX },
  entities: [
    {
      name: "Price",
      targetClass: `${EX}Price`,
      subject: { convention: "self" },
      ...(fields ? { fields } : {}),
    },
    { name: "Item", targetClass: `${EX}Item`, subject: { convention: "self" } },
  ],
});
const EXACT = { amount: { decimal: "exact" }, fee: { decimal: "exact" } } as const;

const generate = (cfg: CodegenConfig, o?: ShapeOpts) =>
  generateModel({ ontologyTtl, shapesTtl: shapesTtl(o), config: cfg, admissionNamespace: EX });

/** Admission outcome; a malformed SHACL parameter fails while parsing the shapes. */
function rejected(o: ShapeOpts): boolean {
  try {
    return !report(o).ok;
  } catch (e) {
    if ((e as Error).name === "AdmissionError") return true;
    throw e;
  }
}
function report(o: ShapeOpts, cfg = config()) {
  const ontology = owlRdfsAdapter.adapt(parseTurtle(ontologyTtl));
  const shapes = parseShapes(shapesTtl(o), cfg.shapesBase, ontology, parseTurtle(ontologyTtl));
  return admit(ontology, shapes, EX, cfg);
}
const patternErrors = (o: ShapeOpts) =>
  report(o).violations.filter(
    (v) => v.severity === "error" && v.message.includes("no reviewed closed guard"),
  );

const field = (manifest: ModelManifest, entity: string, name: string) => {
  const e = flat(manifest.entities.find((x) => x.name === entity));
  const f = e.fields.find((x) => x.name === name);
  if (!f) throw new Error(`missing field ${name}`);
  return f;
};

describe("stringPatternFor — exact pattern TEXT match, no regex compilation", () => {
  it("maps only ^[A-Z]{3}$", () => {
    expect(stringPatternFor("^[A-Z]{3}$")).toBe("upper-alpha-3");
    for (const p of [
      undefined,
      "",
      "^[A-Z]{3}",
      "[A-Z]{3}$",
      "[A-Z]{3}",
      "^[A-Z]{3}$ ",
      " ^[A-Z]{3}$",
      "^[a-z]{3}$",
      "^[A-Z]{2}$",
      "^[A-Z]{3,}$",
      "^[A-Z]{3,3}$",
      "^[A-Z][A-Z][A-Z]$",
      "^(?:[A-Z]{3})$",
      "^\\p{Lu}{3}$",
      "^[A-Z]{3}$|.*",
      "\\S",
      "^https?://",
    ])
      expect(stringPatternFor(p)).toBeUndefined();
  });
  it("applies only to a literal typed exactly xsd:string", () => {
    const pattern = "^[A-Z]{3}$";
    expect(stringPatternGuard({ kind: "literal", datatype: "xsd:string", pattern })).toBe(
      "upper-alpha-3",
    );
    expect(
      stringPatternGuard({
        kind: "literal",
        datatype: "http://www.w3.org/2001/XMLSchema#string",
        pattern,
      }),
    ).toBe("upper-alpha-3");
    for (const datatype of [
      "xsd:token",
      "xsd:normalizedString",
      "xsd:language",
      "xsd:decimal",
      "xsd:integer",
      "xsd:anyURI",
      undefined,
    ])
      expect(stringPatternGuard({ kind: "literal", datatype, pattern })).toBeUndefined();
    expect(stringPatternGuard({ kind: "iri", pattern })).toBeUndefined();
  });
});

describe("admission of the currency pattern", () => {
  it("admits ^[A-Z]{3}$ on an xsd:string literal", () => {
    expect(report({}).ok).toBe(true);
    expect(patternErrors({})).toEqual([]);
  });

  it.each([
    '"^[A-Z]{3}"',
    '"[A-Z]{3}"',
    '"^[a-z]{3}$"',
    '"^[A-Z]{2}$"',
    '"^[A-Z]{3,}$"',
    '"^[A-Z][A-Z][A-Z]$"',
    '"^(?:[A-Z]{3})$"',
    '"^[A-Z]{3}$ "',
    '"^[A-Z]{3}$|.*"',
    '"^[A-Z]{3}$"@en',
    '"^[A-Z]{3}$"^^xsd:token',
  ])("rejects the pattern %s", (pattern) => {
    expect(rejected({ currencyPattern: pattern })).toBe(true);
    expect(() => generate(config(), { currencyPattern: pattern })).toThrow(/admission failed/);
  });

  it.each([
    "xsd:token",
    "xsd:normalizedString",
    "xsd:language",
    "xsd:anyURI",
  ])("rejects the pattern on %s (xsd:string only)", (datatype) => {
    expect(patternErrors({ currencyDatatype: datatype })).toHaveLength(1);
  });

  it("rejects the pattern on a decimal, integer or IRI property", () => {
    for (const extra of [
      `sh:property [ sh:path ex:count ; sh:name "count" ; sh:datatype xsd:integer ; sh:maxCount 1 ; sh:pattern ${CURRENCY} ]`,
      `sh:property [ sh:path ex:item ; sh:name "item" ; sh:nodeKind sh:IRI ; sh:maxCount 1 ; sh:pattern ${CURRENCY} ]`,
    ]) {
      expect(patternErrors({ extraProperty: `; ${extra}` })).toHaveLength(1);
    }
    expect(patternErrors({ amountExtra: `; sh:pattern ${CURRENCY}` })).toHaveLength(1);
  });

  it("rejects the pattern with sh:flags or a second pattern", () => {
    expect(report({ currencyExtra: '; sh:flags "i"' }).ok).toBe(false);
    expect(report({ currencyExtra: '; sh:pattern "\\\\S"' }).ok).toBe(false);
  });

  it("rejects the exact-decimal datatype as a pattern host even when configured exact", () => {
    const r = report({ amountExtra: `; sh:pattern ${CURRENCY}` }, config(EXACT));
    expect(r.ok).toBe(false);
  });
});

describe("compiled currency guard + emitted model", () => {
  const result = generate(config());

  it("compiles the shape-derived stringPattern guard", () => {
    expect(field(result.manifest, "Price", "currency")).toEqual({
      name: "currency",
      predicate: `${EX}currency`,
      kind: "literal",
      datatype: "http://www.w3.org/2001/XMLSchema#string",
      minCount: 1,
      maxCount: 1,
      guards: { requiredFailClosed: true, stringPattern: "upper-alpha-3" },
    });
    expect(result.artifacts["model.json"]).toContain('"stringPattern": "upper-alpha-3"');
    expect(result.artifacts["model.d.ts"]).toContain('"currency": string;');
    expect(result.artifacts["shapes.ttl"]).toContain('sh:pattern "^[A-Z]{3}$"');
  });

  it("the generated runtime enforces exactly three ASCII uppercase letters", () => {
    const price = defineModel(result.manifest).entities.Price;
    if (!price) throw new Error("missing Price");
    for (const ok of ["USD", "EUR", "XAU"]) {
      const store = price.build(DOC, { amount: 1, currency: ok });
      expect(price.parse(DOC, store)?.currency).toBe(ok);
    }
    for (const bad of ["usd", "US", "USDX", "ÜSD", "ＵSD", "USD\n", "US\u0000D", ""]) {
      const store = price.build(DOC, { amount: 1, currency: bad });
      expect(store.getQuads(DOC, `${EX}currency`, null, null)).toHaveLength(0);
      expect(price.parse(DOC, store)).toBeUndefined();
    }
  });

  const engine = createRdfEngine();
  afterAll(() => engine.dispose());
  it.each([
    ['"USD"', true],
    ['"usd"', false],
    ['"USDX"', false],
    ['"ÜSD"', false],
  ])("source and emitted SHACL agree with the runtime on %s", async (lexical, conforms) => {
    const ds = new Store(
      new Parser().parse(`${H} <${DOC}> a ex:Price ; ex:amount 1.0 ; ex:currency ${lexical} .`),
    );
    for (const profile of [shapesTtl(), result.artifacts["shapes.ttl"] as string])
      expect((await engine.validate(ds, profile)).conforms).toBe(conforms);
    const price = defineModel(result.manifest).entities.Price;
    expect(price?.parse(DOC, ds) !== undefined).toBe(conforms);
  });

  it("fidelity rejects a dropped, altered or invented stringPattern", () => {
    const ontology = owlRdfsAdapter.adapt(parseTurtle(ontologyTtl));
    const shapes = parseShapes(shapesTtl(), `${EX}shapes/`, ontology, parseTurtle(ontologyTtl));
    const compiled = compileManifest(shapes, config());
    expect(() => assertFidelity(shapes, compiled)).not.toThrow();

    const dropped = structuredClone(compiled);
    const d = field(dropped.manifest, "Price", "currency");
    if (d.guards) delete d.guards.stringPattern;
    expect(() => assertFidelity(shapes, dropped)).toThrow(FidelityError);

    const altered = structuredClone(compiled);
    const a = field(altered.manifest, "Price", "currency");
    if (a.guards) a.guards.stringPattern = "other" as never;
    expect(() => assertFidelity(shapes, altered)).toThrow(FidelityError);

    const shapes2 = parseShapes(
      shapesTtl({ currencyPattern: '"\\\\S"' }),
      `${EX}shapes/`,
      ontology,
      parseTurtle(ontologyTtl),
    );
    const plain = compileManifest(shapes2, config());
    const i = field(plain.manifest, "Price", "currency");
    i.guards = { ...i.guards, stringPattern: "upper-alpha-3" };
    expect(() => assertFidelity(shapes2, plain)).toThrow(/neither shape-derived nor config/);
  });
});

describe("exact decimal config", () => {
  const exact = generate(config(EXACT));
  const plain = generate(config());

  it("emits decimal: exact into model.json and string into model.d.ts", () => {
    expect(field(exact.manifest, "Price", "amount")).toEqual({
      name: "amount",
      predicate: `${EX}amount`,
      kind: "literal",
      datatype: "http://www.w3.org/2001/XMLSchema#decimal",
      decimal: "exact",
      minCount: 1,
      maxCount: 1,
      guards: { requiredFailClosed: true },
    });
    expect(exact.artifacts["model.json"]).toContain('"decimal": "exact"');
    expect(exact.artifacts["model.d.ts"]).toContain('"amount": string;');
    expect(exact.artifacts["model.d.ts"]).toContain('"fee"?: string;');
    // An unconfigured decimal on the same model keeps the number mapping.
    expect(exact.artifacts["model.d.ts"]).toContain('"price"?: number;');
    expect(field(exact.manifest, "Item", "price")).not.toHaveProperty("decimal");
  });

  it("leaves the default (unconfigured) output on the number mapping", () => {
    expect(plain.artifacts["model.json"]).not.toContain('"decimal"');
    expect(plain.artifacts["model.d.ts"]).toContain('"amount": number;');
    expect(plain.artifacts["model.d.ts"]).not.toMatch(/"amount": string/);
    // The only artifact differences are the field key, the TS type and the hashes.
    expect(exact.artifacts["shapes.ttl"]).toBe(plain.artifacts["shapes.ttl"]);
    expect((exact.artifacts["model.json"] as string).replace(/\n *"decimal": "exact",/g, "")).toBe(
      plain.artifacts["model.json"],
    );
  });

  it("is deterministic", () => {
    const again = generate(config(EXACT));
    expect(again.artifacts).toEqual(exact.artifacts);
  });

  it("the generated model round-trips exact lexicals", async () => {
    const price = defineModel(exact.manifest).entities.Price;
    if (!price) throw new Error("missing Price");
    for (const v of ["9007199254740993.01", "10.50", "007.50", "-0.0", "+1"]) {
      const turtle = await price.serialize(DOC, { amount: v, fee: v, currency: "USD" });
      expect(await price.parseDocument(DOC, turtle)).toMatchObject({ amount: v, fee: v });
    }
    for (const v of [".5", "5.", "1e3", " 1", "１", "9".repeat(65), 1.5]) {
      const store = price.build(DOC, { amount: v, currency: "USD" });
      expect(store.getQuads(DOC, `${EX}amount`, null, null)).toHaveLength(0);
      expect(price.parse(DOC, store)).toBeUndefined();
    }
  });

  it("the emitted model.js imports and runs with the exact mapping", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exact-decimal-"));
    try {
      // Resolve @jeswr/model-runtime from this package, not the temp dir.
      const js = (exact.artifacts["model.js"] as string).replace(
        '"@jeswr/model-runtime"',
        JSON.stringify(import.meta.resolve("@jeswr/model-runtime")),
      );
      writeFileSync(join(dir, "model.js"), js);
      const mod = await import(pathToFileURL(join(dir, "model.js")).href);
      const store = mod.entities.Price.build(DOC, { amount: "1.10", currency: "USD" });
      expect(mod.entities.Price.parse(DOC, store).amount).toBe("1.10");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records decimal as a config guard, and fidelity rejects an untraced decimal", () => {
    expect(FIELD_CONFIG_GUARD_KEYS).toContain("decimal");
    const ontology = owlRdfsAdapter.adapt(parseTurtle(ontologyTtl));
    const shapes = parseShapes(shapesTtl(), `${EX}shapes/`, ontology, parseTurtle(ontologyTtl));
    const compiled = compileManifest(shapes, config(EXACT));
    expect(compiled.provenance.find((p) => p.fieldName === "amount")?.configGuards).toEqual([
      "decimal",
    ]);
    expect(() => assertFidelity(shapes, compiled)).not.toThrow();
    const untraced = compileManifest(shapes, config());
    field(untraced.manifest, "Price", "amount").decimal = "exact";
    expect(() => assertFidelity(shapes, untraced)).toThrow(
      /decimal mapping is not config-declared/,
    );
  });

  it.each([
    ["a string field", { currency: { decimal: "exact" } }, {}, /requires an xsd:decimal literal/],
    [
      "an integer field",
      { count: { decimal: "exact" } },
      {
        extraProperty:
          '; sh:property [ sh:path ex:count ; sh:name "count" ; sh:datatype xsd:integer ; sh:maxCount 1 ]',
      },
      /requires an xsd:decimal literal/,
    ],
    [
      "an IRI field",
      { item: { decimal: "exact" } },
      {
        extraProperty:
          '; sh:property [ sh:path ex:item ; sh:name "item" ; sh:nodeKind sh:IRI ; sh:maxCount 1 ]',
      },
      /requires an xsd:decimal literal/,
    ],
    ["an unknown mapping", { amount: { decimal: "lossy" } }, {}, /must be "exact"/],
    ["a boolean mapping", { amount: { decimal: true } }, {}, /must be "exact"/],
    [
      "a sh:in enumeration",
      { amount: { decimal: "exact" } },
      { amountExtra: "; sh:in ( 1.5 2.5 )" },
      /sh:in/,
    ],
    [
      "sh:minInclusive",
      { amount: { decimal: "exact" } },
      { amountExtra: "; sh:minInclusive 0" },
      /numeric bounds/,
    ],
    [
      "sh:maxInclusive",
      { amount: { decimal: "exact" } },
      { amountExtra: "; sh:maxInclusive 100" },
      /numeric bounds/,
    ],
    [
      "a numeric default",
      { fee: { decimal: "exact", default: 0 } },
      {},
      /exact decimal lexical string/,
    ],
    [
      "an invalid string default",
      { fee: { decimal: "exact", default: "1e3" } },
      {},
      /exact decimal lexical string/,
    ],
  ])("rejects decimal exact on %s", (_label, fields, shapeOpts, message) => {
    expect(() => generate(config(fields as Record<string, FieldConfig>), shapeOpts)).toThrow(
      message,
    );
  });

  it("accepts an exact lexical default", () => {
    const r = generate(config({ ...EXACT, fee: { decimal: "exact", default: "0.00" } }));
    expect(field(r.manifest, "Price", "fee")).toMatchObject({ decimal: "exact", default: "0.00" });
    const price = defineModel(r.manifest).entities.Price;
    const store = price?.build(DOC, { amount: "1", currency: "USD" });
    expect(store && price?.parse(DOC, store)?.fee).toBe("0.00");
  });

  it("applies to a composite node's flat field (with rename)", () => {
    const composite: CodegenConfig = {
      shapesBase: `${EX}shapes/`,
      prefixes: { ex: EX },
      entities: [
        {
          name: "Priced",
          kind: "composite",
          root: "price",
          nodes: {
            price: {
              targetClass: `${EX}Price`,
              fragment: "it",
              fields: {
                amount: { decimal: "exact" },
                currency: {},
              },
              links: { item: "item" },
            },
            item: {
              targetClass: `${EX}Item`,
              fragment: "item",
              fields: { price: { decimal: "exact", rename: "itemPrice" } },
            },
          },
        },
      ],
    };
    const r = generate(composite, {
      extraProperty:
        '; sh:property [ sh:path ex:item ; sh:name "item" ; sh:nodeKind sh:IRI ; sh:class ex:Item ; sh:node ex:ItemShape ; sh:maxCount 1 ]',
    });
    expect(r.artifacts["model.d.ts"]).toContain('"amount": string;');
    expect(r.artifacts["model.d.ts"]).toContain('"itemPrice"?: string;');
    const priced = defineModel(r.manifest).entities.Priced;
    if (!priced) throw new Error("missing Priced");
    const store = priced.build(`${EX}doc`, {
      amount: "12.00",
      currency: "JPY",
      itemPrice: "0.10",
    });
    expect(priced.parse(`${EX}doc`, store)).toMatchObject({
      amount: "12.00",
      currency: "JPY",
      itemPrice: "0.10",
    });
    // The per-node view keeps the exact mapping.
    expect(r.artifacts["model.js"]).toContain('"decimal": "exact"');
  });
});
