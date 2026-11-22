// AUTHORED-BY Codex GPT-6
import { DataFactory } from "n3";
import { expect, it } from "vitest";
import { NamedValuesNode, readValue, SCHEMA, writeValue } from "../src/model/named-values.js";

it("round-trips named-value objects, arrays, nulls, and scalars", () => {
  const value = {
    emptyObject: {},
    emptyList: [],
    "urn:example:property": [
      null,
      false,
      true,
      "",
      "plain string",
      "urn:example:iri",
      42,
      -0,
      1.25,
      1e-30,
      1e30,
      ["duplicate", "duplicate", { nested: [null] }],
    ],
  };
  const root = NamedValuesNode.from(value, "urn:example:root");
  expect(root.toObject()).toStrictEqual(value);
  expect(readValue(DataFactory.namedNode(root.id), root.dataset, root.id)).toStrictEqual(value);
});

it("refuses a named-value entry from another collection", () => {
  const root = NamedValuesNode.from({ nested: { field: true } }, "urn:example:root");
  const other = NamedValuesNode.from({ field: false }, "urn:example:other", root.dataset);
  const nested = new NamedValuesNode(root.entries[0]!.domainValue, root.dataset);
  const predicate = DataFactory.namedNode(SCHEMA + "itemListElement");
  root.dataset.removeQuad(nested as never, predicate, nested.entries[0] as never);
  root.dataset.addQuad(nested as never, predicate, other.entries[0] as never);
  expect(() => root.toValue()).toThrow(/invalid scoped named-value entry/i);
});

it.each([
  { name: "null", value: null },
  { name: "object", value: {} },
  { name: "array", value: [] },
])("refuses a misplaced $name", ({ value }) => {
  const root = NamedValuesNode.from({}, "urn:example:root");
  const term = writeValue(value, root.id + ":other", root.dataset);
  expect(() => readValue(term, root.dataset, root.id)).toThrow(/invalid scoped named value/i);
});
