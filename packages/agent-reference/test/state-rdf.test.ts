// AUTHORED-BY Codex GPT-6.2 Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers

import { parseRdfSync } from "@jeswr/fetch-rdf";
import { readFileSync } from "fs";
import { DataFactory, Store } from "n3";
import ShaclValidator from "rdf-validate-shacl";
import { expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import { GENERIC_SECTIONS, stateDataset, stateFromRdf } from "../src/model/store/state.js";
import { emptyState, normaliseState } from "../src/store/state.js";
import { readNQuads, writeNQuads } from "../src/wire/store-quads.js";

it("round-trips a populated real state across every section, including native order", async () => {
  const fixture = JSON.parse(
    readFileSync(new URL("fixtures/state-complete.json", import.meta.url), "utf8"),
  );
  const state = normaliseState(fixture.state);
  for (const [section, value] of Object.entries(state))
    if (section !== "version") expect(Object.keys(value), section).not.toHaveLength(0);
  expect(Object.keys(state.ledgerAuditHead!)).not.toHaveLength(0);
  expect(state.descriptionAddresses).not.toHaveLength(0);
  const dataset = stateDataset(state);
  const quads = readNQuads(writeNQuads(dataset));
  const decoded = stateFromRdf(quads);
  expect(digestOf(decoded)).toBe(digestOf(state));
  for (const section of Object.keys(state) as (keyof typeof state)[]) {
    const expected = state[section];
    if (expected && typeof expected === "object")
      expect(Object.keys(decoded[section]!)).toEqual(Object.keys(expected));
  }
  const shapes = parseRdfSync(
    readFileSync(new URL("../vocab/answerable-stores.shacl.ttl", import.meta.url), "utf8"),
  );
  const projection = new Store(
    [...quads].map(({ subject, predicate, object }) =>
      DataFactory.quad(subject, predicate, object),
    ),
  );
  expect((await new ShaclValidator(shapes as never).validate(projection as never)).conforms).toBe(
    true,
  );
  expect(
    [...quads].every(({ subject, object, graph }) =>
      [subject, object, graph].every((term) => term.termType !== "BlankNode"),
    ),
  ).toBe(true);
});

it("keeps the generic sections at the ratchet and rejects an unclassified section", () => {
  const { sections } = JSON.parse(
    readFileSync(new URL("fixtures/state-generic-sections.json", import.meta.url), "utf8"),
  );
  expect([...GENERIC_SECTIONS].sort()).toEqual([...sections].sort());
  expect(() => stateDataset(emptyState())).not.toThrow();
  const unclassified = { ...emptyState(), addedSection: {} };
  expect(() => stateDataset(unclassified)).toThrow(/unsupported native snapshot section/i);
});
