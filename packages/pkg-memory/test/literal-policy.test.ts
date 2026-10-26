// AUTHORED-BY Codex GPT-6.1-Sol
/** biome-ignore-all lint/style/noNonNullAssertion: fixtures guarantee the referenced entries. */
import { serialize } from "@jeswr/rdf-serialize";
import type { Literal } from "@rdfjs/types";
import { DataFactory as df, Store } from "n3";
import { expect, it } from "vitest";
import {
  type Batch,
  buildNanopublications,
  canonicalizeAssertion,
  createFactAssertion,
  parseAssertion,
  parseNanopublications,
  serializeNanopublications,
  UnsupportedLiteralCharacterError,
  UnsupportedLiteralDatatypeError,
} from "../src/index.js";
import { graph, NS } from "../src/rdf.js";
import { exampleBuildOptions } from "../src/testing.js";

const options = exampleBuildOptions();
function assertion(literal: Literal): Store {
  return new Store([
    df.quad(df.namedNode(options.owner), df.namedNode(`${NS.schema}value`), literal),
  ]);
}
function batch(value: Store | string): Batch {
  return {
    batch_id: "literal-policy",
    worker: { agent_id: "https://example.org/agent", agent_label: "Synthetic extractor" },
    claims: [{ id: "one", assertion: value, epistemic: "Mentioned" }],
  };
}

it.each([
  ["string", "  Synthetic text  ", "  Synthetic text  "],
  ["langString", "Synthetic text", "Synthetic text"],
  ["integer", " +0009007199254740993 ", "9007199254740993"],
  ["integer", "1.2", "1.2"],
  ["decimal", "-000.00", "-0.00"],
  ["decimal", "invalid", "invalid"],
  ["boolean", "1", "true"],
  ["boolean", "invalid", "invalid"],
  ["dateTime", "2026-01-01T12:00:00.1Z", "2026-01-01T12:00:00.100000+00:00"],
  ["date", "2026-01-01Z", "2026-01-01"],
  ["gYear", "+002026Z", "2026"],
  ["gYearMonth", "+002026-01Z", "2026-01"],
])("accepts allowlisted %s literal %j and retains its normalization", async (datatype, value, expected) => {
  const literal = (text: string) =>
    datatype === "langString"
      ? df.literal(text, "en")
      : df.literal(text, df.namedNode(NS.xsd + datatype));
  const raw = assertion(literal(value));
  const canonical = canonicalizeAssertion(raw);
  expect([...canonical.dataset].map((q) => q.object)).toEqual([literal(expected)]);
  const turtle = await serialize([...raw]);
  for (const input of [raw, turtle]) {
    const built = await buildNanopublications(batch(input), options);
    const parsed = await parseNanopublications(await serializeNanopublications(built));
    for (const result of [built, parsed]) {
      expect(result.nanopubs[0]!.assertionId).toBe(canonical.id);
      expect([...graph(result.dataset, canonical.id)].map((q) => q.object)).toEqual([
        literal(expected),
      ]);
    }
  }
});

it.each([
  ...[
    "time",
    "duration",
    "token",
    "normalizedString",
    "base64Binary",
    "hexBinary",
    "float",
    "double",
    "nonPositiveInteger",
    "negativeInteger",
    "long",
    "int",
    "short",
    "byte",
    "nonNegativeInteger",
    "unsignedLong",
    "unsignedInt",
    "unsignedShort",
    "unsignedByte",
    "positiveInteger",
    "dateTimeStamp",
    "dayTimeDuration",
    "yearMonthDuration",
    "gDay",
    "gMonth",
    "gMonthDay",
    "anyURI",
    "language",
    "QName",
    "NOTATION",
  ].map((name) => NS.xsd + name),
  `${NS.rdf}XMLLiteral`,
  `${NS.rdf}HTML`,
  "https://example.org/custom-datatype",
  "https://example.org/integer",
  `${NS.xsd}String`,
  `${NS.xsd}integer-extra`,
])("rejects unsupported datatype %s with a typed error at every RDF boundary", async (datatype) => {
  const raw = assertion(df.literal("12:00:00.1Z", df.namedNode(datatype)));
  const error = expect.objectContaining({ name: "UnsupportedLiteralDatatypeError", datatype });
  expect(() => canonicalizeAssertion(raw)).toThrow(UnsupportedLiteralDatatypeError);
  expect(() => canonicalizeAssertion(raw)).toThrow(error);
  const turtle = await serialize([...raw]);
  await expect(parseAssertion(turtle, options.owner)).rejects.toThrow(error);
  for (const input of [raw, turtle])
    await expect(buildNanopublications(batch(input), options)).rejects.toThrow(error);

  const built = await buildNanopublications(batch(assertion(df.literal("safe"))), options);
  const q = [...raw][0]!;
  built.dataset.addQuad(
    q.subject,
    q.predicate,
    q.object,
    df.namedNode(built.nanopubs[0]!.assertionId),
  );
  await expect(serializeNanopublications(built)).rejects.toThrow(error);
  const trig = await serialize([...built.dataset], { format: "application/trig" });
  await expect(parseNanopublications(trig)).rejects.toThrow(error);
});

it.each([
  "\u2028",
  "\u2029",
  "\u0085",
  "\u000b",
  "\u000c",
  "\u001c",
  "\u001d",
  "\u001e",
])("rejects Python line separator %j before normalizing, hashing or emitting RDF", async (separator) => {
  const error = expect.objectContaining({
    name: "UnsupportedLiteralCharacterError",
    codePoint: separator.codePointAt(0),
  });
  for (const datatype of [
    "string",
    "langString",
    "integer",
    "decimal",
    "boolean",
    "dateTime",
    "date",
    "gYear",
    "gYearMonth",
  ]) {
    for (const value of [`${separator}1`, `1${separator}2`, `1${separator}`]) {
      const literal =
        datatype === "langString"
          ? df.literal(value, "en")
          : df.literal(value, df.namedNode(NS.xsd + datatype));
      expect(() => canonicalizeAssertion(assertion(literal))).toThrow(error);
    }
  }
  const raw = assertion(df.literal(`before${separator}after`));
  expect(() => canonicalizeAssertion(raw)).toThrow(UnsupportedLiteralCharacterError);
  const turtle = await serialize([...raw]);
  await expect(parseAssertion(turtle, options.owner)).rejects.toThrow(error);
  for (const input of [raw, turtle])
    await expect(buildNanopublications(batch(input), options)).rejects.toThrow(error);
  expect(() =>
    createFactAssertion(options.owner, {
      template: "preference",
      value: { propertyID: "synthetic", value: separator },
    }),
  ).toThrow(error);

  for (const field of ["agent", "note", "evidence", "entity", "skipped"] as const) {
    const input = batch(assertion(df.literal("safe")));
    input.sources = [{ id: "doc", kind: "document", url: "https://example.org/document" }];
    if (field === "agent") input.worker.agent_label = separator;
    if (field === "note") input.claims[0]!.note = separator;
    if (field === "evidence") input.claims[0]!.evidence = [{ source: "doc", quote: separator }];
    if (field === "entity")
      input.entities = [{ id: "https://example.org/entity", label: separator }];
    if (field === "skipped") {
      input.claims = [];
      input.skipped_sensitive = [{ category: "pd:Identifying", note: separator }];
    }
    await expect(buildNanopublications(input, options)).rejects.toThrow(error);
  }
  const built = await buildNanopublications(batch(assertion(df.literal("safe"))), options);
  const q = [...raw][0]!;
  built.dataset.addQuad(
    q.subject,
    q.predicate,
    q.object,
    df.namedNode(built.nanopubs[0]!.assertionId),
  );
  await expect(serializeNanopublications(built)).rejects.toThrow(error);
  const trig = await serialize([...built.dataset], { format: "application/trig" });
  await expect(parseNanopublications(trig)).rejects.toThrow(error);
});
