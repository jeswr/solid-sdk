// AUTHORED-BY Codex GPT-6
/** biome-ignore-all lint/style/noNonNullAssertion: fixtures guarantee the referenced entries. */
import { readFile } from "node:fs/promises";
import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import { DataFactory as df, Store } from "n3";
import { isomorphic } from "rdf-isomorphic";
import { expect, it } from "vitest";
import {
  type Batch,
  buildNanopublications,
  canonicalizeAssertion,
  createFactAssertion,
  parseAssertion,
  parseNanopublications,
  serializeNanopublications,
  UnsupportedLiteralLexicalFormError,
} from "../src/index.js";
import { graph, NS } from "../src/rdf.js";
import { exampleBuildOptions } from "../src/testing.js";

const options = exampleBuildOptions();
const fixtures: {
  scalars: {
    datatype: string;
    value: string;
    accepted: boolean;
    assertion: string;
    normalized: string;
    id: string;
    graph: string;
  }[];
} = JSON.parse(await readFile(new URL("./fixtures/literal-parity.json", import.meta.url), "utf8"));

function batch(assertion: Store | string): Batch {
  return {
    batch_id: "scalar-policy",
    worker: { agent_id: "https://example.org/agent", agent_label: "Synthetic extractor" },
    claims: [{ id: "one", assertion, epistemic: "Mentioned" }],
  };
}

it.each(
  fixtures.scalars.filter((fixture) => fixture.accepted),
)("accepts canonical $datatype $value without coercion, matching Python IDs and graphs", async (fixture) => {
  const literal = df.literal(fixture.value, df.namedNode(NS.xsd + fixture.datatype));
  const raw = new Store([
    df.quad(
      df.namedNode("https://example.org/subject"),
      df.namedNode(`${NS.schema}value`),
      literal,
    ),
  ]);
  expect(fixture.normalized).toBe(fixture.value);
  const expected = [...(await parseRdf(fixture.graph, "application/n-triples"))];
  for (const input of [raw, fixture.assertion]) {
    const assertion =
      typeof input === "string" ? await parseAssertion(input, options.owner) : input;
    const canonical = canonicalizeAssertion(assertion);
    expect(canonical.id).toBe(fixture.id);
    expect(isomorphic([...canonical.dataset], expected)).toBe(true);
    const built = await buildNanopublications(batch(input), options);
    const parsed = await parseNanopublications(await serializeNanopublications(built));
    for (const result of [built, parsed]) {
      expect(result.nanopubs[0]!.assertionId).toBe(fixture.id);
      expect(isomorphic([...graph(result.dataset, fixture.id)], expected)).toBe(true);
      expect([...graph(result.dataset, fixture.id)][0]!.object.equals(literal)).toBe(true);
    }
  }
});

it.each(
  fixtures.scalars.filter((fixture) => !fixture.accepted),
)("rejects noncanonical/invalid $datatype $value with a typed error at each boundary", async (fixture) => {
  const datatype = NS.xsd + fixture.datatype;
  const literal = df.literal(fixture.value, df.namedNode(datatype));
  const raw = new Store([
    df.quad(
      df.namedNode("https://example.org/subject"),
      df.namedNode(`${NS.schema}value`),
      literal,
    ),
  ]);
  const error = expect.objectContaining({ name: "UnsupportedLiteralLexicalFormError", datatype });
  expect(() => canonicalizeAssertion(raw)).toThrow(UnsupportedLiteralLexicalFormError);
  expect(() => canonicalizeAssertion(raw)).toThrow(TypeError);
  expect(() => canonicalizeAssertion(raw)).toThrow(error);
  await expect(parseAssertion(fixture.assertion, options.owner)).rejects.toThrow(error);
  for (const input of [raw, fixture.assertion])
    await expect(buildNanopublications(batch(input), options)).rejects.toThrow(error);

  const built = await buildNanopublications(batch('me: schema:name "safe" .'), options);
  built.dataset.addQuad(
    df.namedNode("https://example.org/audit"),
    df.namedNode(`${NS.schema}value`),
    literal,
    df.namedNode("https://example.org/metadata"),
  );
  await expect(serializeNanopublications(built)).rejects.toThrow(error);
  const trig = await serialize([...built.dataset], { format: "application/trig" });
  await expect(parseNanopublications(trig)).rejects.toThrow(error);
  // Validation must not normalize or mutate a rejected caller-owned literal.
  expect([...raw][0]!.object.value).toBe(fixture.value);
  expect(built.dataset.getQuads(null, null, literal, null)).toHaveLength(1);

  if (fixture.datatype === "decimal") {
    expect(() =>
      createFactAssertion(options.owner, {
        template: "medication",
        value: {
          id: "https://example.org/statement",
          medication: { id: "https://example.org/product", name: "Fictionalium" },
          dose: { value: fixture.value, unit: "mg" },
        },
      }),
    ).toThrow(error);
  }
});

it.each([
  ["boolean", "TRUE", "true"],
  ["decimal", "1E3", "1000"],
])("records the reviewed %s coercion in the independent Python oracle", (datatype, value, normalized) => {
  expect(
    fixtures.scalars.find((fixture) => fixture.datatype === datatype && fixture.value === value),
  ).toMatchObject({ accepted: false, normalized });
});
