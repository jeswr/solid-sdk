// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import { expect, it } from "vitest";
import { XSD } from "./evidence.js";
import { RdfResource } from "./resource.js";
import { type Binding, parseTurtle, type Query, runQuery, termKey, toSparql } from "./serialise.js";

const valueKey = (row: Binding) => {
  if (!row.value) throw new Error("missing selected value");
  return termKey(row.value);
};

it("projects full RDF terms and deduplicates only identical selected bindings", () => {
  const store = new Store();
  const values = [
    DataFactory.literal("1"),
    DataFactory.literal("1", DataFactory.namedNode(`${XSD}integer`)),
    DataFactory.literal("1", "en"),
    DataFactory.literal("1", "fr"),
    DataFactory.namedNode("urn:example:1"),
    DataFactory.blankNode("1"),
  ];
  const node = new RdfResource("urn:example:subject", store, DataFactory);
  for (const value of values) node.addTerm("urn:example:value", value);
  // Each selected term has two solutions before projection.
  node.addTerm("urn:example:other", DataFactory.literal("first"));
  node.addTerm("urn:example:other", DataFactory.literal("second"));
  const query: Query = {
    id: "term-identity",
    question: "Which distinct RDF terms occur?",
    select: ["?value", "?unbound"],
    where: [
      ["?subject", "urn:example:value", "?value"],
      ["?subject", "urn:example:other", "?other"],
    ],
  };
  const result = runQuery(store, query);
  expect(result).toHaveLength(values.length);
  const keys = result.map(valueKey);
  expect(keys).toEqual(values.map(termKey).sort());
  for (const value of values) {
    const row = result.find((row) => valueKey(row) === termKey(value));
    expect(row?.value?.equals(value)).toBe(true);
    expect(row).not.toHaveProperty("unbound");
  }
  const reversed = new Store([...store].reverse());
  expect(runQuery(reversed, query).map(valueKey)).toEqual(keys);
});

it("retains datatype and language identity in joins and correlated NOT EXISTS", () => {
  const store = new Store();
  const node = new RdfResource("urn:example:subject", store, DataFactory);
  const typed = DataFactory.literal("1", DataFactory.namedNode(`${XSD}integer`));
  const english = DataFactory.literal("1", "en");
  for (const value of [DataFactory.literal("1"), typed, english, DataFactory.literal("1", "fr")]) {
    node.addTerm("urn:example:value", value);
  }
  node.addTerm("urn:example:same", typed);
  node.addTerm("urn:example:same", english);
  const query: Query = {
    id: "join-identity",
    question: "Which terms occur in both properties?",
    select: ["?value"],
    where: [
      ["?subject", "urn:example:value", "?value"],
      ["?subject", "urn:example:same", "?value"],
    ],
  };
  expect(runQuery(store, query).map(valueKey)).toEqual([typed, english].map(termKey).sort());
  const excluded: Query = {
    ...query,
    where: query.where.slice(0, 1),
    notExists: [[["?subject", "urn:example:same", "?value"]]],
  };
  expect(runQuery(store, excluded).map(valueKey)).toEqual(
    [DataFactory.literal("1"), DataFactory.literal("1", "fr")].map(termKey).sort(),
  );
});

it.each([
  { datatype: `${XSD}integer`, group: "where" },
  { datatype: `${XSD}integer`, group: "notExists" },
  { datatype: "dt:integer", group: "where" },
  { datatype: "dt:integer", group: "notExists" },
])("formats $datatype in $group with valid syntax and declarations", async ({
  datatype,
  group,
}) => {
  const prefixes = { dt: XSD };
  const typedPattern = ["?subject", "urn:example:value", { literal: "1", datatype }] as const;
  const query: Query = {
    id: "typed-literal",
    question: "Which subjects have this typed value?",
    select: ["?subject"],
    where: group === "where" ? [typedPattern] : [["?subject", "urn:example:other", "?other"]],
    notExists: group === "notExists" ? [[typedPattern]] : undefined,
  };
  const sparql = toSparql(query, prefixes);
  const formattedType = datatype.startsWith("dt:") ? datatype : `<${datatype}>`;
  expect(sparql).toContain(`?subject <urn:example:value> "1"^^${formattedType} .`);
  expect(sparql.startsWith(`PREFIX dt: <${XSD}>`)).toBe(datatype.startsWith("dt:"));
  if (group === "notExists") expect(sparql).toContain("FILTER NOT EXISTS {");
  // SPARQL's PREFIX declarations and these triple patterns share Turtle syntax.
  // Parse the emitted terms to catch bare datatype IRIs and undeclared prefixes.
  const turtle = sparql
    .split("\n")
    .filter((line) => line.startsWith("PREFIX ") || line.trim().endsWith(" ."))
    .join("\n")
    .replaceAll("?subject", "<urn:example:subject>")
    .replaceAll("?other", '"other"');
  const quads = await parseTurtle(turtle);
  const value = quads.find((q) => q.predicate.value === "urn:example:value")?.object;
  expect(value?.equals(DataFactory.literal("1", DataFactory.namedNode(`${XSD}integer`)))).toBe(
    true,
  );
  const store = new Store(quads);
  expect(runQuery(store, query, prefixes)).toHaveLength(group === "where" ? 1 : 0);
});
