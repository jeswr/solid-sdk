// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import { DataFactory as F, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  defineModel,
  type EntityInvariant,
  type InvariantExpression,
  type ManifestEntity,
  ManifestError,
  type ManifestField,
  type ModelManifest,
  validateManifest,
} from "./index.js";

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing test fixture value");
  return value;
}
const EX = "https://example.org/invariants#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const URL = "https://pod.test/doc";
const header = `@prefix ex: <${EX}>. @prefix xsd: <${XSD}>.`;
const atom = (name = "flag", value = "true", datatype = `${XSD}boolean`): InvariantExpression => ({
  op: "hasValue",
  path: EX + name,
  term: { kind: "literal", value, datatype },
});
const not = (expression: InvariantExpression): InvariantExpression => ({ op: "not", expression });
const invariant = (
  expression: InvariantExpression,
  severity: EntityInvariant["severity"] = "Violation",
): EntityInvariant => ({ shape: `${EX}Safety`, severity, message: "Safety rule", expression });
const field = (name: string, extra: Partial<ManifestField> = {}): ManifestField => ({
  name,
  predicate: EX + name,
  kind: "literal",
  datatype: `${XSD}boolean`,
  maxCount: 1,
  ...extra,
});
const manifest = (
  invariants?: EntityInvariant[],
  fields = [field("flag"), field("other")],
): ModelManifest => ({
  manifestVersion: 1,
  runtime: { name: "@jeswr/model-runtime", major: 0 },
  prefixes: {},
  entities: [
    {
      name: "Record",
      typeIris: [`${EX}Record`],
      subject: { convention: "self" },
      fields,
      ...(invariants ? { invariants } : {}),
    },
  ],
});
const entity = (m: ModelManifest) => must(defineModel(m).entities.Record);
const dataset = (properties = "") =>
  new Store(
    new Parser().parse(`${header}<${URL}> a ex:Record ${properties ? `; ${properties}` : ""}.`),
  );
const snapshot = (s: Store) => [...s].map((q) => JSON.stringify(q)).sort();

function linked(
  expression: InvariantExpression,
  minCount = 1,
  severity: EntityInvariant["severity"] = "Violation",
): ModelManifest {
  const m = manifest(
    [
      invariant(
        { op: "qualified", path: `${EX}links`, targetClass: `${EX}Child`, minCount, expression },
        severity,
      ),
    ],
    [
      field("links", {
        kind: "iri",
        datatype: undefined,
        maxCount: undefined,
        collection: "set",
      }),
    ],
  );
  m.entities.push({
    name: "Child",
    typeIris: [`${EX}Child`],
    subject: { convention: "self" },
    fields: [
      field("flag"),
      field("required", { datatype: `${XSD}string`, guards: { requiredFailClosed: true } }),
    ],
  });
  return m;
}
/** `not(qualified ≥1 links with flag=true)`: the shape of a negated safety rule. */
const negated = (): ModelManifest => {
  const m = linked(atom());
  const constraint = must((m.entities[0] as ManifestEntity).invariants?.[0]);
  constraint.expression = not(constraint.expression);
  return m;
};
const linkedStore = (
  children: string[],
  links = children.map((_, i) => `<${URL}#c${i}>`).join(", "),
) =>
  new Store(
    new Parser().parse(`${header}
  <${URL}> a ex:Record ${links ? `; ex:links ${links}` : ""}.
  ${children.map((properties, i) => `<${URL}#c${i}> ${properties}.`).join("\n")}`),
  );

describe("property hasValue", () => {
  const hasValue = {
    term: { kind: "literal" as const, value: "true", datatype: `${XSD}boolean` },
    severity: "Violation" as const,
  };
  it.each([
    "Violation",
    "Warning",
    "Info",
  ] as const)("grades absence and wrong exact terms as %s", (severity) => {
    const e = entity(manifest(undefined, [field("flag", { hasValue: { ...hasValue, severity } })]));
    for (const value of [
      "",
      "ex:flag false",
      'ex:flag "1"^^xsd:boolean',
      'ex:flag "true"',
      "ex:flag true, false",
    ])
      expect(e.parse(URL, dataset(value))).toEqual(severity === "Violation" ? undefined : {});
    expect(e.parse(URL, dataset("ex:flag true"))).toEqual({ flag: true });
    expect(() => e.build(URL, {})).toThrow(TypeError);
    expect(() => e.build(URL, { flag: false })).toThrow(TypeError);
    const store = e.build(URL, { flag: true });
    const w = new e.Wrapper(URL, store, F) as unknown as { flag?: boolean };
    const before = snapshot(store);
    for (const invalid of [false, undefined]) {
      expect(() => {
        w.flag = invalid;
      }).toThrow(TypeError);
      expect(snapshot(store)).toEqual(before);
    }
    w.flag = true;
    expect(e.parse(URL, store)).toEqual({ flag: true });
  });
  it.each([
    [
      "iri",
      undefined,
      { kind: "iri", value: `${EX}member` },
      `${EX}member`,
      "ex:member",
      "<https://example.org/invariants#other>",
    ],
    [
      "literal",
      `${XSD}integer`,
      { kind: "literal", value: "1", datatype: `${XSD}integer` },
      1,
      "1",
      '"01"^^xsd:integer',
    ],
    [
      "literal",
      `${XSD}string`,
      { kind: "literal", value: "", datatype: `${XSD}string` },
      "",
      '""',
      '"wrong"',
    ],
  ] as const)("preserves exact %s term identity (%s)", (kind, datatype, term, value, good, bad) => {
    const e = entity(
      manifest(undefined, [
        field("flag", { kind, datatype, hasValue: { term, severity: "Violation" } }),
      ]),
    );
    expect(e.parse(URL, e.build(URL, { flag: value }))).toEqual({ flag: value });
    expect(e.parse(URL, dataset(`ex:flag ${good}`))).toBeDefined();
    expect(e.parse(URL, dataset(`ex:flag ${bad}`))).toBeUndefined();
  });
  it("does not let an absent default satisfy hasValue", () => {
    expect(() =>
      defineModel(manifest(undefined, [field("flag", { hasValue, default: true })])),
    ).toThrow(ManifestError);
  });
});

describe("entity invariant evaluation and atomic writes", () => {
  it.each([
    [atom(), true, false],
    [not(atom()), false, true],
    [{ op: "and", expressions: [atom(), atom("other")] }, true, false],
    [{ op: "or", expressions: [atom(), atom("other")] }, true, false],
  ] as [
    InvariantExpression,
    boolean,
    boolean,
  ][])("evaluates %j on reads, builds and setters", (expression, valid, invalid) => {
    const e = entity(manifest([invariant(expression)]));
    const good = { flag: valid, other: valid };
    const bad = { flag: invalid, other: invalid };
    expect(e.parse(URL, dataset(`ex:flag ${valid}; ex:other ${valid}`))).toEqual(good);
    expect(e.parse(URL, dataset(`ex:flag ${invalid}; ex:other ${invalid}`))).toBeUndefined();
    expect(() => e.build(URL, bad)).toThrow(TypeError);
    const store = e.build(URL, good);
    const w = new e.Wrapper(URL, store, F) as unknown as { flag: boolean; other: boolean };
    // For OR, the other true branch permits a first write; the second write must fail.
    if (expression.op === "or") w.other = invalid;
    const before = snapshot(store);
    expect(() => {
      w.flag = invalid;
    }).toThrow(TypeError);
    expect(snapshot(store)).toEqual(before);
  });
  it.each([
    "Warning",
    "Info",
  ] as const)("retains the entity for advisory %s invariants", (severity) => {
    const e = entity(manifest([invariant(atom(), severity)]));
    const store = e.build(URL, { flag: false });
    expect(e.parse(URL, store)).toEqual({ flag: false });
    (new e.Wrapper(URL, store, F) as unknown as { flag: boolean }).flag = false;
  });
  it("evaluates the raw graph, never read defaults", () => {
    const e = entity(manifest([invariant(not(atom()))]));
    expect(e.parse(URL, dataset('ex:flag "true"'))).toEqual({});
    expect(e.parse(URL, dataset())).toEqual({});
    const f = entity(manifest([invariant(atom())], [field("flag", { default: true })]));
    expect(f.parse(URL, dataset())).toBeUndefined();
  });
  it("checks the final staged build once, allowing jointly valid fields in any field order", () => {
    const expression: InvariantExpression = { op: "or", expressions: [not(atom()), atom("other")] };
    const e = entity(manifest([invariant(expression)]));
    expect(e.parse(URL, e.build(URL, { flag: true, other: true }))).toEqual({
      flag: true,
      other: true,
    });
  });
  it("keeps the ordinary missing-required build contract when the invariant is satisfied", () => {
    const e = entity(
      manifest(
        [invariant(not(atom()))],
        [field("flag"), field("other", { guards: { requiredFailClosed: true } })],
      ),
    );
    expect(() => e.build(URL, {})).not.toThrow();
  });
  it("keeps live-set mutations, chaining and forEach atomic", () => {
    const expr: InvariantExpression = {
      op: "hasValue",
      path: `${EX}tags`,
      term: { kind: "literal", value: "safe", datatype: `${XSD}string` },
    };
    const e = entity(
      manifest(
        [invariant(expr)],
        [field("tags", { collection: "set", maxCount: undefined, datatype: `${XSD}string` })],
      ),
    );
    const store = e.build(URL, { tags: ["safe"] });
    const w = new e.Wrapper(URL, store, F) as unknown as { tags: Set<string> };
    const set = w.tags;
    expect(set.add("extra")).toBe(set);
    for (const mutate of [
      () => set.clear(),
      () => set.delete("safe"),
      () => set.add("extra").clear(),
      () =>
        set.forEach((_v, _v2, passed) => {
          passed.clear();
        }),
    ]) {
      const before = snapshot(store);
      expect(mutate).toThrow(TypeError);
      expect(snapshot(store)).toEqual(before);
    }
    expect(set.delete("extra")).toBe(true);
    expect([...set]).toEqual(["safe"]);
  });
  it("checks mark() before mutation", () => {
    const e = entity(manifest([invariant(atom())]));
    const store = new Store();
    const w = new e.Wrapper(URL, store, F);
    expect(() => w.mark()).toThrow(TypeError);
    expect(store.size).toBe(0);
  });
});

describe("qualified linked entity readers", () => {
  it.each([1, 2, 16])("counts distinct conforming entities at N-1/N for N=%i", (minCount) => {
    const e = entity(linked(atom(), minCount));
    const child = 'a ex:Child; ex:flag true; ex:required "yes"';
    expect(
      e.parse(URL, linkedStore(Array.from({ length: minCount - 1 }, () => child))),
    ).toBeUndefined();
    expect(e.parse(URL, linkedStore(Array.from({ length: minCount }, () => child)))).toBeDefined();
    const duplicates = linkedStore([child], `<${URL}#c0>, <${URL}#c0>`);
    expect(e.parse(URL, duplicates) !== undefined).toBe(minCount === 1);
  });
  it.each([
    "a ex:Child; ex:flag true",
    "a ex:Child; ex:flag true; ex:required 1",
    'a ex:Other; ex:flag true; ex:required "yes"',
    'ex:flag true; ex:required "yes"',
    'a ex:Child; ex:flag true, false; ex:required "yes"',
    'a ex:Child; ex:flag true; ex:required "a", "b"',
  ])("counts on raw data even when the linked reader would reject or drop it: %s", (child) => {
    // SHACL qualified semantics: the linked node need not parse, be typed or keep the value
    // its reader would drop. A negated safety rule therefore fails CLOSED on such data.
    const store = linkedStore([child]);
    // The Child's own reader never surfaces flag=true for any of these.
    expect(
      must(defineModel(linked(atom())).entities.Child).parse(`${URL}#c0`, store)?.flag,
    ).toBeUndefined();
    expect(entity(linked(atom())).parse(URL, store)).toBeDefined();
    expect(entity(negated()).parse(URL, store)).toBeUndefined();
  });
  it.each([
    'a ex:Child; ex:flag "true"; ex:required "yes"',
    'a ex:Child; ex:flag false; ex:required "yes"',
    'a ex:Child; ex:flag "1"^^xsd:boolean; ex:required "yes"',
    'a ex:Child; ex:required "yes"',
  ])("a linked node without the exact raw term never counts: %s", (child) => {
    expect(entity(linked(atom())).parse(URL, linkedStore([child]))).toBeUndefined();
    expect(entity(negated()).parse(URL, linkedStore([child]))).toBeDefined();
  });
  it("applies nested not/and/or in the linked entity context", () => {
    const expr: InvariantExpression = {
      op: "and",
      expressions: [
        atom(),
        {
          op: "or",
          expressions: [
            not(atom("required", "bad", `${XSD}string`)),
            atom("required", "yes", `${XSD}string`),
          ],
        },
      ],
    };
    expect(
      entity(linked(expr)).parse(URL, linkedStore(['a ex:Child; ex:flag true; ex:required "yes"'])),
    ).toBeDefined();
  });
  it("a linked entity's own invariants do not decide whether it counts", () => {
    const m = linked(atom());
    (m.entities[1] as ManifestEntity).invariants = [invariant(not(atom()))];
    const store = linkedStore(['a ex:Child; ex:flag true; ex:required "yes"']);
    expect(must(defineModel(m).entities.Child).parse(`${URL}#c0`, store)).toBeUndefined();
    expect(entity(m).parse(URL, store)).toBeDefined();
  });
  it("child setters cannot invalidate a parent's invariant", () => {
    const m = linked(atom());
    const model = defineModel(m);
    const store = linkedStore(['a ex:Child; ex:flag true; ex:required "yes"']);
    const child = new (must(model.entities.Child).Wrapper)(`${URL}#c0`, store, F) as unknown as {
      flag: boolean;
    };
    const before = snapshot(store);
    expect(() => {
      child.flag = false;
    }).toThrow(TypeError);
    expect(snapshot(store)).toEqual(before);
  });
  it("evaluates linearly: 1,000 linked nodes fit the budget", () => {
    const children = (n: number) =>
      linkedStore(Array.from({ length: n }, () => 'a ex:Child; ex:flag false; ex:required "yes"'));
    expect(entity(negated()).parse(URL, children(1000))?.links).toHaveLength(1000);
    // Writes additionally run main's alias-migration audit, whose own budget is unchanged.
    const store = children(300);
    const w = new (entity(negated()).Wrapper)(URL, store, F) as unknown as { links: Set<string> };
    w.links.add(`${URL}#extra`);
    expect(store.countQuads(URL, `${EX}links`, null, null)).toBe(301);
  });
  it("fails a Violation invariant closed when its read budget is exhausted", () => {
    const store = linkedStore(
      Array.from({ length: 6000 }, () => 'a ex:Child; ex:flag false; ex:required "yes"'),
    );
    expect(entity(negated()).parse(URL, store)).toBeUndefined();
    const before = snapshot(store);
    expect(() => {
      (
        new (entity(negated()).Wrapper)(URL, store, F) as unknown as { links: Set<string> }
      ).links.add(`${URL}#extra`);
    }).toThrow(/budget/);
    expect(snapshot(store)).toEqual(before);
  });
  it("a Warning invariant that would exhaust the budget is advisory, not a rejection", () => {
    const m = negated();
    must((m.entities[0] as ManifestEntity).invariants?.[0]).severity = "Warning";
    const store = linkedStore(
      Array.from({ length: 6000 }, () => 'a ex:Child; ex:flag false; ex:required "yes"'),
    );
    expect(entity(m).parse(URL, store)?.links).toHaveLength(6000);
  });
  it("applies the invariant budget only to entities with invariants", () => {
    // The owner has no invariant; only its linked Child does. A large owner still parses.
    const m = linked(atom());
    delete (m.entities[0] as ManifestEntity).invariants;
    (m.entities[1] as ManifestEntity).invariants = [
      invariant(not(atom("required", "x", `${XSD}string`))),
    ];
    const store = linkedStore(
      Array.from({ length: 6000 }, () => 'a ex:Child; ex:flag false; ex:required "yes"'),
    );
    expect(entity(m).parse(URL, store)?.links).toHaveLength(6000);
  });
});

describe("closed invariant manifests", () => {
  it.each([
    { op: "xone", expressions: [atom()] },
    { op: "and", expressions: [] },
    { op: "or", expressions: [] },
    { op: "and", expressions: Array.from({ length: 17 }, () => atom()) },
    { op: "hasValue", path: `${EX}unknown`, term: { kind: "iri", value: `${EX}x` } },
    {
      op: "hasValue",
      path: `${EX}flag`,
      term: { kind: "literal", datatype: `${XSD}boolean`, value: "1" },
    },
    {
      op: "hasValue",
      path: `${EX}flag`,
      term: { kind: "literal", datatype: `${XSD}boolean`, value: "true", language: "en" },
    },
    { ...atom(), unexpected: true },
    { op: "not", expression: atom(), path: `${EX}flag` },
  ])("rejects malformed expressions %j", (expression) => {
    expect(() => defineModel(manifest([invariant(expression as InvariantExpression)]))).toThrow(
      ManifestError,
    );
  });
  it.each([0, -1, 1.5, 17, "1", null])("rejects qualified minimum %j", (minCount) => {
    expect(() => defineModel(linked(atom(), minCount as number))).toThrow(ManifestError);
  });
  it("bounds logical depth and aggregate atoms", () => {
    let expr = atom();
    for (let i = 0; i < 4; i++) expr = not(expr);
    expect(() => defineModel(manifest([invariant(expr)]))).not.toThrow();
    expect(() => defineModel(manifest([invariant(not(expr))]))).toThrow(ManifestError);
    const sixteen = { op: "and" as const, expressions: Array.from({ length: 16 }, () => atom()) };
    expect(() => defineModel(manifest([invariant(sixteen)]))).not.toThrow();
    expect(() =>
      defineModel(manifest([invariant({ op: "and", expressions: [sixteen, atom()] })])),
    ).toThrow(ManifestError);
  });
  it.each([
    { severity: "Fatal" },
    { shape: "relative" },
    { message: 1 },
    { message: "a".repeat(4097) },
    { extra: true },
  ])("rejects invalid invariant metadata %j", (change) => {
    expect(() =>
      defineModel(manifest([{ ...invariant(atom()), ...change } as EntityInvariant])),
    ).toThrow(ManifestError);
  });
  it("rejects reused expression objects", () => {
    const shared = atom();
    expect(() =>
      validateManifest(manifest([invariant({ op: "and", expressions: [shared, shared] })])),
    ).toThrow(ManifestError);
  });
  it.each([
    { collection: "set" },
    { collection: "ordered" },
    { maxCount: 0 },
    { in: [false] },
    { kind: "iri", datatype: undefined },
  ] as Partial<ManifestField>[])("rejects incompatible hasValue fields %j", (change) => {
    const hasValue = {
      term: { kind: "literal" as const, value: "true", datatype: `${XSD}boolean` },
      severity: "Violation" as const,
    };
    expect(() =>
      defineModel(manifest(undefined, [field("flag", { ...change, hasValue })])),
    ).toThrow();
  });
});

describe("invariant adversarial bounds and migration", () => {
  it("bounds a mutated cyclic expression before it can recurse indefinitely", () => {
    const model = defineModel(manifest([invariant(not(atom()))]));
    const owner = model.manifest.entities[0] as ManifestEntity;
    const expression = must(owner.invariants?.[0]).expression;
    if (expression.op !== "not") throw new Error("missing not fixture");
    expression.expression = expression;
    expect(must(model.entities.Record).parse(URL, dataset())).toBeUndefined();
    const store = dataset();
    const before = snapshot(store);
    expect(() => {
      (
        new (must(model.entities.Record).Wrapper)(URL, store, F) as unknown as { flag: boolean }
      ).flag = true;
    }).toThrow(TypeError);
    expect(snapshot(store)).toEqual(before);
  });
  it("admits the complete 16-atom qualified grammar within four logical levels", () => {
    const fields = [
      field("flag"),
      field("links", {
        kind: "iri",
        datatype: undefined,
        collection: "set",
        maxCount: undefined,
      }),
    ];
    let expression = atom();
    for (let i = 0; i < 15; i++)
      expression = {
        op: "qualified",
        path: `${EX}links`,
        targetClass: `${EX}Record`,
        minCount: 1,
        expression,
      };
    for (let i = 0; i < 4; i++) expression = { op: "and", expressions: [expression] };
    expect(() => defineModel(manifest([invariant(expression)], fields))).not.toThrow();
  });
  it("enforces aggregate atoms across operators from the same source shape", () => {
    const sixteen: InvariantExpression = {
      op: "and",
      expressions: Array.from({ length: 16 }, () => atom()),
    };
    expect(() => defineModel(manifest([invariant(sixteen), invariant(atom())]))).toThrow(
      ManifestError,
    );
  });
  it("never commits alias migration when the staged write violates an invariant", () => {
    const e = entity(
      manifest(
        [invariant(atom())],
        [field("flag"), field("other", { aliasPredicates: [`${EX}oldOther`] })],
      ),
    );
    const store = dataset("ex:flag false; ex:oldOther true");
    const before = snapshot(store);
    const w = new e.Wrapper(URL, store, F) as unknown as { flag: boolean; other: boolean };
    expect(() => {
      w.other = true;
    }).toThrow(TypeError);
    expect(snapshot(store)).toEqual(before);
    w.flag = true;
    w.other = true;
    expect(store.countQuads(URL, `${EX}oldOther`, null, null)).toBe(0);
    expect(e.parse(URL, store)).toEqual({ flag: true, other: true });
  });
  it("rejects invariant paths whose field carries read aliases", () => {
    // Atoms read exactly the SHACL path predicate, so an aliased field is not understood.
    expect(() =>
      defineModel(
        manifest([invariant(atom())], [field("flag", { aliasPredicates: [`${EX}oldFlag`] })]),
      ),
    ).toThrow(/aliases/);
  });
  it("a failed linked Warning invariant remains advisory", () => {
    const m = linked(atom());
    (m.entities[1] as ManifestEntity).invariants = [invariant(not(atom()), "Warning")];
    expect(
      entity(m).parse(URL, linkedStore(['a ex:Child; ex:flag true; ex:required "yes"'])),
    ).toBeDefined();
  });
  it("counts blank-node and non-http linked nodes, and literals, with SHACL semantics", () => {
    for (const links of ["_:b", "<urn:x:node>", "<mailto:a@example.org>"]) {
      const store = new Store(
        new Parser().parse(
          `${header}<${URL}> a ex:Record; ex:links ${links}. ${links} ex:flag true.`,
        ),
      );
      expect(entity(linked(atom())).parse(URL, store), links).toBeDefined();
      expect(entity(negated()).parse(URL, store), links).toBeUndefined();
    }
    // A literal value node has no outgoing data: an atom on it is false, its negation true.
    expect(entity(linked(atom())).parse(URL, linkedStore([], '"literal"'))).toBeUndefined();
    expect(entity(linked(not(atom()))).parse(URL, linkedStore([], '"literal"'))).toBeDefined();
  });
  it("keeps exact numeric term identity inside a logical atom", () => {
    const e = entity(
      manifest(
        [invariant(atom("flag", "1", `${XSD}integer`))],
        [field("flag", { datatype: `${XSD}integer` })],
      ),
    );
    expect(e.parse(URL, dataset('ex:flag "01"^^xsd:integer'))).toBeUndefined();
    expect(e.parse(URL, dataset("ex:flag 1"))).toEqual({ flag: 1 });
  });
  it("accepts fixed-value terms on shorthand datatype fields", () => {
    const e = entity(
      manifest(undefined, [
        field("flag", {
          datatype: "xsd:boolean",
          hasValue: {
            term: { kind: "literal", value: "true", datatype: `${XSD}boolean` },
            severity: "Violation",
          },
        }),
      ]),
    );
    expect(e.parse(URL, e.build(URL, { flag: true }))).toEqual({ flag: true });
  });
  it.each([
    { kind: "literal", datatype: `${XSD}double`, value: "NaN" },
    { kind: "literal", datatype: `${XSD}integer`, value: "1" },
  ])("rejects fixed values incompatible with numeric bounds: %j", (term) => {
    expect(() =>
      defineModel(
        manifest(undefined, [
          field("flag", {
            datatype: term.datatype,
            guards: { minInclusive: 2 },
            hasValue: {
              term: term as { kind: "literal"; datatype: string; value: string },
              severity: "Violation",
            },
          }),
        ]),
      ),
    ).toThrow(ManifestError);
  });
  it.each([
    { kind: "literal", datatype: `${XSD}string`, value: "short" },
    { kind: "literal", datatype: `${XSD}string`, value: "     " },
    { kind: "iri", value: "http://example.org/value" },
  ])("rejects fixed values incompatible with lexical guards: %j", (term) => {
    const scalar =
      term.kind === "iri"
        ? field("flag", { kind: "iri", datatype: undefined, guards: { iriScheme: "https" } })
        : field("flag", { datatype: `${XSD}string`, guards: { minLength: 6, nonBlank: true } });
    expect(() =>
      defineModel(
        manifest(undefined, [
          {
            ...scalar,
            hasValue: {
              term: term as NonNullable<ManifestField["hasValue"]>["term"],
              severity: "Violation",
            },
          },
        ]),
      ),
    ).toThrow(ManifestError);
  });
  it("keeps sh:class metadata on nested links only", () => {
    const m = linked(atom());
    must((m.entities[0] as ManifestEntity).fields[0]).hasClass = `${EX}Child`;
    expect(() => defineModel(m)).toThrow(/hasClass is only allowed on a nested field/);
  });
  it("rejects a qualified target that names no entity", () => {
    const m = linked(atom());
    const constraint = must((m.entities[0] as ManifestEntity).invariants?.[0]);
    if (constraint.expression.op !== "qualified") throw new Error("fixture");
    constraint.expression.targetClass = `${EX}Unknown`;
    expect(() => defineModel(m)).toThrow(ManifestError);
  });
});

describe("composite invariant ownership", () => {
  it("rejects a same-named child from another composite as a qualified target", () => {
    const m = manifest();
    m.entities = ["A", "B"].map((prefix) => ({
      name: prefix,
      kind: "composite" as const,
      root: "root",
      nodes: [
        {
          name: "root",
          fragment: "it",
          typeIris: [`${EX}${prefix}Root`],
          fields: [
            {
              name: "child",
              predicate: `${EX}${prefix}link`,
              kind: "nested" as const,
              node: "child",
            },
          ],
          ...(prefix === "A"
            ? {
                invariants: [
                  invariant({
                    op: "qualified",
                    path: `${EX}Alink`,
                    targetClass: `${EX}BChild`,
                    minCount: 1,
                    expression: atom(),
                  }),
                ],
              }
            : {}),
        },
        {
          name: "child",
          fragment: "child",
          typeIris: [`${EX}${prefix}Child`],
          fields: [field("flag")],
        },
      ],
    }));
    expect(() => defineModel(m)).toThrow(/differs from link target/);
  });
});

describe("hasValue atoms on composite links", () => {
  it("compares the exact raw link term, independently of the linked reader", () => {
    const m: ModelManifest = {
      ...manifest(),
      entities: [
        {
          name: "Tree",
          kind: "composite",
          root: "root",
          nodes: [
            {
              name: "root",
              fragment: "it",
              typeIris: [`${EX}Record`],
              fields: [{ name: "child", predicate: `${EX}links`, kind: "nested", node: "child" }],
              invariants: [
                invariant({
                  op: "hasValue",
                  path: `${EX}links`,
                  term: { kind: "iri", value: `${URL}#child` },
                }),
              ],
            },
            { name: "child", fragment: "child", typeIris: [`${EX}Child`], fields: [field("flag")] },
          ],
        },
      ],
    };
    const e = must(defineModel(m).entities.Tree);
    expect(e.parse(URL, e.build(URL, { flag: true }))).toEqual({ flag: true });
    for (const [links, values, valid] of [
      [`<${URL}#child>`, "true", true],
      [`<${URL}#other>`, "true", false],
      // Raw semantics: the term is among the objects even though the reader drops the
      // ambiguous optional link, or the child fails its own strict reader.
      [`<${URL}#child>, <${URL}#other>`, "true", true],
      [`<${URL}#child>`, '"true"', true],
      ['"literal"', "true", false],
      ["", "true", false],
    ] as const) {
      const store = new Store(
        new Parser().parse(`${header}<${URL}#it> a ex:Record ${links ? `; ex:links ${links}` : ""}.
        <${URL}#child> ex:flag ${values}. <${URL}#other> ex:flag ${values}.`),
      );
      expect(e.parse(URL, store) !== undefined, links).toBe(valid);
    }
  });
});

describe("writes through structural node lenses", () => {
  it("checks invariants on newly reached untyped sh:node children before committing", () => {
    const full: ModelManifest = {
      ...manifest(),
      entities: [
        {
          name: "Tree",
          kind: "composite",
          root: "root",
          nodes: [
            {
              name: "root",
              fragment: "it",
              typeIris: [`${EX}Record`],
              fields: [{ name: "child", predicate: `${EX}links`, kind: "nested", node: "child" }],
            },
            {
              name: "child",
              fragment: "child",
              typeIris: [`${EX}Child`],
              fields: [field("flag")],
              invariants: [invariant(atom())],
            },
          ],
        },
      ],
    };
    const view = manifest(undefined, [
      field("child", { kind: "iri", datatype: undefined, predicate: `${EX}links` }),
    ]);
    const e = must(defineModel(view, { migrationManifest: full }).entities.Record);
    const store = new Store(
      new Parser().parse(`${header}<${URL}> a ex:Record; ex:links <${URL}#good>.
      <${URL}#good> ex:flag true. <${URL}#bad> ex:flag false.`),
    );
    const w = new e.Wrapper(URL, store, F) as unknown as { child: string };
    const before = snapshot(store);
    expect(() => {
      w.child = `${URL}#bad`;
    }).toThrow(TypeError);
    expect(snapshot(store)).toEqual(before);
    w.child = `${URL}#good`;
  });
});

describe("type-set invariant writes", () => {
  it("a linked node's class does not affect its owner's raw qualified count", () => {
    const model = defineModel(linked(atom()));
    const store = linkedStore(['a ex:Child; ex:flag true; ex:required "yes"']);
    const child = new (must(model.entities.Child).Wrapper)(`${URL}#c0`, store, F);
    child.types.add(`${EX}Extra`);
    child.types.delete(`${EX}Child`);
    child.types.clear();
    expect(must(model.entities.Record).parse(URL, store)).toBeDefined();
  });
  it("a type write that makes a node a focus of a violated shape throws before mutation", () => {
    const model = defineModel(linked(atom()));
    // Untyped and unlinked: no shape applies yet, and the Record invariant would fail here.
    const store = new Store(new Parser().parse(`${header}<${URL}#c0> ex:flag true.`));
    const child = new (must(model.entities.Child).Wrapper)(`${URL}#c0`, store, F);
    const before = snapshot(store);
    expect(() => child.types.add(`${EX}Record`)).toThrow(TypeError);
    expect(() => child.types.add(`${EX}Child`)).not.toThrow(); // Child has no invariant
    expect(snapshot(store)).not.toEqual(before);
    expect(store.countQuads(`${URL}#c0`, null, `${EX}Record`, null)).toBe(0);
  });
});

describe("write validation is scoped to the focuses a write can affect", () => {
  const twoLevel = (): ModelManifest => {
    const m = manifest(
      [
        invariant({
          op: "qualified",
          path: `${EX}links`,
          targetClass: `${EX}Child`,
          minCount: 1,
          expression: {
            op: "qualified",
            path: `${EX}sub`,
            targetClass: `${EX}Leaf`,
            minCount: 1,
            expression: atom(),
          },
        }),
      ],
      [
        field("links", {
          kind: "iri",
          datatype: undefined,
          maxCount: undefined,
          collection: "set",
        }),
      ],
    );
    m.entities.push(
      {
        name: "Child",
        typeIris: [`${EX}Child`],
        subject: { convention: "self" },
        fields: [
          field("sub", {
            kind: "iri",
            datatype: undefined,
            maxCount: undefined,
            collection: "set",
          }),
        ],
      },
      {
        name: "Leaf",
        typeIris: [`${EX}Leaf`],
        subject: { convention: "self" },
        fields: [field("flag")],
      },
    );
    return m;
  };
  it("a valid write succeeds next to an invalid sibling of the same shape", () => {
    const e = entity(manifest([invariant(atom())], [field("flag"), field("other")]));
    const store = new Store(
      new Parser().parse(`${header}<${URL}> a ex:Record; ex:flag true.
      <${URL}2> a ex:Record; ex:flag false.`),
    );
    expect(e.parse(`${URL}2`, store)).toBeUndefined();
    (new e.Wrapper(URL, store, F) as unknown as { other: boolean }).other = true;
    expect(e.parse(URL, store)).toEqual({ flag: true, other: true });
  });
  it("a sibling missing a fixed value does not block a write", () => {
    const hasValue = {
      term: { kind: "literal" as const, value: "true", datatype: `${XSD}boolean` },
      severity: "Violation" as const,
    };
    const e = entity(manifest(undefined, [field("flag", { hasValue }), field("other")]));
    const store = new Store(
      new Parser().parse(`${header}<${URL}> a ex:Record; ex:flag true. <${URL}2> a ex:Record.`),
    );
    (new e.Wrapper(URL, store, F) as unknown as { other: boolean }).other = false;
    expect(e.parse(URL, store)).toEqual({ flag: true, other: false });
  });
  it("a linked-node write succeeds next to an invalid unrelated owner", () => {
    const model = defineModel(linked(atom()));
    const store = new Store(
      new Parser().parse(`${header}<${URL}> a ex:Record.
      <${URL}#c0> a ex:Child; ex:flag true; ex:required "yes".`),
    );
    expect(must(model.entities.Record).parse(URL, store)).toBeUndefined();
    const child = new (must(model.entities.Child).Wrapper)(`${URL}#c0`, store, F) as unknown as {
      flag: boolean;
    };
    child.flag = false;
    expect(store.countQuads(`${URL}#c0`, `${EX}flag`, null, null)).toBe(1);
  });
  it.each([
    ["named", `<${URL}#child>`],
    ["blank", "_:child"],
  ])("finds owners through a two-level qualified chain (%s intermediate)", (_label, mid) => {
    const model = defineModel(twoLevel());
    const store = new Store(
      new Parser().parse(`${header}<${URL}> a ex:Record; ex:links ${mid}.
      ${mid} a ex:Child; ex:sub <${URL}#leaf>. <${URL}#leaf> a ex:Leaf; ex:flag true.`),
    );
    expect(must(model.entities.Record).parse(URL, store)).toBeDefined();
    const before = snapshot(store);
    const leaf = new (must(model.entities.Leaf).Wrapper)(`${URL}#leaf`, store, F) as unknown as {
      flag: boolean;
    };
    expect(() => {
      leaf.flag = false;
    }).toThrow(/violates invariant/);
    expect(snapshot(store)).toEqual(before);
    if (mid.startsWith("<")) {
      const child = new (must(model.entities.Child).Wrapper)(
        `${URL}#child`,
        store,
        F,
      ) as unknown as {
        sub: Set<string>;
      };
      expect(() => child.sub.delete(`${URL}#leaf`)).toThrow(/violates invariant/);
      expect(snapshot(store)).toEqual(before);
    }
  });
});

describe("qualified value nodes keep RDF 1.2 base direction distinct", () => {
  const directed = (): ModelManifest => ({
    manifestVersion: 1,
    runtime: { name: "@jeswr/model-runtime", major: 0 },
    prefixes: {},
    entities: [
      {
        name: "Record",
        typeIris: [`${EX}Record`],
        subject: { convention: "self" },
        fields: [{ name: "links", predicate: `${EX}links`, kind: "iri", collection: "set" }],
        invariants: [
          invariant(
            not({
              op: "qualified",
              path: `${EX}links`,
              targetClass: `${EX}Child`,
              minCount: 2,
              expression: not(atom()),
            }),
          ),
        ],
      },
      {
        name: "Child",
        typeIris: [`${EX}Child`],
        subject: { convention: "self" },
        fields: [field("flag")],
      },
    ],
  });
  const store = (objects: string) =>
    new Store(new Parser().parse(`<${URL}> a <${EX}Record>; <${EX}links> ${objects}.`));

  it("counts ltr and rtl literals with the same text as two value nodes", () => {
    const record = entity(directed());
    expect(record.parse(URL, store(`"x", "y"`))).toBeUndefined();
    expect(record.parse(URL, store(`"x"@en--ltr, "x"@en--rtl`))).toBeUndefined();
  });
});
