// AUTHORED-BY Codex GPT-6.2 Sol
import { expect, it, vi } from "vitest";
import { digestBytes } from "../src/core/canonical.js";
import { traceFileSchema, traceFileSchemaWithLinkedTable } from "../src/trace/schema.js";
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

it("requires the applicable shared table and rejects missing keys and unsafe paths", () => {
  const reference = "linked/test--baseline.json";
  const trace = { schema: TRACE_SCHEMA, events: [{ linked: [key] }], linkedTable: reference };
  const table = { [key]: entry };
  const schema = traceFileSchemaWithLinkedTable((path) => (path === reference ? table : undefined));
  expect(schema.safeParse(trace).success).toBe(true);
  expect(traceFileSchema.safeParse(trace).success).toBe(false);
  const missing = traceFileSchemaWithLinkedTable(() => ({})).safeParse(trace);
  expect(missing.error?.issues[0]?.path).toEqual(["events", 0, "linked", 0]);
  expect(schema.safeParse({ ...trace, linked: table }).success).toBe(false);
  const resolve = vi.fn(() => table);
  const alwaysResolves = traceFileSchemaWithLinkedTable(resolve);
  for (const path of [
    "../test.json",
    "/linked/test.json",
    "linked/../test.json",
    "linked/test.json?x",
    "linked/sub/test.json",
    "linked/test.json\n",
    "linked/TEST_name.json",
  ])
    expect(alwaysResolves.safeParse({ ...trace, linkedTable: path }).success).toBe(false);
  expect(alwaysResolves.safeParse({ ...trace, linked: table }).success).toBe(false);
  expect(resolve).not.toHaveBeenCalled();
});
