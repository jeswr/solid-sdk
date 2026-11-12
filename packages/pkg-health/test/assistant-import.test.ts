// AUTHORED-BY Codex GPT-6.1-Sol
import { spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as memory from "@jeswr/pkg-memory";
import { afterEach, describe, expect, it, vi } from "vitest";
import { importAssistantTurtle, importHealthExport, projectHealthFacts } from "../src/index.js";
import { batch, claim, condition, generatedAt, owner } from "./helpers.js";

vi.mock("@jeswr/pkg-memory", async (original) => ({
  ...(await original<typeof import("@jeswr/pkg-memory")>()),
}));
afterEach(() => vi.restoreAllMocks());
const options = {
  owner,
  assistant: { iri: "https://example.org/agents/assistant", label: "Fictional assistant" },
  batchId: "fictional-assistant-export",
  generatedAt,
};
const prefixes = `
@prefix h: <https://jeswr.org/ns/sectors/health#> .
@prefix s: <http://schema.org/> .
@prefix schema: <https://schema.org/> .
@prefix p: <https://w3id.org/jeswr/pkg#> .
@prefix m: <https://jeswr.org/ns/pkg#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix oa: <http://www.w3.org/ns/oa#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix ex: <https://example.org/export/> .
`;
const source = `ex:source a s:CreativeWork ; s:name "Fictional discussion" ; s:dateCreated "2026-10-01T12:00:00Z"^^xsd:dateTime .`;
const fact = `ex:fact a h:Observation ; h:patient <${owner}> ; s:name "Fictional observation" ; h:value "3.25"^^xsd:decimal ;
prov:wasDerivedFrom ex:source ; oa:exact "Fictional quote" ; p:epistemicStatus "SelfReportedExplicit" ; p:validityStatus "Current" .`;
const minimal = prefixes + source + fact;
const fixture = new URL("./fixtures/assistant.ttl", import.meta.url);
async function roundtrip(text: string) {
  const result = await importAssistantTurtle(text, options);
  const parsed = await memory.parseNanopublications(
    await memory.serializeNanopublications(result.value),
  );
  return { ...result, view: projectHealthFacts(parsed, { owner }) };
}

it("imports every fictional type, both namespaces, exact provenance and beliefs through TriG", async () => {
  const result = await roundtrip(await readFile(fixture, "utf8"));
  expect(result.skipped).toEqual({
    count: 3,
    reasons: { OtherSubject: 1, UnknownEpistemicStatus: 1, InvalidFact: 1 },
  });
  expect(result.value.nanopubs).toHaveLength(8);
  expect(result.view.facts).toHaveLength(8);
  expect(result.view.unrecognised).toEqual([]);
  expect(result.view.excludedOtherSubjects).toBe(0);
  expect(result.view.byKind.observation).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        label: "Fictional ferritin",
        value: 42.5,
        unit: "ug/L",
        effectiveTime: "2026-10-01",
        belief: "definitely",
      }),
      expect.objectContaining({
        label: "Fictional score",
        value: 7,
        unit: undefined,
        effectiveTime: "2026-10-15T12:00:00+00:00",
        belief: "might",
        epistemic: "Inferred",
      }),
      expect.objectContaining({
        value: "Unremarkable",
        epistemic: "SelfReportedHedged",
        interpretation: "normal",
        belief: "might",
      }),
    ]),
  );
  expect(result.view.byKind.condition[0]).toMatchObject({
    label: "Fictional old ankle concern",
    onset: "2025-06-01",
    abatement: "2025-07-01",
    belief: "past",
    validity: "Historical",
  });
  expect(result.view.byKind.medication[0]).toMatchObject({
    label: "Fictional medicine statement",
    product: { name: "Fictionalium" },
    doseSchedule: "One fictional tablet each evening",
    period: { start: "2026-10-03T18:00:00+00:00" },
  });
  expect(result.view.byKind.encounter[0]).toMatchObject({
    label: "Fictional review visit",
    date: "2026-10-15",
  });
  expect(result.view.byKind.immunization[0]).toMatchObject({
    label: "Fictional seasonal immunization",
    date: "2026-09-15",
  });
  expect(result.view.byKind.note[0]).toMatchObject({
    label: "Fictional balance context",
    value: "Comfortable on fictional walks",
    belief: "might",
  });
  const observed = result.view.facts.find((f) => f.label === "Fictional ferritin");
  expect(observed?.provenance.sources).toEqual([
    {
      iri: "https://example.org/assistant-export/2026-11-01/source-a",
      kind: "document",
      title: "Fictional health conversation",
      model: options.assistant.label,
      created: "2026-10-01T09:30:00.000Z",
      url: "https://example.org/assistant-export/2026-11-01/source-a",
      threadId: undefined,
    },
    {
      iri: "https://example.org/assistant-export/2026-11-01/source-b",
      kind: "document",
      title: "Fictional follow-up",
      model: options.assistant.label,
      created: "2026-10-15T11:00:00.000Z",
      url: "https://example.org/assistant-export/2026-11-01/source-b",
      threadId: undefined,
    },
  ]);
  expect(observed?.provenance.evidence.map((e) => [e.source, e.quote]).sort()).toEqual([
    [
      "https://example.org/assistant-export/2026-11-01/source-a",
      "I confirmed the fictional result.",
    ],
    ["https://example.org/assistant-export/2026-11-01/source-a", "My fictional result was 42.5."],
    [
      "https://example.org/assistant-export/2026-11-01/source-b",
      "I confirmed the fictional result.",
    ],
    ["https://example.org/assistant-export/2026-11-01/source-b", "My fictional result was 42.5."],
  ]);
  for (const f of result.view.facts) {
    expect(f.categories).toEqual(["https://w3id.org/dpv/pd#MedicalHealth"]);
    expect(f.provenance.agent).toEqual(options.assistant);
    expect(f.provenance.attributedTo).toEqual([options.assistant.iri]);
    expect(f.provenance.generatedAt).toBe("2026-11-10T12:00:00+00:00");
  }
});

it("uses stable fact-IRI claim IDs with no dependence on input order", async () => {
  const text = await readFile(fixture, "utf8");
  const a = await importAssistantTurtle(text, options);
  const b = await importAssistantTurtle(text, options);
  expect(a.value.nanopubs).toEqual(b.value.nanopubs);
  expect(await memory.serializeNanopublications(a.value)).toBe(
    await memory.serializeNanopublications(b.value),
  );
  expect(projectHealthFacts(a.value, { owner })).toEqual(projectHealthFacts(b.value, { owner }));
  const c = await importAssistantTurtle(prefixes + fact + source, options);
  const d = await importAssistantTurtle(minimal, options);
  expect(c.value.nanopubs).toEqual(d.value.nanopubs);
  const renamed = await importAssistantTurtle(minimal.replaceAll("ex:fact", "ex:renamed"), options);
  expect(renamed.value.nanopubs[0]?.id).not.toBe(c.value.nanopubs[0]?.id);
});

it("combines identical aliases without hiding conflicting identities", async () => {
  const text = minimal.replace(
    's:name "Fictional observation"',
    's:name "Fictional observation" ; schema:name "Fictional observation" ; schema:about <' +
      owner +
      '> ; m:epistemicStatus "SelfReportedExplicit"',
  );
  expect((await roundtrip(text)).view.facts).toHaveLength(1);
});

it("retains every valid source, including unreferenced documents, in batch RDF", async () => {
  const result = await importAssistantTurtle(
    minimal + source.replaceAll("ex:source", "ex:unused"),
    options,
  );
  const graph = memory.readNamedGraph(
    result.value.dataset,
    memory.pkgId("batch", options.batchId, "sources"),
  );
  expect([...graph].some((q) => q.subject.value === "https://example.org/export/unused")).toBe(
    true,
  );
  expect(projectHealthFacts(result.value, { owner }).sources).toHaveLength(1);
});

it("preserves an explicitly empty source title", async () => {
  const result = await roundtrip(minimal.replace('s:name "Fictional discussion"', 's:name ""'));
  expect(result.view.sources[0]?.title).toBe("");
});

it("merges separate batches with a tolerant existing export and retains both provenances", async () => {
  const original = await batch(
    [claim("previous", condition("Fictional earlier concern"))],
    "fictional-earlier-batch",
  );
  const existing = await importHealthExport(await memory.serializeNanopublications(original), {
    owner,
  });
  const imported = await importAssistantTurtle(await readFile(fixture, "utf8"), options);
  const merged = await memory.parseNanopublications(
    (await memory.serializeNanopublications(existing.value)) +
      (await memory.serializeNanopublications(imported.value)),
  );
  merged.affected = existing.value.affected;
  const view = projectHealthFacts(merged, { owner });
  expect(view.facts).toHaveLength(9);
  expect(view.facts.find((f) => f.label === "Fictional earlier concern")?.provenance.batch).toBe(
    "fictional-earlier-batch",
  );
  expect(view.facts.find((f) => f.label === "Fictional ferritin")?.provenance.batch).toBe(
    options.batchId,
  );
});

it("supports canonical PropertyValue types and an absent medicine schedule", async () => {
  const fixtureText = (await readFile(fixture, "utf8"))
    .replace("a schema1:PropertyValue", "a schema:PropertyValue")
    .replace('schema1:doseSchedule "One fictional tablet each evening" ;', "");
  const result = await roundtrip(fixtureText);
  expect(result.view.byKind.note).toHaveLength(1);
  expect(result.view.byKind.medication[0]).toMatchObject({
    doseSchedule: undefined,
    product: { name: "Fictionalium" },
  });
});

it("counts quote lengths by Unicode code points at the builder boundary", async () => {
  const accepted = await roundtrip(minimal.replace("Fictional quote", "😀".repeat(300)));
  expect(accepted.view.facts[0]?.provenance.evidence[0]?.quote).toBe("😀".repeat(300));
  const rejected = await importAssistantTurtle(
    minimal.replace("Fictional quote", "😀".repeat(301)),
    options,
  );
  expect(rejected.skipped).toEqual({ count: 1, reasons: { InvalidEvidence: 1 } });
});

const invalidCases: [string, string, string][] = [
  [
    "literal type",
    fact.replace("a h:Observation", 'a "https://example.org/type"'),
    "UnsupportedType",
  ],
  ["missing subject", fact.replace(`h:patient <${owner}> ;`, ""), "OtherSubject"],
  [
    "mixed patients",
    fact.replace(`h:patient <${owner}>`, `h:patient <${owner}>, <https://example.org/other>`),
    "OtherSubject",
  ],
  ["literal owner", fact.replace(`h:patient <${owner}>`, 'h:patient "fictional"'), "OtherSubject"],
  [
    "conflicting about",
    fact.replace(
      `h:patient <${owner}>`,
      `h:patient <${owner}> ; schema:about <https://example.org/other>`,
    ),
    "OtherSubject",
  ],
  ["blank fact", fact.replace("ex:fact", "_:fact"), "InvalidFact"],
  ["unsupported type", fact.replace("a h:Observation", "a h:Unexpected"), "UnsupportedType"],
  [
    "multiple fact types",
    fact.replace("a h:Observation", "a h:Observation, h:Encounter"),
    "UnsupportedType",
  ],
  [
    "unknown epistemic",
    fact.replace('"SelfReportedExplicit"', '"Unknown"'),
    "UnknownEpistemicStatus",
  ],
  [
    "missing epistemic",
    fact.replace('p:epistemicStatus "SelfReportedExplicit" ;', ""),
    "UnknownEpistemicStatus",
  ],
  ["unknown validity", fact.replace('"Current"', '"Future"'), "UnknownValidityStatus"],
  ["missing validity", fact.replace('; p:validityStatus "Current"', ""), "UnknownValidityStatus"],
  [
    "conflicting namespace values",
    fact.replace(
      's:name "Fictional observation"',
      's:name "Fictional observation" ; schema:name "Another fictional name"',
    ),
    "InvalidFact",
  ],
  [
    "conflicting status aliases",
    fact.replace(
      'p:epistemicStatus "SelfReportedExplicit"',
      'p:epistemicStatus "SelfReportedExplicit" ; m:epistemicStatus "Inferred"',
    ),
    "InvalidFact",
  ],
  [
    "non-string name",
    fact.replace('s:name "Fictional observation"', 's:name "1"^^xsd:integer'),
    "InvalidFact",
  ],
  ["missing name", fact.replace('s:name "Fictional observation" ;', ""), "InvalidFact"],
  [
    "language name",
    fact.replace('s:name "Fictional observation"', 's:name "Fictional observation"@en'),
    "InvalidFact",
  ],
  [
    "control name",
    fact.replace('s:name "Fictional observation"', 's:name "Fictional\\u0000observation"'),
    "InvalidFact",
  ],
  [
    "unsupported numeric datatype",
    fact.replace('"3.25"^^xsd:decimal', '"3.25E0"^^xsd:double'),
    "InvalidFact",
  ],
  [
    "noncanonical numeric literal",
    fact.replace('"3.25"^^xsd:decimal', '"03.25"^^xsd:decimal'),
    "InvalidFact",
  ],
  [
    "inexact numeric literal",
    fact.replace('"3.25"^^xsd:decimal', '"9007199254740993"^^xsd:integer'),
    "InvalidFact",
  ],
  [
    "nonfinite numeric literal",
    fact.replace('"3.25"^^xsd:decimal', '"NaN"^^xsd:decimal'),
    "InvalidFact",
  ],
  ["nonliteral value", fact.replace('"3.25"^^xsd:decimal', "ex:result"), "InvalidFact"],
  ["boolean value", fact.replace('"3.25"^^xsd:decimal', "true"), "UnsupportedValue"],
  ["unsafe IRI", fact.replace("ex:fact", "<https://example.org/unsafe\\u007fid>"), "InvalidFact"],
  ["unsupported IRI scheme", fact.replace("ex:fact", "<javascript:fictional>"), "InvalidFact"],
  [
    "invalid ignored field",
    fact.replace(
      's:name "Fictional observation"',
      's:name "Fictional observation" ; schema:description "bad\\u2028value"',
    ),
    "InvalidFact",
  ],
  ["missing quotes", fact.replace('oa:exact "Fictional quote" ;', ""), "InvalidEvidence"],
  ["empty quote", fact.replace('"Fictional quote"', '""'), "InvalidEvidence"],
  ["long quote", fact.replace('"Fictional quote"', `"${"a".repeat(301)}"`), "InvalidEvidence"],
  ["missing derivation", fact.replace("prov:wasDerivedFrom ex:source ;", ""), "InvalidEvidence"],
  [
    "literal derivation",
    fact.replace("prov:wasDerivedFrom ex:source", 'prov:wasDerivedFrom "fictional"'),
    "InvalidFact",
  ],
  [
    "unknown source",
    fact.replace("prov:wasDerivedFrom ex:source", "prov:wasDerivedFrom ex:missing"),
    "InvalidSource",
  ],
  [
    "invalid effective date",
    fact.replace(
      's:name "Fictional observation"',
      's:name "Fictional observation" ; h:effectiveTime "2026-02-30"^^xsd:date',
    ),
    "InvalidFact",
  ],
  [
    "untyped date",
    fact.replace(
      's:name "Fictional observation"',
      's:name "Fictional observation" ; s:validFrom "2026-10-01"',
    ),
    "InvalidFact",
  ],
  [
    "nonliteral date",
    fact.replace(
      's:name "Fictional observation"',
      's:name "Fictional observation" ; s:validFrom ex:time',
    ),
    "InvalidFact",
  ],
  [
    "submillisecond date",
    fact.replace(
      's:name "Fictional observation"',
      's:name "Fictional observation" ; s:validFrom "2026-10-01T12:00:00.0001Z"^^xsd:dateTime',
    ),
    "UnsupportedDatePrecision",
  ],
  [
    "invalid product type",
    fact
      .replace("a h:Observation", "a h:MedicationStatement")
      .replace('h:value "3.25"^^xsd:decimal', "h:medication ex:source"),
    "InvalidFact",
  ],
];
it.each(
  invalidCases,
)("skips %s with an aggregate, value-free reason", async (_name, body, reason) => {
  const result = await importAssistantTurtle(prefixes + source + body, options);
  expect(result.skipped).toEqual({ count: 1, reasons: { [reason]: 1 } });
  expect(result.value.nanopubs).toEqual([]);
});

it.each([
  source.replace('s:name "Fictional discussion" ;', ""),
  source.replace(' ; s:dateCreated "2026-10-01T12:00:00Z"^^xsd:dateTime', ""),
  source.replace('s:name "Fictional discussion"', 's:name "1"^^xsd:integer'),
  source.replace(
    's:dateCreated "2026-10-01T12:00:00Z"^^xsd:dateTime',
    's:dateCreated "bad"^^xsd:dateTime',
  ),
  source.replace('s:name "Fictional discussion"', 's:name "bad\\u2029title"'),
  source.replace('"2026-10-01T12:00:00Z"^^xsd:dateTime', "ex:not-a-date"),
  source.replace('"2026-10-01T12:00:00Z"^^xsd:dateTime', '"2026"^^xsd:gYear'),
])("skips facts with unusable source metadata", async (invalidSource) => {
  const result = await importAssistantTurtle(prefixes + invalidSource + fact, options);
  expect(result.skipped.count).toBe(1);
  expect(result.value.nanopubs).toHaveLength(0);
});

it("reads repeated source names and dates deterministically, keeping dates as dates", async () => {
  // AUTHORED-BY Claude Opus 5.5
  const repeated = `ex:source a s:CreativeWork ; s:name "Second fictional title", "First fictional title" ;
    s:dateCreated "2026-10-03"^^xsd:date, "2026-10-02T08:30:00.123456+01:00"^^xsd:dateTime .
  ex:day a s:CreativeWork ; s:name "Dated fictional note" ; s:dateCreated "2026-09-30"^^xsd:date .`;
  const second = fact
    .replace("ex:fact", "ex:fact2")
    .replace("prov:wasDerivedFrom ex:source", "prov:wasDerivedFrom ex:day");
  const result = await roundtrip(prefixes + repeated + fact + second);
  expect(result.skipped.count).toBe(0);
  const sources = Object.fromEntries(result.view.sources.map((s) => [s.iri, s]));
  expect(sources["https://example.org/export/source"]).toMatchObject({
    title: "First fictional title",
  });
  expect(sources["https://example.org/export/day"]).toMatchObject({
    title: "Dated fictional note",
  });
  const trig = await memory.serializeNanopublications(result.value);
  // Sub-millisecond digits of a source time are truncated; a calendar date gets no invented time.
  expect(trig).toContain("2026-10-02T07:30:00.123Z");
  expect(trig).toMatch(
    /"2026-09-30"\^\^(?:xsd:date|<http:\/\/www\.w3\.org\/2001\/XMLSchema#date>)/,
  );
  expect(trig).not.toContain("2026-09-30T");
  expect(trig).not.toContain("Second fictional title");
});

it("treats case-only name variants as one name and refuses genuinely different names", async () => {
  // AUTHORED-BY Claude Opus 5.5
  const medicine = (names: string) => `ex:product a h:MedicinalProduct ; s:name ${names} .
  ex:fact a h:MedicationStatement ; h:patient <${owner}> ; s:name "Fictional medicine use" ; h:medication ex:product ;
  prov:wasDerivedFrom ex:source ; oa:exact "Fictional quote" ; p:epistemicStatus "SelfReportedExplicit" ; p:validityStatus "Current" .`;
  const same = await roundtrip(prefixes + source + medicine('"fictionalium", "Fictionalium"'));
  expect(same.skipped.count).toBe(0);
  expect(same.view.byKind.medication[0]).toMatchObject({ product: { name: "Fictionalium" } });
  const different = await importAssistantTurtle(
    prefixes + source + medicine('"Fictionalium", "Otheramine"'),
    options,
  );
  expect(different.skipped).toEqual({ count: 1, reasons: { InvalidFact: 1 } });
});

it("drops over-long quotes but keeps a fact with another exact quote", async () => {
  // AUTHORED-BY Claude Opus 5.5
  const long = "x".repeat(301);
  const both = await roundtrip(
    prefixes +
      source +
      fact.replace('oa:exact "Fictional quote"', `oa:exact "Fictional quote", "${long}"`),
  );
  expect(both.skipped.count).toBe(0);
  expect(both.value.nanopubs[0]?.evidence.map((e) => e.quote)).toEqual(["Fictional quote"]);
  const only = await importAssistantTurtle(
    prefixes + source + fact.replace('oa:exact "Fictional quote"', `oa:exact "${long}"`),
    options,
  );
  expect(only.skipped).toEqual({ count: 1, reasons: { InvalidEvidence: 1 } });
});

it("accepts a named URN export and preserves local/dateTime dates as UTC", async () => {
  const body = minimal
    .replaceAll("ex:fact", "<urn:example.org:health-export:2026:fact>")
    .replaceAll("ex:source", "<urn:example.org:health-export:2026:source>")
    .replace(
      'h:value "3.25"^^xsd:decimal',
      'h:value "Normal" ; s:validFrom "2026-10-01T12:00:00.123000"^^xsd:dateTime ; s:validThrough "2026-10-02T12:00:00+02:00"^^xsd:dateTime',
    );
  const result = await roundtrip(body);
  expect(result.skipped.count).toBe(0);
  expect(result.view.byKind.observation[0]).toMatchObject({
    value: "Normal",
    period: { start: "2026-10-01T12:00:00.123000+00:00", end: "2026-10-02T10:00:00+00:00" },
  });
});

it.each([
  { owner: "urn:example.org:owner" },
  { owner: "https://example.org/unsafe identity" },
  { assistant: { iri: "javascript:fictional", label: "Fictional" } },
  { assistant: { iri: "relative", label: "Fictional" } },
  { assistant: { iri: options.assistant.iri, label: "" } },
  { assistant: { iri: options.assistant.iri, label: "Fictional\u2028label" } },
  { batchId: "" },
  { batchId: "Fictional\u2029batch" },
  { generatedAt: "2026-11-10T12:00:00" },
  { generatedAt: "2026-02-30T12:00:00Z" },
])("rejects invalid options with no diagnostic values", async (invalid) => {
  await expect(importAssistantTurtle(minimal, { ...options, ...invalid })).rejects.toMatchObject({
    code: "invalid-input",
    message: "Health graph operation failed (invalid-input)",
  });
});
it("hides Turtle syntax diagnostics", async () => {
  await expect(importAssistantTurtle("private malformed Turtle", options)).rejects.toMatchObject({
    code: "read-failed",
    message: "Health graph operation failed (read-failed)",
  });
});
it("returns an empty batch when there are no fact candidates", async () => {
  const result = await importAssistantTurtle(prefixes + source, options);
  expect(result.value.nanopubs).toEqual([]);
  expect(result.skipped).toEqual({ count: 0, reasons: {} });
});
it("hides unexpected build failures", async () => {
  const build = memory.buildNanopublications;
  vi.spyOn(memory, "buildNanopublications").mockImplementation((batch, opts) => {
    if (batch.claims.length) throw new Error("fictional private diagnostic");
    return build(batch, opts);
  });
  await expect(importAssistantTurtle(minimal, options)).rejects.toMatchObject({
    code: "read-failed",
    message: "Health graph operation failed (read-failed)",
  });
});

describe("CLI", () => {
  it("imports the fixture with counts only and fails without private diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "assistant-health-"));
    const script = new URL("../scripts/import-assistant-turtle.mjs", import.meta.url);
    const run = async (command: string, args: string[]) => {
      const stdoutPath = join(dir, "stdout");
      const stderrPath = join(dir, "stderr");
      const stdoutFd = openSync(stdoutPath, "w");
      const stderrFd = openSync(stderrPath, "w");
      let result: ReturnType<typeof spawnSync>;
      try {
        result = spawnSync(command, args, { stdio: ["ignore", stdoutFd, stderrFd] });
      } finally {
        closeSync(stdoutFd);
        closeSync(stderrFd);
      }
      const output = {
        stdout: await readFile(stdoutPath, "utf8"),
        stderr: await readFile(stderrPath, "utf8"),
      };
      if (result.status !== 0) throw output;
      return output;
    };
    const args = [
      script.pathname,
      fixture.pathname,
      join(dir, "out.trig"),
      "--owner",
      owner,
      "--assistant-iri",
      options.assistant.iri,
      "--assistant-label",
      options.assistant.label,
      "--batch",
      options.batchId,
    ];
    try {
      const output = await run(process.execPath, [...args, "--generated-at", generatedAt]);
      expect(output.stderr).toBe("");
      expect(JSON.parse(output.stdout)).toEqual({ imported: 8, skipped: 3 });
      const value = await memory.parseNanopublications(
        await readFile(join(dir, "out.trig"), "utf8"),
      );
      expect(projectHealthFacts(value, { owner }).facts).toHaveLength(8);
      expect((await run(process.execPath, args)).stdout).toBe('{"imported":8,"skipped":3}\n');
      await expect(
        run(process.execPath, [script.pathname, "--unknown-private-argument"]),
      ).rejects.toMatchObject({ stderr: "Assistant health import failed\n", stdout: "" });
      await expect(run(process.execPath, [script.pathname])).rejects.toMatchObject({
        stderr: "Assistant health import failed\n",
        stdout: "",
      });
      await expect(
        run(
          process.execPath,
          args.map((v) => (v === fixture.pathname ? join(dir, "missing-private-file") : v)),
        ),
      ).rejects.toMatchObject({ stderr: "Assistant health import failed\n", stdout: "" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
