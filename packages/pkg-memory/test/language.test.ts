// AUTHORED-BY Codex GPT-6
/** biome-ignore-all lint/style/noNonNullAssertion: fixtures guarantee the referenced entries. */
import { readFile } from "node:fs/promises";
import { parseRdf } from "@jeswr/fetch-rdf";
import type { Literal } from "@rdfjs/types";
import { DataFactory as df } from "n3";
import { expect, it } from "vitest";
import {
  buildNanopublications,
  canonicalizeAssertion,
  parseAssertion,
  parseNanopublications,
  serializeNanopublications,
} from "../src/index.js";
import { graph, NS } from "../src/rdf.js";
import { exampleBuildOptions } from "../src/testing.js";

const options = exampleBuildOptions();
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
