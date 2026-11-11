// AUTHORED-BY Codex GPT-6.1-Sol
import {
  createFactAssertion,
  parseNanopublications,
  serializeNanopublications,
} from "@jeswr/pkg-memory";
import { DataFactory as df, Store } from "n3";
import { expect, it, vi } from "vitest";
import { entities } from "../src/generated/model.js";
import {
  classifyBodySystem,
  healthTimeline,
  importHealthExport,
  observationSeries,
  projectHealthFacts,
} from "../src/index.js";
import { LABEL, RDF_TYPE, S, TIME, XSD } from "../src/read.js";
import { exampleHealthKnowledge } from "../src/testing.js";
import { batch, claim, FixtureNode, H, observation, other, owner } from "./helpers.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fictional fixture");
  return value;
}

it.each([
  "schema",
  "rdfs",
  "value",
  "prefLabel",
  "codeLabel",
  "kind",
])("uses %s label precedence on observations", async (variant) => {
  const graph = observation({ date: "2026-01-01", dateType: "date" });
  graph.removeQuads(graph.getQuads(null, `${S}name`, null, null));
  const node = new FixtureNode("https://example.org/observations/one", graph);
  const code = df.blankNode();
  if (variant !== "kind") {
    node.link(`${H}hasCode`, code);
    const coded = new FixtureNode(code, graph);
    coded.text(LABEL, "Code rdfs label");
    if (variant !== "codeLabel")
      coded.text("http://www.w3.org/2004/02/skos/core#prefLabel", "Code preferred");
    if (!["codeLabel", "prefLabel"].includes(variant))
      coded.text("https://w3id.org/jeswr/core#value", "calcium");
    if (["rdfs", "schema"].includes(variant)) node.text(LABEL, "Observation rdfs label");
    if (variant === "schema") node.text(`${S}name`, "Observation schema name");
  }
  const view = projectHealthFacts(await batch([{ ...claim("one"), assertion: graph }]), { owner });
  expect(view.facts[0]?.label).toBe(
    (
      {
        schema: "Observation schema name",
        rdfs: "Observation rdfs label",
        value: "calcium",
        prefLabel: "Code preferred",
        codeLabel: "Code rdfs label",
        kind: "Observation",
      } as Record<string, string>
    )[variant],
  );
});
it.each([
  ["normal", "normal"],
  ["Marked normal", "normal"],
  ["normal (numeric value not transcribed)", "normal"],
  ["abnormal", "abnormal"],
  ["positive", "abnormal"],
  ["HIGH", "high"],
  ["elevated", "high"],
  ["raised", "high"],
  ["low", "low"],
  ["decreased", "low"],
  ["reduced", "low"],
  ["negative", "normal"],
  ["unremarkable", "normal"],
  ["not normal", undefined],
  ["possibly high", undefined],
  ["unknown", undefined],
  ["borderline", undefined],
  ["normality", undefined],
  ["abnormal high", "high"],
] as const)("retains qualitative %s with display interpretation %s", async (value, interpretation) => {
  const graph = observation({ value, datatype: "string", date: "2026-01-01", dateType: "date" });
  const view = projectHealthFacts(await batch([{ ...claim("one"), assertion: graph }]), { owner });
  expect(view.byKind.observation[0]).toMatchObject({ value, interpretation });
  expect(observationSeries(view)).toEqual({ series: [], skipped: 1 });
});
it.each([
  ["decimal", "4.2", 4.2],
  ["integer", "42", 42],
  ["string", "4.2", 4.2],
  ["string", " .5 ", 0.5],
  ["string", "0", 0],
  ["string", "0x10", "0x10"],
  ["string", "4.2 mg", "4.2 mg"],
  ["string", "", ""],
  ["string", "Infinity", "Infinity"],
  ["string", "9007199254740993", "9007199254740993"],
  ["string", "1.234567890123456789", "1.234567890123456789"],
  ["string", "1e2", "1e2"],
] as const)("reads numeric/string %s %s faithfully", async (datatype, value, expected) => {
  const view = projectHealthFacts(
    await batch([{ ...claim("one"), assertion: observation({ datatype, value, unit: "mg/L" }) }]),
    { owner },
  );
  expect(view.byKind.observation[0]).toMatchObject({ value: expected, unit: "mg/L" });
});
it.each([
  ["4.2E0", 4.2],
  ["NaN", "NaN"],
  ["INF", "INF"],
  ["nonsense", "nonsense"],
] as const)("projects xsd:double %s without changing pkg-memory's parity boundary", async (value, expected) => {
  const built = await batch([{ ...claim("one"), assertion: observation() }]);
  const np = required(built.nanopubs[0]);
  built.dataset.removeQuads(built.dataset.getQuads(null, `${H}value`, null, np.assertionId));
  const { NamedGraphDataset } = await import("@rdfjs/wrapper");
  new FixtureNode(
    "https://example.org/observations/one",
    new NamedGraphDataset(df.namedNode(np.assertionId), built.dataset, df),
  ).text(`${H}value`, value, `${XSD}double`);
  expect(projectHealthFacts(built, { owner }).facts[0]).toMatchObject({ value: expected });
});
it.each([
  "date",
  "dateTimeStamp",
])("reads OWL-Time instant %s and a direct typed literal", async (datatype) => {
  const graph = observation();
  const time = df.blankNode();
  const date = datatype === "date" ? "2026-03-04" : "2026-03-04T12:00:00Z";
  new FixtureNode("https://example.org/observations/one", graph).link(`${H}effectiveTime`, time);
  new FixtureNode(time, graph)
    .link(RDF_TYPE, `${TIME}Instant`)
    .text(`${TIME}inXSD${datatype === "date" ? "Date" : "DateTimeStamp"}`, date, XSD + datatype);
  // dateTimeStamp is not in pkg-memory's existing RDFlib parity datatype set.
  const value = await batch([{ ...claim("one"), assertion: observation() }]);
  const { NamedGraphDataset } = await import("@rdfjs/wrapper");
  const scoped = new NamedGraphDataset(
    df.namedNode(required(value.nanopubs[0]).assertionId),
    value.dataset,
    df,
  );
  for (const q of graph) new FixtureNode(q.subject, scoped).link(q.predicate.value, q.object);
  const fact = projectHealthFacts(value, { owner }).facts[0];
  expect(fact).toMatchObject({
    effectiveTime: date,
    effectiveTimeMs: Date.parse(datatype === "date" ? `${date}T00:00:00Z` : date),
  });
  const direct = { ...value, dataset: new Store(value.dataset) };
  direct.dataset.removeQuads(
    direct.dataset.getQuads(
      null,
      `${H}effectiveTime`,
      null,
      required(value.nanopubs[0]).assertionId,
    ),
  );
  new FixtureNode(
    "https://example.org/observations/one",
    new NamedGraphDataset(
      df.namedNode(required(value.nanopubs[0]).assertionId),
      direct.dataset,
      df,
    ),
  ).text(`${H}effectiveTime`, date, XSD + datatype);
  expect(projectHealthFacts(direct, { owner }).facts[0]).toMatchObject({ effectiveTime: date });
});
it.each([
  "VitalSign",
  "HeartRateObservation",
  "StepCountObservation",
  "SleepObservation",
])("recognises canonical and legacy %s once even with a base type", async (type) => {
  for (const namespace of [H, "https://w3id.org/jeswr/sectors/health#"]) {
    const graph = observation();
    graph.removeQuads(graph.getQuads(null, RDF_TYPE, null, null));
    const node = new FixtureNode("https://example.org/observations/one", graph).link(
      RDF_TYPE,
      namespace + type,
    );
    const single = projectHealthFacts(await batch([{ ...claim("one"), assertion: graph }]), {
      owner,
    });
    expect(single.byKind.observation).toHaveLength(1);
    node.link(RDF_TYPE, `${H}Observation`);
    expect(
      projectHealthFacts(await batch([{ ...claim("one"), assertion: graph }]), { owner }).byKind
        .observation,
    ).toHaveLength(1);
  }
});
it("reads owner notes and linked documents, retains metadata and only dates documents on their lane", async () => {
  const note = createFactAssertion(owner, {
    template: "preference",
    value: { propertyID: "self-rated-balance", value: "Fictional note" },
  });
  const dated = entities.DigitalDocument.build("https://example.org/d1", {
    about: owner,
    name: "Sleep summary",
    dateCreated: new Date("2026-02-01T00:00:00Z"),
  });
  const undated = entities.DigitalDocument.build("https://example.org/d2", {
    name: "Heart review",
  });
  new FixtureNode(owner, undated).link(`${S}subjectOf`, "https://example.org/d2");
  const view = projectHealthFacts(
    await batch(
      [note, dated, undated].map((assertion, i) => ({
        ...claim(String(i)),
        assertion,
        evidence: [{ source: "chat", quote: "Fictional evidence" }],
      })),
    ),
    { owner },
  );
  expect(view.byKind.note[0]).toMatchObject({
    property: "self-rated-balance",
    label: "Self rated balance",
    value: "Fictional note",
    belief: "definitely",
    provenance: { evidence: [{ quote: "Fictional evidence" }] },
  });
  expect(view.byKind.document).toHaveLength(2);
  expect(view.byKind.document.map(classifyBodySystem).sort()).toEqual(["cardiovascular", "sleep"]);
  expect(healthTimeline(view).documents).toMatchObject([
    { label: "Sleep summary", start: "2026-02-01T00:00:00+00:00" },
  ]);
  expect(healthTimeline(view, { beliefs: ["past"] }).documents).toEqual([]);
});
it("does not disclose foreign, mixed-owner or unlinked notes/documents under a health category", async () => {
  const foreign = createFactAssertion(other, {
    template: "preference",
    value: { propertyID: "hidden-note", value: "Hidden note value" },
  });
  const doc = entities.DigitalDocument.build("https://example.org/foreign-document", {
    about: other,
    name: "Hidden document value",
  });
  new FixtureNode(owner, doc).link(`${S}subjectOf`, "https://example.org/foreign-document");
  const unlinked = entities.PropertyValue.build("https://example.org/unlinked", {
    propertyID: "hidden-property",
    textValue: "Hidden unlinked value",
  });
  const view = projectHealthFacts(
    await batch(
      [foreign, doc, unlinked].map((assertion, i) => ({ ...claim(String(i)), assertion })),
    ),
    { owner },
  );
  expect(view.facts).toEqual([]);
  expect(JSON.stringify(view)).not.toContain("Hidden");
  expect(view.excludedOtherSubjects).toBe(2);
});
it("imports complete good envelopes and reports only aggregate sanitized skip reasons", async () => {
  const value = await batch([claim("a"), claim("b")]);
  const trig = await serializeNanopublications(value);
  // Both share an assertion; poison only A's graph-scoped quote.
  const polluted = trig;
  expect((await importHealthExport(polluted, { owner })).skipped).toEqual({
    count: 0,
    reasons: {},
  });
  const { NamedGraphDataset } = await import("@rdfjs/wrapper");
  new FixtureNode(
    "https://example.org/extra",
    new NamedGraphDataset(
      df.namedNode(required(value.nanopubs[0]).provenanceId),
      value.dataset,
      df,
    ),
  ).text(`${S}name`, "Fictional\u2028value");
  // Bypass the atomic serializer only to make invalid external input in a fixture.
  const { Writer } = await import("n3");
  const writer = new Writer({ format: "application/trig" });
  writer.addQuads([...value.dataset]);
  const external = await new Promise<string>((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
  const result = await importHealthExport(external, { owner });
  expect(result.value.nanopubs).toHaveLength(1);
  expect(result.skipped).toEqual({ count: 1, reasons: { UnsupportedLiteralCharacterError: 1 } });
  for (const invalid of ["private text", "ftp://example.org/owner"])
    await expect(importHealthExport(trig, { owner: invalid })).rejects.toMatchObject({
      code: "invalid-input",
    });
  await expect(importHealthExport("Fictional invalid input", { owner })).rejects.toMatchObject({
    code: "read-failed",
  });
});
it("builds a deterministic fictional story through the public testing export", async () => {
  const value = await exampleHealthKnowledge();
  const again = await exampleHealthKnowledge({ now: "2026-11-01T12:00:00Z" });
  const text = await serializeNanopublications(value);
  expect(again.nanopubs).toEqual(value.nanopubs);
  expect(projectHealthFacts(again, { owner: "https://example.org/people/avery#me" })).toEqual(
    projectHealthFacts(value, { owner: "https://example.org/people/avery#me" }),
  );
  const view = projectHealthFacts(await parseNanopublications(text), {
    owner: "https://example.org/people/avery#me",
  });
  expect(view.facts).toHaveLength(77);
  expect(view.byKind.medication).toHaveLength(3);
  expect(view.byKind.allergy).toHaveLength(2);
  expect(view.byKind.immunization).toHaveLength(1);
  expect(view.byKind.encounter).toHaveLength(3);
  expect(view.byKind.observation).toHaveLength(50);
  expect(view.byKind.note).toHaveLength(8);
  expect(view.byKind.document).toHaveLength(2);
  expect(new Set(view.facts.map((f) => f.belief))).toEqual(
    new Set(["definitely", "might", "mentioned", "past"]),
  );
  expect(view.sources.map((s) => s.kind).sort()).toEqual([
    "claude-session",
    ...Array(4).fill("codex-thread"),
  ]);
  expect(view.sources.every((s) => s.title && s.model && s.created)).toBe(true);
  expect(view.facts.every((f) => f.provenance.evidence[0]?.quote)).toBe(true);
  expect(view.facts.some((f) => f.replacedBy.length)).toBe(true);
  expect(
    observationSeries(view)
      .series.map((s) => s.points.length)
      .sort((a, b) => a - b),
  ).toEqual([6, 6, 6, 6, 26]);
  expect(healthTimeline(view).documents).toHaveLength(2);
  await expect(exampleHealthKnowledge({ now: "Fictional invalid clock" })).rejects.toMatchObject({
    code: "invalid-input",
  });
});
it("scales graph reads with nanopubs, indexes shared assertions once, and copies batch provenance once", async () => {
  const value = await batch([claim("base")]);
  const original = required(value.nanopubs[0]);
  value.nanopubs = Array.from({ length: 4500 }, (_, i) => ({
    ...original,
    id: `https://example.org/nanopub/${i}`,
  }));
  const match = vi.spyOn(value.dataset, "match");
  const iterator = vi.spyOn(value.dataset, Symbol.iterator);
  const view = projectHealthFacts(value, { owner });
  expect(view.facts).toHaveLength(4500);
  expect(iterator).not.toHaveBeenCalled();
  expect(match.mock.calls.filter((args) => args[3]?.value === original.assertionId)).toHaveLength(
    1,
  );
  expect(match.mock.calls.length).toBeLessThan(4510);
}, 30_000);

it("reads external blank-node notes/documents and retains incomplete owned notes as unrecognised", async () => {
  const value = await batch([claim("blank")]);
  const { NamedGraphDataset } = await import("@rdfjs/wrapper");
  const graph = new NamedGraphDataset(
    df.namedNode(required(value.nanopubs[0]).assertionId),
    value.dataset,
    df,
  );
  const note = df.blankNode();
  new FixtureNode(owner, graph).link(`${S}additionalProperty`, note);
  new FixtureNode(note, graph)
    .link(RDF_TYPE, `${S}PropertyValue`)
    .text(`${S}propertyID`, "sleep-quality")
    .text(`${S}value`, "Fictional good sleep");
  const document = df.blankNode();
  new FixtureNode(document, graph)
    .link(RDF_TYPE, `${S}DigitalDocument`)
    .link(`${S}about`, owner)
    .text(`${S}name`, "Sleep record");
  const projected = projectHealthFacts(value, { owner });
  expect(projected.byKind.note[0]).toMatchObject({
    label: "Sleep quality",
    value: "Fictional good sleep",
  });
  expect(projected.byKind.document[0]).toMatchObject({ name: "Sleep record" });
  expect(classifyBodySystem(required(projected.byKind.note[0]))).toBe("sleep");
  for (const field of ["propertyID", "value"]) {
    const incomplete = entities.PropertyValue.build(
      `https://example.org/incomplete-${field}`,
      field === "propertyID" ? { textValue: "Fictional value" } : { propertyID: "sleep-quality" },
    );
    new FixtureNode(owner, incomplete).link(
      `${S}additionalProperty`,
      `https://example.org/incomplete-${field}`,
    );
    const view = projectHealthFacts(await batch([{ ...claim(field), assertion: incomplete }]), {
      owner,
    });
    expect(view.byKind.note).toEqual([]);
    expect(view.unrecognised).toHaveLength(1);
  }
});
it("aggregates repeated validation classes without returning identifiers or literals", async () => {
  const value = await batch([claim("a"), claim("b"), claim("c")]);
  const { NamedGraphDataset } = await import("@rdfjs/wrapper");
  for (const np of value.nanopubs.slice(0, 2))
    new FixtureNode(
      "https://example.org/extra",
      new NamedGraphDataset(df.namedNode(np.pubinfoId), value.dataset, df),
    ).text(`${S}name`, "Fictional\u000cvalue");
  const { Writer } = await import("n3");
  const writer = new Writer({ format: "application/trig" });
  writer.addQuads([...value.dataset]);
  const external = await new Promise<string>((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
  const { skipped } = await importHealthExport(external, { owner });
  expect(skipped).toEqual({ count: 2, reasons: { UnsupportedLiteralCharacterError: 2 } });
});
it("rejects mixed owners on notes, accepts owner documents without categories, and requires timestamp zones", async () => {
  const note = createFactAssertion(owner, {
    template: "preference",
    value: { propertyID: "sleep-quality", value: "Hidden mixed note" },
  });
  const noteId = note.getObjects(owner, `${S}additionalProperty`, null)[0];
  new FixtureNode(other, note).link(`${S}additionalProperty`, required(noteId));
  const document = entities.DigitalDocument.build("https://example.org/owner-document", {
    about: owner,
  });
  const view = projectHealthFacts(
    await batch([
      { ...claim("mixed"), assertion: note },
      { ...claim("document"), assertion: document, categories: [] },
    ]),
    { owner },
  );
  expect(view.byKind.note).toEqual([]);
  expect(JSON.stringify(view)).not.toContain("Hidden");
  expect(view.byKind.document).toHaveLength(1);
  const { temporalTime } = await import("../src/temporal.js");
  expect(
    temporalTime(df.literal("2026-01-01T12:00:00", df.namedNode(`${XSD}dateTimeStamp`))),
  ).toBeUndefined();
});
