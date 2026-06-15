// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { Store } from "n3";
import { describe, expect, it } from "vitest";
import { DataFactory } from "../src/serialise.js";
import { TypeIndexDataset } from "../src/typeIndex.js";
import { FinClass, SolidTerm } from "../src/vocab.js";
import { parseTurtle } from "./helpers.js";

const INDEX_URL = "https://pod.example/settings/publicTypeIndex.ttl";
const CONTAINER = "https://pod.example/finance/";

function emptyIndex(): TypeIndexDataset {
  return new TypeIndexDataset(new Store(), DataFactory);
}

describe("TypeIndexDataset", () => {
  it("marks a public index document with the listed-document type", () => {
    const index = emptyIndex();
    index.markIndex(INDEX_URL, "public");
    const doc = new Set<string>();
    for (const q of index.match()) {
      if (q.subject.value === INDEX_URL && q.predicate.value.endsWith("type")) {
        doc.add(q.object.value);
      }
    }
    expect(doc.has(SolidTerm.TypeIndex)).toBe(true);
    expect(doc.has(SolidTerm.ListedDocument)).toBe(true);
  });

  it("marks a private index document with the unlisted-document type", () => {
    const index = emptyIndex();
    index.markIndex(INDEX_URL, "private");
    const doc = new Set<string>();
    for (const q of index.match()) {
      if (q.subject.value === INDEX_URL && q.predicate.value.endsWith("type")) {
        doc.add(q.object.value);
      }
    }
    expect(doc.has(SolidTerm.UnlistedDocument)).toBe(true);
  });

  it("registers a class against a container and locates it", () => {
    const index = emptyIndex();
    const reg = index.register(INDEX_URL, "#r-txn", FinClass.Transaction, { container: CONTAINER });
    expect(reg.forClass).toBe(FinClass.Transaction);
    expect(reg.instanceContainer).toBe(CONTAINER);
    expect(reg.types.has(SolidTerm.TypeRegistration)).toBe(true);
    expect(index.locate(FinClass.Transaction)).toEqual([{ container: CONTAINER }]);
  });

  it("registers a class against a single instance", () => {
    const index = emptyIndex();
    const instance = `${CONTAINER}ledger.ttl`;
    index.register(INDEX_URL, "#r-acc", FinClass.FinancialAccount, { instance });
    expect(index.locate(FinClass.FinancialAccount)).toEqual([{ instance }]);
  });

  it("is idempotent — registering the same class+location reuses the entry", () => {
    const index = emptyIndex();
    const a = index.register(INDEX_URL, "#r-txn", FinClass.Transaction, { container: CONTAINER });
    const b = index.register(INDEX_URL, "#r-txn-2", FinClass.Transaction, { container: CONTAINER });
    expect(b.value).toBe(a.value);
    expect([...index.registrations]).toHaveLength(1);
  });

  it("does NOT dedupe a different location for the same class", () => {
    const index = emptyIndex();
    index.register(INDEX_URL, "#r1", FinClass.Transaction, { container: CONTAINER });
    index.register(INDEX_URL, "#r2", FinClass.Transaction, { instance: `${CONTAINER}ledger.ttl` });
    expect([...index.registrations]).toHaveLength(2);
    expect(index.locate(FinClass.Transaction)).toHaveLength(2);
  });

  it("locate returns an empty array for an unregistered class", () => {
    expect(emptyIndex().locate(FinClass.Holding)).toEqual([]);
  });

  it("locate skips registrations for a non-matching class", () => {
    const index = emptyIndex();
    index.register(INDEX_URL, "#r-txn", FinClass.Transaction, { container: CONTAINER });
    // The index HAS a registration, but not for Holding — exercises the
    // non-matching branch of the locate scan.
    expect(index.locate(FinClass.Holding)).toEqual([]);
  });

  it("reads a hand-written index parsed from Turtle", () => {
    const turtle = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      @prefix fin: <https://TBD.example/solid/finance#> .
      <> a solid:TypeIndex, solid:ListedDocument .
      <#r> a solid:TypeRegistration ;
        solid:forClass fin:Transaction ;
        solid:instanceContainer <https://pod.example/finance/> .
    `;
    const index = new TypeIndexDataset(parseTurtle(turtle, INDEX_URL), DataFactory);
    expect(index.locate(FinClass.Transaction)).toEqual([{ container: CONTAINER }]);
    expect([...index.registrations]).toHaveLength(1);
  });

  it("clears registration fields when set to undefined", () => {
    const index = emptyIndex();
    const reg = index.register(INDEX_URL, "#r", FinClass.Transaction, { container: CONTAINER });
    reg.forClass = undefined;
    reg.instance = undefined;
    reg.instanceContainer = undefined;
    expect(reg.forClass).toBeUndefined();
    expect(reg.instance).toBeUndefined();
    expect(reg.instanceContainer).toBeUndefined();
  });
});
