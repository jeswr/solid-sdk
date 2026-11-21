// AUTHORED-BY Codex GPT-6.2 Sol
import { expect, it } from "vitest";
import { digestBytes } from "../src/core/canonical.js";
import { traceFileSchema } from "../src/trace/schema.js";
import { TRACE_SCHEMA } from "../src/trace/types.js";
import { STORE_CONTEXT } from "../src/wire/store-contexts.js";

const jsonld = JSON.stringify({ "@context": STORE_CONTEXT, "@id": "urn:test:record" });
const key = digestBytes(jsonld);
const entry = {
  what: "record-entry",
  context: STORE_CONTEXT,
  jsonld,
  turtle: "<urn:test:record> a <urn:test:Type> .",
};

it("accepts both legacy and linked traces", () => {
  expect(traceFileSchema.safeParse({ schema: TRACE_SCHEMA, events: [{}] }).success).toBe(true);
  expect(
    traceFileSchema.safeParse({
      schema: TRACE_SCHEMA,
      events: [{ linked: [key] }],
      linked: { [key]: entry },
    }).success,
  ).toBe(true);
});

it("refuses a reference missing from the table", () => {
  const trace = { schema: TRACE_SCHEMA, events: [{ linked: [key] }] };
  expect(traceFileSchema.safeParse(trace).success).toBe(false);
  expect(traceFileSchema.safeParse({ ...trace, linked: {} }).success).toBe(false);
});

it("checks the linked key and value shapes", () => {
  for (const linked of [{ bad: entry }, { [key]: { ...entry, what: "other" } }]) {
    expect(traceFileSchema.safeParse({ schema: TRACE_SCHEMA, events: [], linked }).success).toBe(
      false,
    );
  }
});
