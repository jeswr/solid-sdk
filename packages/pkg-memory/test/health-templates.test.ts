// AUTHORED-BY Codex GPT-6.1-Sol
import { readFile } from "node:fs/promises";
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory as df, type Store } from "n3";
import { isomorphic } from "rdf-isomorphic";
import { describe, expect, it } from "vitest";
// Reuse the vocabulary package's installed test dependency; no additional dependency.
import SHACLValidator from "../../solid-federation-vocab/node_modules/rdf-validate-shacl/index.js";
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
  lotNumber: "EX-LOT",
};
const encounter: EncounterValue = {
  id: "https://example.org/encounters/one",
  type: code,
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
      code: { id: code.id, code: "EX-LAB" },
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
      <${code.id}> a health:CodeableConcept, core:Identifier ; core:value "EX-LAB" .
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

  it("emits a vaccine product with a nested code, occurrence and lot", async () => {
    await matches(
      assertion("immunization"),
      `
      <${owner}> a core:Person .
      <${immunization.id}> a health:Immunization ; health:patient <${owner}> ;
        health:medication <${immunization.vaccine.id}> ; schema:lotNumber "EX-LOT" ;
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

  it("accepts a vaccine entity without optional coding or lot information", async () => {
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

  it("emits an encounter's type, provider and interval endpoints", async () => {
    await matches(
      assertion("encounter"),
      `
      <${owner}> a core:Person .
      <${encounter.id}> a health:Encounter ; health:patient <${owner}> ;
        schema:additionalType <${code.id}> ; health:careProvider <${encounter.serviceProvider}> ;
        core:atTime [ a time:Interval, time:TemporalEntity ;
          time:hasBeginning [ a time:Instant, time:TemporalEntity ;
            time:inXSDDate "2026-11-01"^^xsd:date ] ;
          time:hasEnd [ a time:Instant, time:TemporalEntity ;
            time:inXSDDateTime "2026-11-01T09:00:00+00:00"^^xsd:dateTime ]
        ] .
      <${code.id}> a health:CodeableConcept, core:Identifier ;
        core:value "EX-TEMP" ; core:inScheme <${code.system}> ;
        schema:name "Fictional temperature code" .
      <${code.system}> a core:IdentifierScheme .
      <${encounter.serviceProvider}> a core:Organization .
    `,
    );
  });

  it("accepts an open-ended encounter without a type or provider", async () => {
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
  ];
  const invalidTimes: unknown[] = [
    ...invalidObjects,
    {},
    { ...day, extra: "secret" },
    { ...day, value: 42 },
    { ...day, value: undefined },
    { ...day, value: "2026-02-30" },
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
    for (const lotNumber of [null, 42, pan, "bad\u2028"])
      refuses("immunization", { ...immunization, lotNumber });
  });

  for (const [template, field] of [
    ["observation", "code"],
    ["immunization", "vaccine"],
    ["encounter", "type"],
  ] as const) {
    it(`${template}: validates every code field and nested key`, () => {
      const base = examples[template];
      for (const value of invalidObjects.filter((v) => v !== undefined))
        refuses(template, { ...base, [field]: value });
      for (const id of invalidIris) refuses(template, { ...base, [field]: { ...code, id } });
      for (const system of invalidIris.filter((v) => v !== undefined))
        refuses(template, { ...base, [field]: { ...code, system } });
      for (const invalid of [null, 42, pan, "bad\u2028"]) {
        refuses(template, { ...base, [field]: { ...code, code: invalid } });
        refuses(template, { ...base, [field]: { ...code, display: invalid } });
      }
      refuses(template, { ...base, [field]: { ...code, unknown: pan } });
      if (template !== "immunization") refuses(template, { ...base, [field]: { id: code.id } });
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
      refuses("immunization", { ...immunization, lotNumber: text });
      refuses("encounter", { ...encounter, type: { ...code, display: text } });
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

  it("conforms to the health profile's MUSTs and detects deliberately broken graphs", async () => {
    const shapes = await parseRdf(
      await readFile(
        new URL("../../solid-federation-vocab/sectors/health/health.shacl.ttl", import.meta.url),
        "utf8",
      ),
      "text/turtle",
    );
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
    ]) {
      const data = assertion("observation");
      data.removeQuads(data.getQuads(null, predicate, null, null));
      expect((await mustFailures(data)).length).toBeGreaterThan(0);
    }
    const duplicate = assertion("observation");
    new RdfNode(observation.id, duplicate).text(`${NS.health}value`, "extra");
    expect((await mustFailures(duplicate)).length).toBeGreaterThan(0);
    const vaccine = assertion("immunization");
    vaccine.removeQuads(vaccine.getQuads(null, `${NS.health}medication`, null, null));
    expect((await mustFailures(vaccine)).length).toBeGreaterThan(0);
  });
});
