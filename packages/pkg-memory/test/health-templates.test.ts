// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory as df, Store } from "n3";
import { isomorphic } from "rdf-isomorphic";
import SHACLValidator from "rdf-validate-shacl";
import { describe, expect, it, vi } from "vitest";
import {
  buildNanopublications,
  createFactAssertion,
  type EncounterValue,
  type Fact,
  type HealthCode,
  type HealthTemporalValue,
  type ImmunizationValue,
  type ObservationValue,
  parseAssertion,
  parseNanopublications,
  serializeNanopublications,
} from "../src/index.js";
import * as rdf from "../src/rdf.js";
import { graph, NS, RdfNode } from "../src/rdf.js";
import { exampleBuildOptions } from "../src/testing.js";

const options = exampleBuildOptions();
const owner = options.owner;
const pan = "4111 1111 1111 1111";
const day: HealthTemporalValue = { value: "2026-11-01", datatype: "date" };
const instant: HealthTemporalValue = { value: "2026-11-01T09:00:00Z", datatype: "dateTime" };
const code: HealthCode = {
  id: "https://example.org/codes/temperature",
  system: "https://example.org/schemes/clinical",
  code: "EX-TEMP",
  display: "Fictional temperature code",
};
const observation: ObservationValue = {
  id: "https://example.org/observations/temperature",
  code,
  value: 36.5,
  unitCode: "Cel",
  effective: instant,
  kind: "measurement",
};
const immunization: ImmunizationValue = {
  id: "https://example.org/immunizations/one",
  vaccine: { ...code, id: "https://example.org/products/vaccine", code: "EX-VAC" },
  occurrence: day,
};
const encounter: EncounterValue = {
  id: "https://example.org/encounters/one",
  period: { start: day, end: instant },
  serviceProvider: "https://example.org/providers/clinic",
};
const examples = { observation, immunization, encounter };
type HealthTemplate = keyof typeof examples;
const templates = Object.keys(examples) as HealthTemplate[];

function fact(template: HealthTemplate, value: unknown): Fact {
  return { template, value } as Fact;
}

function assertion(template: HealthTemplate, value: unknown = examples[template]): Store {
  return createFactAssertion(owner, fact(template, value));
}

const prefixes = `
  @prefix health: <${NS.health}> . @prefix core: <${NS.core}> .
  @prefix schema: <${NS.schema}> . @prefix time: <${NS.time}> .
  @prefix xsd: <${NS.xsd}> .
`;

async function matches(store: Store, body: string): Promise<void> {
  const expected = await parseAssertion(prefixes + body, owner);
  expect(isomorphic([...store], [...expected])).toBe(true);
}

describe("health fact graphs", () => {
  it("emits a complete canonical measurement with exactly one decimal value", async () => {
    await matches(
      assertion("observation"),
      `
      <${owner}> a core:Person .
      <${observation.id}> a health:Observation ; health:patient <${owner}> ;
        health:hasCode <${code.id}> ; health:value "36.5"^^xsd:decimal ;
        health:unitCode "Cel" ; schema:category "measurement" ;
        health:effectiveTime [ a time:Instant, time:TemporalEntity ;
          time:inXSDDateTime "2026-11-01T09:00:00+00:00"^^xsd:dateTime ] .
      <${code.id}> a health:CodeableConcept, core:Identifier ;
        core:value "EX-TEMP" ; core:inScheme <${code.system}> ;
        schema:name "Fictional temperature code" .
      <${code.system}> a core:IdentifierScheme .
    `,
    );
  });

  it("emits a string lab result at day precision and omits absent options", async () => {
    const value = {
      ...observation,
      code: { id: code.id, code: "EX-LAB", system: code.system },
      value: "Negative",
      effective: day,
      unitCode: undefined,
      kind: "lab",
    };
    const store = assertion("observation", value);
    await matches(
      store,
      `
      <${owner}> a core:Person .
      <${observation.id}> a health:Observation ; health:patient <${owner}> ;
        health:hasCode <${code.id}> ; health:value "Negative" ; schema:category "lab" ;
        health:effectiveTime [ a time:Instant, time:TemporalEntity ;
          time:inXSDDate "2026-11-01"^^xsd:date ] .
      <${code.id}> a health:CodeableConcept, core:Identifier ; core:value "EX-LAB" ;
        core:inScheme <${code.system}> .
      <${code.system}> a core:IdentifierScheme .
    `,
    );
    const uncategorized = assertion("observation", { ...value, kind: undefined });
    expect(uncategorized.getQuads(null, `${NS.schema}category`, null, null)).toEqual([]);
  });

  it.each([
    [0, "0"],
    [-0, "-0"],
    [-12.5, "-12.5"],
    [1e21, `1${"0".repeat(21)}`],
    [-1.2345e21, `-12345${"0".repeat(17)}`],
    [1e-7, "0.0000001"],
    [-1.25e-7, "-0.000000125"],
    [Number.MIN_VALUE, `0.${"0".repeat(323)}5`],
    [Number.MAX_VALUE, `17976931348623157${"0".repeat(292)}`],
  ])("encodes %s with the package's fixed-point decimal policy", (value, expected) => {
    const store = assertion("observation", { ...observation, value });
    const measured = store.getQuads(observation.id, `${NS.health}value`, null, null)[0]?.object;
    expect(measured).toEqual(df.literal(expected, df.namedNode(`${NS.xsd}decimal`)));
  });

  it.each([
    "1.10",
    "-1.100",
    "0.0000",
    "-0",
    "12",
  ])("retains decimal precision for %s", (decimal) => {
    const store = assertion("observation", { ...observation, value: { decimal } });
    expect(store.getQuads(observation.id, `${NS.health}value`, null, null)[0]?.object).toEqual(
      df.literal(decimal, df.namedNode(`${NS.xsd}decimal`)),
    );
  });

  it("accepts HTTP identifiers, percent-encoded safe slugs, and a coded vaccine without display", () => {
    expect(
      assertion("observation", { ...observation, id: "http://example.org/observations/one" }).size,
    ).toBeGreaterThan(0);
    expect(
      assertion("encounter", {
        ...encounter,
        serviceProvider: "https://example.org/clinic%25252541",
      }).size,
    ).toBeGreaterThan(0);
    expect(
      assertion("immunization", {
        ...immunization,
        vaccine: { id: immunization.vaccine.id, code: code.code, system: code.system },
      }).size,
    ).toBeGreaterThan(0);
  });

  it("emits a vaccine product with a nested code and occurrence", async () => {
    await matches(
      assertion("immunization"),
      `
      <${owner}> a core:Person .
      <${immunization.id}> a health:Immunization ; health:patient <${owner}> ;
        health:medication <${immunization.vaccine.id}> ;
        core:atTime [ a time:Instant, time:TemporalEntity ;
          time:inXSDDate "2026-11-01"^^xsd:date ] .
      <${immunization.vaccine.id}> a health:MedicinalProduct ;
        schema:name "Fictional temperature code" ; core:identifiedBy [
          a health:CodeableConcept, core:Identifier ; core:value "EX-VAC" ;
          core:inScheme <${code.system}> ; schema:name "Fictional temperature code"
        ] .
      <${code.system}> a core:IdentifierScheme .
    `,
    );
  });

  it("accepts a vaccine entity without optional coding", async () => {
    await matches(
      assertion("immunization", {
        id: immunization.id,
        vaccine: { id: immunization.vaccine.id },
        occurrence: instant,
      }),
      `
      <${owner}> a core:Person .
      <${immunization.id}> a health:Immunization ; health:patient <${owner}> ;
        health:medication <${immunization.vaccine.id}> ;
        core:atTime [ a time:Instant, time:TemporalEntity ;
          time:inXSDDateTime "2026-11-01T09:00:00+00:00"^^xsd:dateTime ] .
      <${immunization.vaccine.id}> a health:MedicinalProduct .
    `,
    );
  });

  it("emits an encounter's provider link and interval endpoints", async () => {
    await matches(
      assertion("encounter"),
      `
      <${owner}> a core:Person .
      <${encounter.id}> a health:Encounter ; health:patient <${owner}> ;
        health:careProvider <${encounter.serviceProvider}> ;
        core:atTime [ a time:Interval, time:TemporalEntity ;
          time:hasBeginning [ a time:Instant, time:TemporalEntity ;
            time:inXSDDate "2026-11-01"^^xsd:date ] ;
          time:hasEnd [ a time:Instant, time:TemporalEntity ;
            time:inXSDDateTime "2026-11-01T09:00:00+00:00"^^xsd:dateTime ]
        ] .

    `,
    );
  });

  it("accepts an open-ended encounter without a provider", async () => {
    await matches(
      assertion("encounter", { id: encounter.id, period: { start: instant } }),
      `
      <${owner}> a core:Person .
      <${encounter.id}> a health:Encounter ; health:patient <${owner}> ;
        core:atTime [ a time:Interval, time:TemporalEntity ;
          time:hasBeginning [ a time:Instant, time:TemporalEntity ;
            time:inXSDDateTime "2026-11-01T09:00:00+00:00"^^xsd:dateTime ]
        ] .
    `,
    );
  });
});

describe("health template refusal boundaries", () => {
  const invalidObjects: unknown[] = [undefined, null, "text", 42, true, [], () => null];
  const invalidIris = [
    undefined,
    null,
    42,
    "relative",
    "javascript:alert(1)",
    "urn:x:unsafe value",
    "urn:example:clinical",
    "tel:+441234567890",
    "mailto:patient@example.org",
    "file:///clinical",
    "https://example.org/unsafe value",
    "https://example.org/%",
    "https://example.org/%FF",
    owner,
    "https://example.org/4111111111111111",
    "https://example.org/?card=4111%201111%201111%201111",
    "https://example.org/#4111%25201111%25201111%25201111",
    "https://example.org/%EF%BC%94%EF%BC%91%EF%BC%91%EF%BC%91%EF%BC%91%EF%BC%91%EF%BC%91%EF%BC%91%EF%BC%91%EF%BC%91%EF%BC%91%EF%BC%91%EF%BC%91%EF%BC%91%EF%BC%91%EF%BC%91",
    `https://example.org/${"4111%201111%201111%201111".replaceAll("%", "%25252525")}`,
  ];
  const invalidTimes: unknown[] = [
    ...invalidObjects,
    {},
    { ...day, extra: "secret" },
    { ...day, value: 42 },
    { ...day, value: undefined },
    { ...day, value: "2026-02-30" },
    { ...day, value: "0000-01-01" },
    { ...instant, value: "0000-01-01T09:00:00Z" },
    { ...instant, value: "2026-11-01T09:00:00" },
    { ...instant, value: "2026-11-01T09:00:00+14:01" },
    { ...instant, value: "2026-02-29T09:00:00Z" },
    { ...day, value: "2026-13-01" },
    { ...day, value: "2026-11-01\n" },
    { value: "2026-11", datatype: "gYearMonth" },
    { value: "2026", datatype: "gYear" },
    { ...instant, datatype: "dateTimeStamp" },
    { ...instant, value: "2026-11-01T25:00:00Z" },
    { ...instant, value: "2026-11-01T09:00:00Z\n" },
    { ...day, datatype: "__proto__" },
    { ...day, datatype: undefined },
  ];

  function refuses(template: HealthTemplate, value: unknown): void {
    expect(() => createFactAssertion(owner, fact(template, value))).toThrow(
      new Error(`Invalid ${template}`),
    );
  }

  for (const template of templates) {
    it(`${template}: refuses invalid roots, keys, IRIs and throwing getters/proxies`, () => {
      for (const value of invalidObjects) refuses(template, value);
      const base = examples[template];
      for (const id of invalidIris) refuses(template, { ...base, id });
      refuses(template, { ...base, unknown: "secret" });
      refuses(template, Object.defineProperty({ ...base }, "hidden", { value: pan }));
      refuses(template, { ...base, [Symbol("secret")]: pan });
      refuses(
        template,
        Object.defineProperty({ ...base }, "id", {
          get: () => {
            throw new Error(pan);
          },
        }),
      );
      refuses(
        template,
        new Proxy(base, {
          ownKeys: () => {
            throw new Error(pan);
          },
        }),
      );
    });
  }

  it("refuses invalid measured values, categories, units and literal characters", () => {
    for (const value of [
      undefined,
      null,
      true,
      {},
      [],
      1n,
      NaN,
      Infinity,
      -Infinity,
      pan,
      "bad\u2028",
    ])
      refuses("observation", { ...observation, value });
    for (const kind of [null, 42, "unknown", pan]) refuses("observation", { ...observation, kind });
    for (const unitCode of [null, 42, pan, "bad\u2028"])
      refuses("observation", { ...observation, unitCode });
  });

  for (const [template, field] of [
    ["observation", "code"],
    ["immunization", "vaccine"],
  ] as const) {
    it(`${template}: validates every code field and nested key`, () => {
      const base = examples[template];
      for (const value of invalidObjects.filter((v) => v !== undefined))
        refuses(template, { ...base, [field]: value });
      for (const id of invalidIris) refuses(template, { ...base, [field]: { ...code, id } });
      for (const system of invalidIris)
        refuses(template, { ...base, [field]: { ...code, system } });
      for (const invalid of [null, 42, pan, "bad\u2028"]) {
        refuses(template, { ...base, [field]: { ...code, code: invalid } });
        refuses(template, { ...base, [field]: { ...code, display: invalid } });
      }
      refuses(template, { ...base, [field]: { ...code, unknown: pan } });
      if (template !== "immunization") refuses(template, { ...base, [field]: { id: code.id } });
      refuses(template, { ...base, [field]: { id: code.id, code: "EX-NO-SYSTEM" } });
    });
  }

  it("requires an observation code and a vaccine product, and refuses a scheme without its code", () => {
    refuses("observation", { ...observation, code: undefined });
    refuses("immunization", { ...immunization, vaccine: undefined });
    refuses("immunization", {
      ...immunization,
      vaccine: { id: code.id, system: code.system },
    });
  });

  it("checks temporal types and lexical forms for every clinical time", () => {
    for (const time of invalidTimes) {
      refuses("observation", { ...observation, effective: time });
      refuses("immunization", { ...immunization, occurrence: time });
      refuses("encounter", { ...encounter, period: { start: time } });
      if (time !== undefined)
        refuses("encounter", { ...encounter, period: { start: day, end: time } });
    }
  });

  it("checks encounter period fields and provider IRIs", () => {
    for (const period of [...invalidObjects, {}, { start: day, unknown: pan }])
      refuses("encounter", { ...encounter, period });
    for (const serviceProvider of invalidIris.filter((v) => v !== undefined))
      refuses("encounter", { ...encounter, serviceProvider });
  });

  it("scans all free text for card numbers, including Unicode and separated forms", () => {
    for (const text of [pan, "４１１１１１１１１１１１１１１１", "4111\u200b1111—1111.1111"]) {
      refuses("observation", { ...observation, value: text });
      refuses("observation", { ...observation, code: { ...code, display: text } });
      refuses("immunization", { ...immunization, vaccine: { ...code, display: text } });
    }
  });

  it("rejects every pair of equal identifiers and every identifier equal to the owner", () => {
    for (const template of ["observation", "immunization"] as const) {
      const field = template === "observation" ? "code" : "vaccine";
      const base = examples[template];
      refuses(template, { ...base, [field]: { ...code, id: base.id } });
      refuses(template, { ...base, [field]: { ...code, system: base.id } });
      refuses(template, { ...base, [field]: { ...code, system: code.id } });
      refuses(template, { ...base, [field]: { ...code, id: owner } });
      refuses(template, { ...base, [field]: { ...code, system: owner } });
    }
    refuses("encounter", { ...encounter, serviceProvider: encounter.id });
  });

  it("rejects malformed decimals and removed vocabulary-gap fields", () => {
    for (const decimal of [
      undefined,
      null,
      1.1,
      "+1.10",
      "01.10",
      ".10",
      "1.",
      "1e2",
      "1.10\n",
      "bad\u2028",
      pan,
    ]) {
      refuses("observation", { ...observation, value: { decimal } });
    }
    refuses("observation", { ...observation, value: { decimal: "1.10", extra: "secret" } });
    refuses("immunization", { ...immunization, lotNumber: "EX-LOT" });
    refuses("encounter", { ...encounter, type: code });
  });

  it("ignores inherited options and refuses inherited required fields at every nesting level", () => {
    function inheriting(record: object, key: string, value: unknown): object {
      const { [key]: _removed, ...own } = record as Record<string, unknown>;
      return Object.assign(Object.create({ [key]: value }), own);
    }
    for (const template of templates) {
      refuses(template, Object.create(examples[template]));
      for (const key of template === "observation"
        ? ["id", "code", "value", "effective"]
        : template === "immunization"
          ? ["id", "vaccine", "occurrence"]
          : ["id", "period"]) {
        refuses(
          template,
          inheriting(
            examples[template],
            key,
            (examples[template] as unknown as Record<string, unknown>)[key],
          ),
        );
      }
      const outer = Object.assign(Object.create({ value: examples[template] }), { template });
      expect(() => createFactAssertion(owner, outer)).toThrow(new Error(`Invalid ${template}`));
    }
    expect(() =>
      createFactAssertion(owner, Object.create({ template: "observation", value: observation })),
    ).toThrow("Unknown fact template");
    for (const key of ["id", "code", "system"]) {
      refuses("observation", {
        ...observation,
        code: inheriting(code, key, code[key as keyof HealthCode]),
      });
      refuses("immunization", {
        ...immunization,
        vaccine: inheriting(code, key, code[key as keyof HealthCode]),
      });
    }
    for (const key of ["value", "datatype"]) {
      const time = inheriting(instant, key, instant[key as keyof HealthTemporalValue]);
      refuses("observation", { ...observation, effective: time });
      refuses("immunization", { ...immunization, occurrence: time });
      refuses("encounter", { ...encounter, period: { start: time } });
    }
    refuses("encounter", { ...encounter, period: inheriting({ start: day }, "start", day) });
    refuses("observation", { ...observation, value: Object.create({ decimal: "1.10" }) });
    const inheritedSecret = Object.create(null);
    for (const key of ["kind", "unitCode", "serviceProvider", "end", "display", "code", "system"]) {
      Object.defineProperty(inheritedSecret, key, {
        get: () => {
          throw new Error(pan);
        },
      });
    }
    const onSecret = (own: object) => Object.setPrototypeOf({ ...own }, inheritedSecret);
    const minimalObservation = {
      id: observation.id,
      code: { id: code.id, code: code.code, system: code.system },
      value: 1,
      effective: day,
    };
    expect(
      isomorphic(
        [
          ...assertion(
            "observation",
            onSecret({ ...minimalObservation, code: onSecret(minimalObservation.code) }),
          ),
        ],
        [...assertion("observation", minimalObservation)],
      ),
    ).toBe(true);
    const minimalVaccine = { id: immunization.vaccine.id };
    expect(
      isomorphic(
        [...assertion("immunization", { ...immunization, vaccine: onSecret(minimalVaccine) })],
        [...assertion("immunization", { ...immunization, vaccine: minimalVaccine })],
      ),
    ).toBe(true);
    const minimalEncounter = { id: encounter.id, period: { start: day } };
    expect(
      isomorphic(
        [
          ...assertion(
            "encounter",
            onSecret({ ...minimalEncounter, period: onSecret(minimalEncounter.period) }),
          ),
        ],
        [...assertion("encounter", minimalEncounter)],
      ),
    ).toBe(true);
  });

  it("rejects reversed intervals across precisions, offsets, days and microseconds", () => {
    const dt = (value: string): HealthTemporalValue => ({ value, datatype: "dateTime" });
    const date = (value: string): HealthTemporalValue => ({ value, datatype: "date" });
    for (const [start, end] of [
      [date("2026-11-02"), day],
      [dt("2026-11-02T00:00:00Z"), day],
      [day, dt("2026-10-31T23:59:59.999999Z")],
      [dt("2026-11-01T09:00:00Z"), dt("2026-11-01T10:00:00+02:00")],
      [dt("2026-11-01T09:00:00.000002Z"), dt("2026-11-01T09:00:00.000001Z")],
      [dt("2026-11-01T24:00:00Z"), dt("2026-11-01T23:59:59Z")],
    ])
      refuses("encounter", { ...encounter, period: { start, end } });
    for (const [start, end] of [
      [day, day],
      [instant, day],
      [day, instant],
      [instant, instant],
      [dt("2026-11-01T10:00:00+02:00"), instant],
      [dt("2026-11-01T23:00:00-02:00"), date("2026-11-02")],
      [dt("2026-11-01T24:00:00.000Z"), dt("2026-11-02T00:00:00Z")],
      [dt("0001-01-01T00:00:00Z"), dt("0001-01-01T00:00:00.000001Z")],
    ])
      expect(assertion("encounter", { ...encounter, period: { start, end } }).size).toBeGreaterThan(
        0,
      );
  });

  it("lets programming errors surface from snapshot helpers and RDF builds", () => {
    const bug = new Error("programming error");
    try {
      vi.spyOn(rdf, "normalizeLiteral").mockImplementationOnce(() => {
        throw bug;
      });
      expect(() => assertion("observation")).toThrow(bug);
      vi.spyOn(rdf, "dateTime").mockImplementationOnce(() => {
        throw bug;
      });
      expect(() => assertion("observation")).toThrow(bug);
      for (const template of templates) {
        vi.spyOn(RdfNode.prototype, "link").mockImplementationOnce(() => {
          throw bug;
        });
        expect(() => assertion(template)).toThrow(bug);
      }
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("reads every field and nested field once before building from the snapshot", () => {
    function swapping(value: unknown): unknown {
      if (typeof value !== "object" || value === null) return value;
      const fields = Object.entries(value).map(([key, child]) => [key, swapping(child)]);
      const reads = new Set<PropertyKey>();
      return new Proxy(Object.fromEntries(fields), {
        get: (target, key) => {
          expect(reads.has(key), `re-read ${String(key)}`).toBe(false);
          reads.add(key);
          return Reflect.get(target, key);
        },
      });
    }
    for (const template of templates) {
      const value = swapping(examples[template]);
      expect(isomorphic([...assertion(template, value)], [...assertion(template)])).toBe(true);
      let reads = 0;
      const nextValue = swapping(examples[template]);
      const top = Object.defineProperty({ template }, "value", {
        get: () => {
          expect(reads++).toBe(0);
          return nextValue;
        },
      });
      expect(
        isomorphic([...createFactAssertion(owner, top as Fact)], [...assertion(template)]),
      ).toBe(true);
      expect(reads).toBe(1);
    }
  });
});

/** Mirror shacl-fixtures.mjs: group local sector shapes, then recursively follow ontology imports. */
async function combinedHealthShapes(): Promise<Store> {
  const root = dirname(
    fileURLToPath(import.meta.resolve("@jeswr/solid-federation-vocab/package.json")),
  );
  const sectors = join(root, "sectors");
  const parse = async (file: string) =>
    new Store([
      ...(await parseRdf(await readFile(file, "utf8"), "text/turtle", {
        baseIRI: pathToFileURL(file).href,
      })),
    ]);
  const profiles = new Map<string, { shapes: Store; ontology: Store }>();
  for (const file of (await readdir(sectors, { recursive: true }))
    .filter((name) => name.endsWith(".shacl.ttl"))
    .sort()) {
    const directory = dirname(join(sectors, file));
    if (!profiles.has(directory)) {
      const ontology = join(directory, `${basename(directory)}.ttl`);
      profiles.set(directory, {
        shapes: new Store(),
        ontology: existsSync(ontology) ? await parse(ontology) : new Store(),
      });
    }
    profiles.get(directory)?.shapes.addQuads([...(await parse(join(sectors, file)))]);
  }
  const shapes = new Store();
  const included = new Set<object>();
  const owl = "http://www.w3.org/2002/07/owl#";
  function include(profile: { shapes: Store; ontology: Store }): void {
    if (included.has(profile)) return;
    included.add(profile);
    shapes.addQuads([...profile.shapes]);
    for (const imported of profile.ontology.getObjects(null, `${owl}imports`, null)) {
      const dependency = [...profiles.values()].find(
        ({ ontology }) =>
          ontology.countQuads(imported, `${NS.rdf}type`, `${owl}Ontology`, null) ||
          ontology.countQuads(null, `${owl}versionIRI`, imported, null),
      );
      if (dependency) include(dependency);
    }
  }
  const health = profiles.get(join(sectors, "health"));
  expect(health).toBeDefined();
  include(health as NonNullable<typeof health>);
  return shapes;
}

describe("health nanopublications and profile conformance", () => {
  it("builds, serializes and parses all three templates with stable graphs and provenance", async () => {
    const built = await buildNanopublications(
      {
        batch_id: "health-templates",
        worker: { agent_id: "https://example.org/agents/test", agent_label: "Synthetic" },
        sources: [{ id: "doc", kind: "document", url: "https://example.org/health-record" }],
        claims: templates.map((template) => ({
          id: template,
          epistemic: "Documented" as const,
          categories: ["pd:Health"],
          assertion: assertion(template),
          evidence: [{ source: "doc", quote: "A fictional clinical entry." }],
        })),
      },
      options,
    );
    const trig = await serializeNanopublications(built);
    expect(trig).not.toContain("https://w3id.org/jeswr/");
    const parsed = await parseNanopublications(trig);
    expect(parsed.nanopubs).toEqual(built.nanopubs);
    expect(isomorphic([...parsed.dataset], [...built.dataset])).toBe(true);
    for (const nanopub of parsed.nanopubs) {
      const contents = graph(parsed.dataset, nanopub.assertionId);
      expect([...contents].every((q) => q.subject.termType === "NamedNode")).toBe(true);
      expect([...contents].some((q) => q.predicate.value === `${NS.health}patient`)).toBe(true);
    }
  });

  it("conforms to health + imported Core MUSTs, checks SHOULD warnings, and detects broken graphs", async () => {
    const shapes = await combinedHealthShapes();
    expect(shapes.countQuads(`${NS.core}IdentifierShape`, null, null, null)).toBeGreaterThan(0);
    expect(shapes.countQuads(`${NS.core}OrganizationShape`, null, null, null)).toBeGreaterThan(0);
    const validator = new SHACLValidator(shapes);
    const mustFailures = async (data: Store) =>
      (await validator.validate(data)).results.filter(
        (result) => result.severity.value === "http://www.w3.org/ns/shacl#Violation",
      );
    for (const template of templates) {
      const data = assertion(template);
      expect(await mustFailures(data)).toEqual([]);
      data.removeQuads(data.getQuads(null, `${NS.health}patient`, null, null));
      expect((await mustFailures(data)).length).toBeGreaterThan(0);
    }
    for (const predicate of [
      `${NS.health}hasCode`,
      `${NS.health}value`,
      `${NS.health}effectiveTime`,
      `${NS.core}value`,
      `${NS.core}inScheme`,
    ]) {
      const data = assertion("observation");
      data.removeQuads(data.getQuads(null, predicate, null, null));
      expect((await mustFailures(data)).length).toBeGreaterThan(0);
    }
    for (const [template, value] of [
      [
        "observation",
        {
          id: observation.id,
          code: { id: code.id, code: code.code, system: code.system },
          value: { decimal: "1.10" },
          effective: day,
        },
      ],
      [
        "immunization",
        { id: immunization.id, vaccine: { id: immunization.vaccine.id }, occurrence: instant },
      ],
      ["encounter", { id: encounter.id, period: { start: day } }],
    ] as const)
      expect(await mustFailures(assertion(template, value))).toEqual([]);
    const warnings = (await validator.validate(assertion("encounter"))).results.filter(
      (result) => result.severity.value === "http://www.w3.org/ns/shacl#Warning",
    );
    expect(warnings.some((result) => result.path?.value === `${NS.health}recordedBy`)).toBe(true);
    const missingOrganizationId = assertion("encounter");
    new RdfNode(encounter.serviceProvider as string, missingOrganizationId).link(
      `${NS.rdf}type`,
      `${NS.core}Organization`,
    );
    expect(
      (await mustFailures(missingOrganizationId)).some(
        (result) => result.path?.value === `${NS.core}identifiedBy`,
      ),
    ).toBe(true);
    const duplicate = assertion("observation");
    new RdfNode(observation.id, duplicate).text(`${NS.health}value`, "extra");
    expect((await mustFailures(duplicate)).length).toBeGreaterThan(0);
    const vaccine = assertion("immunization");
    vaccine.removeQuads(vaccine.getQuads(null, `${NS.health}medication`, null, null));
    expect((await mustFailures(vaccine)).length).toBeGreaterThan(0);
  });
});
