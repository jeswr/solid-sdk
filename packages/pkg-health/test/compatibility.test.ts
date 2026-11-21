// AUTHORED-BY Codex GPT-6.1-Sol
import {
  createFactAssertion,
  type Fact,
  parseNanopublications,
  serializeNanopublications,
} from "@jeswr/pkg-memory";
import { NamedGraphDataset, SetFrom, TermAs, TermFrom } from "@rdfjs/wrapper";
import { DataFactory as df, Store } from "n3";
import { expect, it } from "vitest";
import { entities } from "../src/generated/model.js";
import { healthTimeline, observationSeries, projectHealthFacts } from "../src/index.js";
import { ReadNode, TIME, XSD } from "../src/read.js";
import { temporalTime } from "../src/temporal.js";
import {
  batch,
  claim,
  condition,
  FixtureNode,
  H,
  medication,
  observation,
  owner,
  S,
  X,
} from "./helpers.js";

it("reads all legacy class/predicate aliases, including mixed graphs, without rewriting terms", async () => {
  const inputs = [
    createFactAssertion(owner, medication()),
    observation({ date: "2026-10-01T00:00:00Z" }),
    entities.Encounter.build("https://example.org/entities/visit", {
      patient: owner,
      name: "Visit",
      recordedBy: owner,
    }),
    entities.Immunization.build("https://example.org/entities/vaccine", {
      patient: owner,
      name: "Vaccine",
    }),
  ];
  const legacy = inputs.map((graph) => {
    const result = new Store();
    for (const q of graph) {
      const predicate = q.predicate.value.replace(H, "https://w3id.org/jeswr/sectors/health#");
      const object =
        q.object.termType === "NamedNode"
          ? df.namedNode(q.object.value.replace(H, "https://w3id.org/jeswr/sectors/health#"))
          : q.object;
      new FixtureNode(q.subject, result).link(predicate, object);
    }
    return result;
  });
  const value = await parseNanopublications(
    await serializeNanopublications(
      await batch(legacy.map((assertion, i) => ({ ...claim(String(i)), assertion }))),
    ),
  );
  const view = projectHealthFacts(value, { owner });
  expect(view.byKind.medication[0]).toMatchObject({
    product: { name: "Fictionalium", atcCode: "C01AA00" },
    dose: { value: "2.00" },
  });
  expect(view.byKind.observation[0]).toMatchObject({
    value: 72,
    unit: "/min",
    effectiveTime: "2026-10-01T00:00:00+00:00",
  });
  expect(view.byKind.encounter[0]).toMatchObject({ recordedBy: owner });
  expect(view.byKind.immunization).toHaveLength(1);
});
it.each([
  "https://schema.org/MedicalCondition",
  "http://hl7.org/fhir/Observation",
  "https://schema.org/Observation",
])("recognises external type %s and FHIR/schema patient links", async (type) => {
  const store = type.endsWith("MedicalCondition")
    ? createFactAssertion(owner, condition())
    : observation({ date: "2026-10-01", dateType: "date" });
  const id = type.endsWith("MedicalCondition")
    ? "https://example.org/entities/condition"
    : "https://example.org/observations/one";
  store.removeQuads(
    store.getQuads(id, "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", null, null),
  );
  store.removeQuads(store.getQuads(id, `${H}patient`, null, null));
  new FixtureNode(id, store)
    .link("http://www.w3.org/1999/02/22-rdf-syntax-ns#type", type)
    .link(type.startsWith("http://hl7") ? "http://hl7.org/fhir/subject" : `${S}subject`, owner);
  expect(
    projectHealthFacts(await batch([{ ...claim("one"), assertion: store, categories: [] }]), {
      owner,
    }).facts,
  ).toHaveLength(1);
});
it("keeps category-qualified records without a patient and ignores unqualified records without a patient", async () => {
  const graph = entities.Condition.build("https://example.org/entities/unowned", {
    name: "Unlinked health fact",
  });
  const view = projectHealthFacts(
    await batch([
      { ...claim("category"), assertion: graph },
      { ...claim("not-category"), assertion: graph, categories: [] },
    ]),
    { owner },
  );
  expect(view.facts).toHaveLength(1);
  expect(view.excludedOtherSubjects).toBe(0);
});
it("reads blank linked products and codes and all recognized code systems", async () => {
  const inputs = [
    ["http://snomed.info/id/195967001", "snomed"],
    ["https://loinc.org/8867-4", "loinc"],
    ["https://id.who.int/icd/release/10/I10", "icd10"],
    ["http://purl.bioontology.org/ontology/ATC/C01AA00", "atc"],
    ["https://dmd.nhs.uk/EX", "dmd"],
    ["https://example.org/concepts/EX", "other"],
  ];
  const claims = inputs.map(([iri], i) =>
    claim(String(i), {
      template: "condition",
      value: {
        id: `https://example.org/entities/condition-${i}`,
        name: "Fictional coded",
        code: { id: `https://example.org/codes/${i}`, value: "EX", exactMatch: iri },
      },
    } as Fact),
  );
  const view = projectHealthFacts(await batch(claims), { owner });
  expect(view.facts.map((f) => f.code?.system).sort()).toEqual(
    inputs.map(([, system]) => system).sort(),
  );
  const graph = entities.MedicationStatement.build("https://example.org/entities/statement", {
    patient: owner,
  });
  const product = df.blankNode(),
    code = df.blankNode();
  new FixtureNode("https://example.org/entities/statement", graph)
    .link(`${H}medication`, product)
    .link(`${H}hasCode`, code);
  new FixtureNode(product, graph).text(`${S}name`, "Fictional blank product");
  new FixtureNode(code, graph)
    .text("https://w3id.org/jeswr/core#value", "EX")
    .link("http://www.w3.org/2004/02/skos/core#exactMatch", "https://example.org/code/EX");
  // Parser accepts a hand-authored external blank-node graph; the builder normally skolemizes it.
  const built = await batch([{ ...claim("blank"), assertion: graph }]);
  const np = built.nanopubs[0];
  if (!np) throw new Error("Missing fixture");
  const assertion = new NamedGraphDataset(df.namedNode(np.assertionId), built.dataset, df);
  const statement = new FixtureNode("https://example.org/entities/statement", assertion);
  const links = SetFrom.subjectPredicate(statement, `${H}hasCode`, TermAs.term, TermFrom.itself);
  links.clear();
  links.add(code);
  new FixtureNode(code, assertion).text("https://w3id.org/jeswr/core#value", "EX");
  const products = SetFrom.subjectPredicate(
    statement,
    `${H}medication`,
    TermAs.term,
    TermFrom.itself,
  );
  products.clear();
  products.add(product);
  new FixtureNode(product, assertion).text(`${S}name`, "Fictional blank product");
  expect(projectHealthFacts(built, { owner }).byKind.medication[0]).toMatchObject({
    product: { name: "Fictional blank product" },
    code: { value: "EX", system: "other" },
  });
});
it("preserves numeric precision, string/non-value records and incomplete medication fields", async () => {
  const large = observation({
    id: "large",
    value: "9007199254740993",
    date: "2026-01-01",
    dateType: "date",
  });
  const precise = observation({
    id: "precise",
    value: "1.234567890123456789",
    datatype: "decimal",
    date: "2026-01-01",
    dateType: "date",
  });
  const wrong = observation({ id: "wrong", value: "true", datatype: "boolean" });
  const incomplete = entities.MedicationStatement.build(
    "https://example.org/entities/missing-product",
    { patient: owner },
  );
  const view = projectHealthFacts(
    await batch(
      [large, precise, wrong, incomplete].map((assertion, i) => ({
        ...claim(String(i)),
        assertion,
      })),
    ),
    { owner },
  );
  expect(view.byKind.observation.map((f) => f.kind === "observation" && f.value).sort()).toEqual([
    "1.234567890123456789",
    "9007199254740993",
  ]);
  expect(view.unrecognised).toHaveLength(1);
  expect(observationSeries(view)).toEqual({ series: [], skipped: 2 });
  expect(view.byKind.medication[0]).toMatchObject({
    product: { name: "Medication" },
    dose: undefined,
  });
});
it("drops ambiguous values, preserves language labels, and does not fall back from conflicting canonical values", async () => {
  const graph = createFactAssertion(owner, condition());
  new FixtureNode("https://example.org/entities/condition", graph).text(
    `${S}name`,
    "Another value",
  );
  const node = new ReadNode("https://example.org/entities/condition", graph);
  expect(node.text(`${S}name`)).toBeUndefined();
  new FixtureNode("https://example.org/entities/language", graph).link(
    `${S}name`,
    df.literal("Fictional label", "en"),
  );
  expect(new ReadNode("https://example.org/entities/language", graph).label).toBe(
    "Fictional label",
  );
  const view = projectHealthFacts(await batch([{ ...claim("one"), assertion: graph }]), { owner });
  expect(view.facts[0]?.label).toBe("Condition");
});
it.each([
  ["date", "1900-02-29", undefined],
  ["date", "2000-02-29", Date.parse("2000-02-29T00:00:00Z")],
  ["date", "2026-00-01", undefined],
  ["date", "2026-13-01", undefined],
  ["date", "2026-01-00", undefined],
  ["date", "2026-01-01+15:00", undefined],
  ["date", "2026-01-01+14:01", undefined],
  ["date", "2026-01-01+01:60", undefined],
  ["gYearMonth", "2026-11Z", Date.parse("2026-11-01T00:00:00Z")],
  ["gYear", "2026+14:00", Date.parse("2025-12-31T10:00:00Z")],
  ["dateTime", "2026-01-01T00:00:00Z\n", undefined],
  ["string", "2026-01-01", undefined],
  ["duration", "P1D", undefined],
] as const)("calendar-checks %s %s", (datatype, value, expected) => {
  expect(temporalTime(df.literal(value, df.namedNode(XSD + datatype)))).toBe(expected);
});
it("does not parse foreign datatype namespaces, and reads OWL-Time instants without an interval", async () => {
  expect(
    temporalTime(df.literal("2026-01-01", df.namedNode("https://example.org/date"))),
  ).toBeUndefined();
  const graph = observation();
  const time = df.blankNode();
  new FixtureNode("https://example.org/observations/one", graph).link(`${H}effectiveTime`, time);
  new FixtureNode(time, graph).text(`${TIME}inXSDDate`, "2026-01-01", `${X}date`);
  const view = projectHealthFacts(await batch([{ ...claim("one"), assertion: graph }]), { owner });
  expect(view.byKind.observation[0]).toMatchObject({
    effectiveTime: "2026-01-01",
    effectiveTimeMs: Date.parse("2026-01-01T00:00:00Z"),
  });
});
it("retains undated timeline events, uses event dates and separates unitless observations", async () => {
  const immunization = entities.Immunization.build("https://example.org/entities/immunization", {
    patient: owner,
  });
  new FixtureNode("https://example.org/entities/immunization", immunization).text(
    `${H}effectiveTime`,
    "2026-02-01",
    `${X}date`,
  );
  const encounter = entities.Encounter.build("https://example.org/entities/encounter", {
    patient: owner,
  });
  const obs = observation({ date: "2026-02-01", dateType: "date" });
  obs.removeQuads(obs.getQuads(null, `${H}unitCode`, null, null));
  const view = projectHealthFacts(
    await batch(
      [immunization, encounter, obs, obs].map((assertion, i) => ({
        ...claim(String(i)),
        assertion,
      })),
    ),
    { owner },
  );
  expect(healthTimeline(view).immunization[0]?.start).toBe("2026-02-01");
  expect(healthTimeline(view).encounter[0]?.start).toBeUndefined();
  expect(observationSeries(view).series[0]?.points).toHaveLength(2);
  expect(observationSeries(view).series[0]?.unit).toBeUndefined();
});
it("handles unknown labelled/unlabelled categories and nameless allergies without leaking a foreign helper", async () => {
  const unknown = new Store();
  new FixtureNode("https://example.org/entities/unknown", unknown).text(
    "https://example.org/vocab/value",
    "Fictional value",
  );
  const allergy = entities.AllergyIntolerance.build(
    "https://example.org/entities/unknown-allergy",
    { patient: owner },
  );
  const ownerOnly = new Store();
  new FixtureNode("https://example.org/entities/owned-unknown", ownerOnly)
    .link(`${H}patient`, owner)
    .text(`${S}name`, "Owned unknown");
  new FixtureNode("https://example.org/entities/foreign-unknown", ownerOnly)
    .link(`${H}patient`, "https://example.org/people/foreign#me")
    .text(`${S}name`, "Foreign unknown");
  const view = projectHealthFacts(
    await batch(
      [unknown, allergy, ownerOnly].map((assertion, i) => ({ ...claim(String(i)), assertion })),
    ),
    { owner },
  );
  expect(view.unrecognised.map((f) => f.label).sort()).toEqual(["Health fact", "Owned unknown"]);
  expect(view.byKind.allergy[0]).toMatchObject({ label: "Allergy", substance: undefined });
  expect(JSON.stringify(view)).not.toContain("Foreign unknown");
});
it("returns referenced sources in deterministic IRI order without unused batch sources", async () => {
  const { buildNanopublications } = await import("@jeswr/pkg-memory");
  const value = await buildNanopublications(
    {
      batch_id: "many-sources",
      worker: { agent_id: "https://example.org/client", agent_label: "Fictional client" },
      sources: [
        { id: "z", kind: "document", url: "https://example.org/z" },
        { id: "a", kind: "email", url: "https://example.org/a" },
        { id: "unused", kind: "document", url: "https://example.org/unused" },
      ],
      claims: [{ ...claim("one"), evidence: [{ source: "z" }, { source: "a" }] }],
    },
    { owner },
  );
  expect(projectHealthFacts(value, { owner }).sources.map((s) => s.iri)).toEqual([
    "https://example.org/a",
    "https://example.org/z",
  ]);
});
it("recognises standalone owner-linked supporting records even without a category", async () => {
  const records = [
    entities.MedicinalProduct.build("https://example.org/entities/standalone-product", {
      name: "Fictional product",
    }),
    entities.CodeableConcept.build("https://example.org/entities/standalone-code", {
      codeValue: "EX",
    }),
  ];
  for (const record of records) {
    const subject = record.getSubjects(null, null, null)[0];
    if (!subject) throw new Error("Missing fixture");
    new FixtureNode(subject, record).link(`${H}patient`, owner);
  }
  const view = projectHealthFacts(
    await batch(
      records.map((assertion, i) => ({ ...claim(String(i)), assertion, categories: [] })),
    ),
    { owner },
  );
  expect(view.facts).toHaveLength(0);
  expect(view.unrecognised).toHaveLength(2);
});
it("does not merge different code IRIs with the same local code value, and groups value-only codes", async () => {
  const value = await batch([claim("one")]);
  const view = projectHealthFacts(value, { owner });
  const base = view.facts[0];
  if (!base) throw new Error("Missing fixture");
  view.byKind.observation = [
    {
      ...base,
      kind: "observation",
      code: { iri: "https://example.org/codes/a", value: "EX", system: "other" },
      value: 1,
      effectiveTimeMs: 0,
    },
    {
      ...base,
      kind: "observation",
      code: { iri: "https://example.org/codes/b", value: "EX", system: "other" },
      value: 2,
      effectiveTimeMs: 0,
    },
    {
      ...base,
      kind: "observation",
      code: { value: "EX", system: "other" },
      value: 3,
      effectiveTimeMs: 0,
    },
    {
      ...base,
      kind: "observation",
      code: { value: "EX", system: "other" },
      value: 4,
      effectiveTimeMs: 0,
    },
  ];
  const result = observationSeries(view);
  expect(result.series).toHaveLength(3);
  expect(result.series.find((s) => s.points.length === 2)?.points.map((p) => p.y)).toEqual([3, 4]);
});
it.each([
  ["2024-02-29T24:00:00Z", Date.parse("2024-03-01T00:00:00Z")],
  ["2024-02-29T24:00:00.000Z", Date.parse("2024-03-01T00:00:00Z")],
  ["2024-02-29T24:01:00Z", undefined],
  ["2024-02-29T24:00:01Z", undefined],
  ["2024-02-29T24:00:00.1Z", undefined],
] as const)("handles XSD midnight lexical form %s", (value, expected) => {
  expect(temporalTime(df.literal(value, df.namedNode(X + "dateTime")))).toBe(expected);
});
