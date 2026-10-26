// AUTHORED-BY Codex GPT-6
/** biome-ignore-all lint/style/noNonNullAssertion: fixtures guarantee the referenced entries. */
import { readFile } from "node:fs/promises";
import { parseRdf } from "@jeswr/fetch-rdf";
import type { Literal, NamedNode } from "@rdfjs/types";
import { DataFactory as df, Store } from "n3";
import { expect, it } from "vitest";
import {
  buildNanopublications,
  canonicalizeAssertion,
  parseAssertion,
  parseNanopublications,
  serializeNanopublications,
} from "../src/index.js";
import { graph, NS, ReferenceStore } from "../src/rdf.js";
import { exampleBuildOptions } from "../src/testing.js";

const options = exampleBuildOptions();
function taggedLiteral(value: string, language: string): Literal {
  const literal = df.literal(value, language);
  Object.defineProperty(literal, "language", { value: language });
  // N3 uses its internal id when indexing its own terms.
  Object.defineProperty(literal, "id", { value: `"${value}"@${language}` });
  return literal;
}

const review: {
  languages: { tags: string[]; single: string; assertion: string; id: string; graph: string }[];
} = JSON.parse(await readFile(new URL("./fixtures/review-parity.json", import.meta.url), "utf8"));

it("deduplicates language variants on an anonymous Turtle blank node", async () => {
  const input = await parseAssertion(
    '[] schema:name "Hello"@en-US, "Hello"@en-us .',
    options.owner,
  );
  expect(input.size).toBe(1);
  expect(canonicalizeAssertion(input).id).toBe(review.languages[1]!.id);
});

it.each(
  review.languages,
)("deduplicates language variants with the first spelling and Python ID: $assertion", async (fixture) => {
  const single = await parseAssertion(fixture.single, options.owner);
  const q = [...single][0]!;
  // A spelling-preserving caller store without ReferenceStore's dedup guard.
  const raw = new Store(
    fixture.tags.map((tag) => df.quad(q.subject, q.predicate, taggedLiteral("Hello", tag))),
    {
      factory: {
        ...df,
        literal(value: string | number, languageOrDatatype?: string | NamedNode) {
          return typeof languageOrDatatype === "string"
            ? taggedLiteral(String(value), languageOrDatatype)
            : df.literal(value, languageOrDatatype);
        },
      },
    },
  );
  expect(raw.size).toBe(3);
  for (const input of [raw, await parseAssertion(fixture.assertion, options.owner)]) {
    const canonical = canonicalizeAssertion(input);
    expect(canonical.id).toBe(fixture.id);
    expect([...canonical.dataset]).toHaveLength(1);
    const actual = [...canonical.dataset][0]!;
    const expected = [...(await parseRdf(fixture.graph, "application/n-triples"))][0]!;
    expect(actual.subject.equals(expected.subject)).toBe(true);
    expect(actual.object).toMatchObject({ value: "Hello", language: fixture.tags[0] });
  }
  const built = await buildNanopublications(
    {
      batch_id: "language-dedup",
      worker: { agent_id: "https://example.org/agent", agent_label: "Synthetic" },
      claims: [fixture.single, fixture.assertion, raw].map((assertion, i) => ({
        id: String(i),
        assertion,
        epistemic: "Mentioned",
      })),
    },
    options,
  );
  const parsed = await parseNanopublications(await serializeNanopublications(built));
  for (const result of [built, parsed]) {
    expect(result.nanopubs.map((n) => n.assertionId)).toEqual(Array(3).fill(fixture.id));
    expect([...graph(result.dataset, fixture.id)]).toHaveLength(1);
  }
});

it("deduplicates mutable language statements only within their graph, subject and predicate", async () => {
  const s = df.namedNode("https://example.org/subject");
  const p = df.namedNode(`${NS.schema}name`);
  const g = df.namedNode("https://example.org/graph");
  const first = taggedLiteral("Hello", "en-US");
  const duplicate = taggedLiteral("Hello", "EN-us");
  const store = new ReferenceStore([df.quad(s, p, first)]);
  expect(store.addQuad(s, p, duplicate)).toBe(false);
  expect(store.addQuad(s, p, duplicate, g)).toBe(true);
  expect(store.addQuad(s, p, first, g)).toBe(false);
  store.addQuad(s, p, taggedLiteral("Other text", "en-us"), g);
  store.addQuad(s, p, taggedLiteral("Hello", "fr"), g);
  store.addQuad(s, p, df.literal("Hello"), g);
  store.addQuad(s, df.namedNode(`${NS.schema}label`), first, g);
  store.addQuad(df.namedNode("https://example.org/other"), p, first, g);
  expect(store.size).toBe(7);
  expect(store.getQuads(s, p, null, df.defaultGraph())[0]!.object).toMatchObject({
    language: "en-US",
  });
  const stored = store.getQuads(s, p, duplicate, g)[0]!;
  store.delete(stored);
  expect(store.addQuad(s, p, first, g)).toBe(true);
  expect(store.size).toBe(7);
  expect(store.getQuads(s, p, first, g)[0]!.object).toMatchObject({ language: "en-US" });

  const built = await buildNanopublications(
    {
      batch_id: "language-mutations",
      worker: { agent_id: "https://example.org/agent", agent_label: "Synthetic" },
      claims: [
        {
          id: "one",
          assertion: '<https://example.org/a> schema:name "A" .',
          epistemic: "Mentioned",
        },
      ],
    },
    options,
  );
  built.dataset.addQuads([...store]);
  const trig = await serializeNanopublications(built);
  // Inject a redundant case variant in the same graph to exercise TriG parsing.
  const parsed = await parseNanopublications(
    `${trig}\n<${g.value}> { <${s.value}> <${p.value}> "Hello"@EN-us . }`,
  );
  expect(parsed.dataset.size).toBe(built.dataset.size);
  expect(parsed.dataset.getQuads(s, p, first, g)).toHaveLength(1);
});
const fixtures: {
  languages: { language: string; assertion: string; id: string; graph: string }[];
} = JSON.parse(await readFile(new URL("./fixtures/literal-parity.json", import.meta.url), "utf8"));

it.each(
  fixtures.languages,
)("preserves $language in Python IDs, raw/Turtle builds and TriG round trips: $assertion", async (fixture) => {
  // The suite parser's dataset retains supplied RDF/JS terms. Supply the
  // original tag explicitly, independent of the implementation's N3 factory.
  const raw = await parseRdf(
    `@prefix schema: <${NS.schema}> . ${fixture.assertion}`,
    "text/turtle",
  );
  for (const q of [...raw]) {
    raw.delete(q);
    const literal: Literal = {
      termType: "Literal",
      value: "Hello",
      language: fixture.language,
      datatype: df.namedNode(`${NS.rdf}langString`),
      equals(other) {
        return (
          other?.termType === "Literal" &&
          other.value === this.value &&
          other.language === this.language &&
          other.datatype.equals(this.datatype)
        );
      },
    };
    raw.add(df.quad(q.subject, q.predicate, literal));
  }
  for (const input of [raw, await parseAssertion(fixture.assertion, options.owner)]) {
    const canonical = canonicalizeAssertion(input);
    expect(canonical.id).toBe(fixture.id);
    const expected = [...(await parseRdf(fixture.graph, "application/n-triples"))][0]!;
    const actual = [...canonical.dataset][0]!;
    expect(actual.subject.equals(expected.subject)).toBe(true);
    expect(actual.object).toMatchObject({ value: "Hello", language: fixture.language });
  }
  for (const assertion of [raw, fixture.assertion]) {
    const built = await buildNanopublications(
      {
        batch_id: "language-parity",
        worker: { agent_id: "https://example.org/agent", agent_label: "Synthetic" },
        claims: [{ id: "one", assertion, epistemic: "Mentioned" }],
      },
      options,
    );
    const trig = await serializeNanopublications(built);
    expect(trig).toContain(`"Hello"@${fixture.language}`);
    const parsed = await parseNanopublications(trig, "https://example.org/base/");
    for (const result of [built, parsed]) {
      expect(result.nanopubs[0]!.assertionId).toBe(fixture.id);
      expect([...graph(result.dataset, fixture.id)][0]!.object).toMatchObject({
        value: "Hello",
        language: fixture.language,
      });
    }
    expect(await serializeNanopublications(parsed)).toContain(`"Hello"@${fixture.language}`);
  }
});

it("retains tag spelling independently for matching text in separate named graphs", async () => {
  const built = await buildNanopublications(
    {
      batch_id: "language-spelling",
      worker: { agent_id: "https://example.org/agent", agent_label: "Synthetic" },
      claims: fixtures.languages
        .slice(0, 6)
        .filter((_, i) => i % 2 === 0)
        .map((fixture, i) => ({
          id: String(i),
          assertion: fixture.assertion,
          epistemic: "Mentioned",
        })),
    },
    options,
  );
  expect(new Set(built.nanopubs.map((n) => n.assertionId)).size).toBe(3);
  const parsed = await parseNanopublications(await serializeNanopublications(built));
  expect(parsed.nanopubs.map((n) => n.assertionId)).toEqual(
    built.nanopubs.map((n) => n.assertionId),
  );
  expect(
    parsed.nanopubs
      .map((n) => ([...graph(parsed.dataset, n.assertionId)][0]!.object as Literal).language)
      .sort(),
  ).toEqual(["EN-US", "en-US", "en-us"]);
});
