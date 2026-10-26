// AUTHORED-BY Codex GPT-6.1-Sol
/** biome-ignore-all lint/style/noNonNullAssertion: fixtures guarantee the referenced entries. */
import { readFile } from "node:fs/promises";
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory as df, Store } from "n3";
import { isomorphic } from "rdf-isomorphic";
import { expect, it } from "vitest";
import {
  type Batch,
  buildNanopublications,
  canonicalizeAssertion,
  createFactAssertion,
  parseNanopublications,
  serializeNanopublications,
  type TemporalValue,
} from "../src/index.js";
import { graph, NS } from "../src/rdf.js";
import { exampleBuildOptions } from "../src/testing.js";

const options = exampleBuildOptions();
const entity = "https://example.org/residence";
const predicate = `${NS.schema}validFrom`;
function assertion(value: string, datatype = "dateTime"): Store {
  return new Store([
    df.quad(
      df.namedNode(entity),
      df.namedNode(predicate),
      df.literal(value, df.namedNode(NS.xsd + datatype)),
    ),
  ]);
}
function batch(claim: Store): Batch {
  return {
    batch_id: "calendar",
    worker: { agent_id: "https://example.org/agent", agent_label: "Synthetic extractor" },
    claims: [{ id: "one", assertion: claim, epistemic: "Mentioned" }],
  };
}
function template(bound: TemporalValue): Store {
  return createFactAssertion(options.owner, {
    template: "address",
    value: { id: entity, locality: "Storyville", country: "Exampleland", validFrom: bound },
  });
}

const fixtures: {
  cases: {
    name: string;
    datatype: TemporalValue["datatype"];
    values: string[];
    normalized: string;
    id: string;
    graph: string;
  }[];
} = JSON.parse(await readFile(new URL("./fixtures/temporal.json", import.meta.url), "utf8"));

it.each(fixtures.cases)("matches the RDFlib 7.1.4 temporal oracle: $name", async (fixture) => {
  const expected = [...(await parseRdf(fixture.graph, "application/n-triples"))];
  const input = batch(assertion(fixture.values[0]!, fixture.datatype));
  input.claims = fixture.values.flatMap((value, index) => {
    const raw = assertion(value, fixture.datatype);
    const canonical = canonicalizeAssertion(raw);
    expect(canonical.id, value).toBe(fixture.id);
    expect(isomorphic([...canonical.dataset], expected), value).toBe(true);
    expect([...canonical.dataset].map((q) => q.object)).toEqual([
      df.literal(fixture.normalized, df.namedNode(NS.xsd + fixture.datatype)),
    ]);
    return [raw, `<${entity}> <${predicate}> "${value}"^^xsd:${fixture.datatype} .`].map(
      (claim, form) => ({
        id: `${index}-${form}`,
        assertion: claim,
        epistemic: "Mentioned" as const,
      }),
    );
  });
  const built = await buildNanopublications(input, options);
  const parsed = await parseNanopublications(await serializeNanopublications(built));
  for (const result of [built, parsed]) {
    expect(result.nanopubs).toHaveLength(fixture.values.length * 2);
    expect(new Set(result.nanopubs.map((n) => n.assertionId))).toEqual(new Set([fixture.id]));
    expect(isomorphic([...graph(result.dataset, fixture.id)], expected)).toBe(true);
    expect([...graph(result.dataset, fixture.id)].map((q) => q.object)).toEqual([
      df.literal(fixture.normalized, df.namedNode(NS.xsd + fixture.datatype)),
    ]);
  }
});

it("keeps local dateTimes distinct from timezone-bearing instants", () => {
  const ids = ["", "Z", "+05:30", "-03:30"].map(
    (zone) => canonicalizeAssertion(assertion(`2026-01-01T12:00:00.1${zone}`)).id,
  );
  expect(new Set(ids).size).toBe(4);
});

const invalidDateTimes = [
  "2026-02-30T12:00:00Z",
  "2026-02-29T12:00:00Z",
  "1900-02-29T12:00:00Z",
  "2100-02-29T12:00:00Z",
  "2026-04-31T12:00:00Z",
  "2026-00-01T12:00:00Z",
  "2026-13-01T12:00:00Z",
  "2026-01-00T12:00:00Z",
  "2026-01-32T12:00:00Z",
  "2026-01-01T25:00:00Z",
  "2026-01-01T12:60:00Z",
  "2026-01-01T12:00:60Z",
  "2026-01-01T24:01:00Z",
  "2026-01-01T24:00:01Z",
  "2026-01-01T24:00:00.000001Z",
  "2026-01-01T24:00:00.000000001Z",
  "2026-01-01T12:00:00+14:01",
  "2026-01-01T12:00:00-14:01",
  "2026-01-01T12:00:00+15:00",
  "2026-01-01T12:00:00-15:00",
  "2026-01-01T12:00:00+23:59",
  "2026-01-01T12:00:00+13:60",
  "2026-01-01T12:00:00Z\n",
];

it.each(
  invalidDateTimes,
)("rejects invalid calendar dateTime %j at every emission boundary", async (value) => {
  expect(() => template({ value, datatype: "dateTime" })).toThrow("dateTime");
  expect(() => canonicalizeAssertion(assertion(value))).toThrow("dateTime");
  await expect(buildNanopublications(batch(assertion(value)), options)).rejects.toThrow("dateTime");
  const input = batch(assertion("2026-01-01T12:00:00Z"));
  await expect(buildNanopublications(input, { ...options, generatedAt: value })).rejects.toThrow(
    "dateTime",
  );
  input.sources = [{ id: "doc", kind: "document", url: "https://example.org/document" }];
  input.claims[0]!.evidence = [{ source: "doc", timestamp: value }];
  await expect(buildNanopublications(input, options)).rejects.toThrow("dateTime");
});

it("rejects impossible timezone-less assertion dateTimes", async () => {
  for (const value of invalidDateTimes.filter((v) => v.endsWith("Z")).map((v) => v.slice(0, -1))) {
    expect(() => template({ value, datatype: "dateTime" })).toThrow("dateTime");
    await expect(buildNanopublications(batch(assertion(value)), options)).rejects.toThrow(
      "dateTime",
    );
  }
});

it.each([
  ["date", "2026-02-30"],
  ["date", "2026-02-29"],
  ["date", "1900-02-29"],
  ["date", "2100-02-29"],
  ["date", "2026-04-31"],
  ["date", "2026-06-31"],
  ["date", "2026-09-31"],
  ["date", "2026-11-31"],
  ["date", "2026-00-01"],
  ["date", "2026-13-01"],
  ["date", "2026-01-00"],
  ["date", "2026-01-32"],
  ["date", "2026-01-01\n"],
  ["gYearMonth", "2026-00"],
  ["gYearMonth", "2026-13"],
  ["gYearMonth", "2026-01\n"],
  ["gYear", "2026\n"],
] as const)("rejects invalid %s template bound %j", (datatype, value) => {
  expect(() => template({ value, datatype })).toThrow("temporal bound");
});

it.each([
  ["date", "0000-02-29", "0000-02-29"],
  ["date", "0001-01-01", "0001-01-01"],
  ["date", "0099-12-31", "0099-12-31"],
  ["date", "1900-02-28", "1900-02-28"],
  ["date", "2000-02-29", "2000-02-29"],
  ["date", "2024-02-29", "2024-02-29"],
  ["date", "2400-02-29", "2400-02-29"],
  ...[
    "01-31",
    "03-31",
    "04-30",
    "05-31",
    "06-30",
    "07-31",
    "08-31",
    "09-30",
    "10-31",
    "11-30",
    "12-31",
  ].map((day) => ["date", `2026-${day}`, `2026-${day}`] as const),
  ["gYearMonth", "2026-01", "2026-01"],
  ["gYearMonth", "2026-12", "2026-12"],
  ["gYear", "0000", "0000"],
  ["gYear", "2026", "2026"],
  ["dateTime", "2024-02-29T23:59:59Z", "2024-02-29T23:59:59+00:00"],
  ["dateTime", "2026-01-01T12:00:00-00:00", "2026-01-01T12:00:00+00:00"],
  ["dateTime", "2026-01-01T12:00:00.1-00:00", "2026-01-01T12:00:00.100000+00:00"],
  ["dateTime", "2026-01-01T12:00:00.1", "2026-01-01T12:00:00.100000"],
  ["dateTime", "2026-01-01T12:00:00.000000", "2026-01-01T12:00:00"],
  ["dateTime", "2026-01-01T12:00:00.123456789", "2026-01-01T12:00:00.123456"],
  ["dateTime", "2000-02-29T12:00:00+14:00", "2000-02-29T12:00:00+14:00"],
  ["dateTime", "2026-01-01T12:00:00-14:00", "2026-01-01T12:00:00-14:00"],
  ["dateTime", "2026-01-01T12:00:00+13:59", "2026-01-01T12:00:00+13:59"],
  ["dateTime", "2026-01-01T12:00:00-13:59", "2026-01-01T12:00:00-13:59"],
  ["dateTime", "2026-01-31T24:00:00Z", "2026-01-31T24:00:00Z"],
  ["dateTime", "2026-01-31T24:00:00.000Z", "2026-01-31T24:00:00.000Z"],
  ["dateTime", "2026-01-31T24:00:00", "2026-01-31T24:00:00"],
] as const)("round-trips valid %s bound %j with its declared precision", async (datatype, value, expected) => {
  const built = await buildNanopublications(batch(template({ value, datatype })), options);
  const parsed = await parseNanopublications(await serializeNanopublications(built));
  for (const result of [built, parsed]) {
    const term = [...graph(result.dataset, result.nanopubs[0]!.assertionId)].find(
      (q) => q.predicate.value === predicate,
    )!.object;
    expect(term.equals(df.literal(expected, df.namedNode(NS.xsd + datatype)))).toBe(true);
  }
});

it.each([
  ["", ""],
  [".1", ".100000"],
  [".000000", ""],
])("shares assertion graphs for UTC spellings with fraction %j", async (fraction, expectedFraction) => {
  const input = batch(assertion(`2026-01-01T12:00:00${fraction}-00:00`));
  input.claims = ["-00:00", "+00:00", "Z"].flatMap((offset) => {
    const value = `2026-01-01T12:00:00${fraction}${offset}`;
    return [assertion(value), `<${entity}> <${predicate}> "${value}"^^xsd:dateTime .`].map(
      (claim, index) => ({
        id: `${offset}-${index}`,
        assertion: claim,
        epistemic: "Mentioned" as const,
      }),
    );
  });
  const built = await buildNanopublications(input, options);
  const parsed = await parseNanopublications(await serializeNanopublications(built));
  for (const result of [built, parsed]) {
    expect(result.nanopubs).toHaveLength(6);
    expect(new Set(result.nanopubs.map((n) => n.assertionId)).size).toBe(1);
    const contents = graph(result.dataset, result.nanopubs[0]!.assertionId);
    expect([...contents].map((q) => q.object)).toEqual([
      df.literal(`2026-01-01T12:00:00${expectedFraction}+00:00`, df.namedNode(`${NS.xsd}dateTime`)),
    ]);
  }
});

it.each([
  "2026-02-30T12:00:00Z",
  "2026-01-01T12:00:00+14:01",
])("rejects invalid publication calendar value %s when parsing TriG", async (value) => {
  const built = await buildNanopublications(batch(assertion("2026-01-01T12:00:00Z")), options);
  const n = built.nanopubs[0]!;
  const pubinfo = df.namedNode(n.pubinfoId);
  const generated = df.namedNode(`${NS.prov}generatedAtTime`);
  built.dataset.removeQuads(built.dataset.getQuads(df.namedNode(n.id), generated, null, pubinfo));
  built.dataset.addQuad(
    df.namedNode(n.id),
    generated,
    df.literal(value, df.namedNode(`${NS.xsd}dateTime`)),
    pubinfo,
  );
  await expect(parseNanopublications(await serializeNanopublications(built))).rejects.toThrow(
    "dateTime",
  );
});
