// AUTHORED-BY Codex GPT-6.1-Sol
import { readFile } from "node:fs/promises";
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory as df, Store } from "n3";
import { isomorphic } from "rdf-isomorphic";
import { expect, it } from "vitest";
import {
  canonicalizeAssertion,
  messageId,
  PKG_NAMESPACE_UUID,
  parseAssertion,
  pkgId,
  UnsupportedLiteralDatatypeError,
  UnsupportedLiteralLexicalFormError,
} from "../src/index.js";
import { exampleBuildOptions } from "../src/testing.js";

it("matches supported RDFlib canonicalization oracles and rejects unsupported historical cases", async () => {
  const fixtures: { cases: { name: string; assertion: string; id: string; graph: string }[] } =
    JSON.parse(await readFile(new URL("./fixtures/canonical.json", import.meta.url), "utf8"));
  for (const fixture of fixtures.cases) {
    if (["typed", "decimal", "derived-integers", "invalid-numerics"].includes(fixture.name)) {
      await expect(parseAssertion(fixture.assertion, exampleBuildOptions().owner)).rejects.toThrow(
        UnsupportedLiteralLexicalFormError,
      );
      continue;
    }
    if (fixture.name === "floating-point") {
      await expect(parseAssertion(fixture.assertion, exampleBuildOptions().owner)).rejects.toThrow(
        UnsupportedLiteralDatatypeError,
      );
      continue;
    }
    const result = canonicalizeAssertion(
      await parseAssertion(fixture.assertion, exampleBuildOptions().owner),
    );
    expect(result.id, fixture.name).toBe(fixture.id);
    expect(
      isomorphic(
        [...result.dataset],
        [...(await parseRdf(fixture.graph, "application/n-triples"))],
      ),
      fixture.name,
    ).toBe(true);
    const relabeled = fixture.assertion
      .replaceAll("_:a", "_:xx")
      .replaceAll("_:b", "_:yy")
      .replaceAll("_:c", "_:zz")
      .split(" .")
      .reverse()
      .join(" .");
    // Change source order separately; Turtle punctuation is retained.
    const shuffled = await parseAssertion(
      fixture.assertion.replaceAll("_:a", "_:xx").replaceAll("_:b", "_:yy"),
      exampleBuildOptions().owner,
    );
    expect(canonicalizeAssertion(new Store([...shuffled].reverse())).id, relabeled).toBe(result.id);
  }
});

it("uses the PKG UUIDv5 namespace and the reference message id variants", () => {
  expect(PKG_NAMESPACE_UUID).toMatch(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/);
  const uuid = "12345678-1234-4234-8234-123456789abc";
  for (const input of [
    uuid,
    uuid.toUpperCase(),
    `msg_${uuid}`,
    `{${uuid}}`,
    `urn:uuid:${uuid}`,
    uuid.replaceAll("-", ""),
  ])
    expect(messageId(input)).toBe(`urn:uuid:${uuid}`);
  expect(messageId("synthetic-message")).toBe(pkgId("message", "synthetic-message"));
});

it("rejects named assertion graphs and unsafe raw dataset terms", async () => {
  const q = df.quad(
    df.namedNode("https://example.org/a"),
    df.namedNode("https://schema.org/name"),
    df.literal("Synthetic"),
    df.namedNode("https://example.org/g"),
  );
  expect(() => canonicalizeAssertion(new Store([q]))).toThrow("default graph");
  expect(() =>
    canonicalizeAssertion(
      new Store([df.quad(df.namedNode("https://example.org/>injection"), q.predicate, q.object)]),
    ),
  ).toThrow("Unsafe");
  expect(() =>
    canonicalizeAssertion(new Store([df.quad(q.subject, q.predicate, df.defaultGraph() as never)])),
  ).toThrow();
});

it("bounds individuation work on symmetric assertions", async () => {
  const graph = await parseAssertion(
    "_:a schema:knows _:b . _:b schema:knows _:a .",
    exampleBuildOptions().owner,
  );
  expect(() => canonicalizeAssertion(graph, { maxWork: 1 })).toThrow("work limit");
});

// AUTHORED-BY Claude Opus 5.5
it("validates terms and literals linearly, without canonicalizing tied blank nodes", async () => {
  const { validateAssertionTerms } = await import("../src/index.js");
  const { parseReferenceRdf } = await import("../src/rdf.js");
  const blanks = Array.from({ length: 2000 }, () => "[]").join(", ");
  const tied = await parseReferenceRdf(
    `<https://example.org/fictional> <https://example.org/p> ${blanks} .`,
    "text/turtle",
  );
  const started = performance.now();
  expect(() => validateAssertionTerms(tied)).not.toThrow();
  expect(performance.now() - started).toBeLessThan(1000);
  const invalid = await parseReferenceRdf(
    `<https://example.org/fictional> <https://example.org/p> "not-a-number"^^<http://www.w3.org/2001/XMLSchema#decimal> .`,
    "text/turtle",
  );
  expect(() => validateAssertionTerms(invalid)).toThrow(UnsupportedLiteralLexicalFormError);
  const date = await parseReferenceRdf(
    `<https://example.org/fictional> <https://example.org/p> "2026-02-30T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`,
    "text/turtle",
  );
  expect(() => validateAssertionTerms(date)).toThrow("Invalid dateTime");
});
