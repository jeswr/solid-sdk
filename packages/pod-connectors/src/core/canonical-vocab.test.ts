// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import { NamedGraphDataset, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import { DriveMetadata } from "../google-drive/vocab.js";
import { TypeIndexDataset } from "../pod/type-index.js";
import { canonicalizeJeswrDataset, canonicalJeswrIri } from "./canonical-vocab.js";
import { PodThing } from "./vocab.js";

describe("jeswr read aliases", () => {
  it("canonicalizes predicates and classes while preserving identifiers, literals, graphs and standard IRIs", () => {
    const legacy = "https://w3id.org/jeswr/";
    const subject = `${legacy}pod-drive#resource`;
    const source = new Store(
      new Parser({ format: "TriG" }).parse(`
      <${legacy}graph> {
        <${subject}> a <${legacy}core#Agent>, <http://schema.org/Thing>;
          <${legacy}pod-drive#md5Checksum> "${legacy}literal";
          <${legacy}pod-drive#contentSkipped> "pending-deletion";
          <http://schema.org/url> <${legacy}resource> .
      }
      <https://pod.test/index#registration>
        a <http://www.w3.org/ns/solid/terms#TypeRegistration>;
        <http://www.w3.org/ns/solid/terms#forClass> <${legacy}core#Agent>;
        <http://www.w3.org/ns/solid/terms#instanceContainer> <${legacy}container/> .
      _:item <${legacy}sectors/social#content> "synthetic note" .
    `),
    );
    const before = [...source];
    const result = canonicalizeJeswrDataset(source);
    const graph = new NamedGraphDataset(
      DataFactory.namedNode(`${legacy}graph`),
      result,
      DataFactory,
    );
    const item = new DriveMetadata(subject, graph, DataFactory);
    expect(item.checksum).toBe(`${legacy}literal`);
    expect(item.contentSkipped).toBe("pending-deletion");
    expect([...item.types].sort()).toEqual(["http://schema.org/Thing", `${NS.CORE}Agent`].sort());
    expect(
      result.getQuads(null, DataFactory.namedNode("http://schema.org/url"), null, null)[0]?.object
        .value,
    ).toBe(`${legacy}resource`);
    expect(
      result.getQuads(null, DataFactory.namedNode(`${NS.SOCIAL}content`), null, null)[0]?.subject
        .termType,
    ).toBe("BlankNode");
    const index = new TypeIndexDataset(source, DataFactory);
    expect(index.locate(`${NS.CORE}Agent`)).toEqual([
      { forClass: `${NS.CORE}Agent`, instance: undefined, container: `${legacy}container/` },
    ]);
    expect(index.locate(`${legacy}core#Agent`)).toEqual(index.locate(`${NS.CORE}Agent`));
    expect([...source]).toEqual(before);
    const repeated = canonicalizeJeswrDataset(result);
    expect(repeated.size).toBe(result.size);
    expect([...repeated].every((quad) => result.has(quad))).toBe(true);
  });

  it("keeps schema.org HTTP classes distinct in Type Index lookups", () => {
    const source = new Store(
      new Parser().parse(`
      <https://pod.test/index#mail> a <http://www.w3.org/ns/solid/terms#TypeRegistration>;
        <http://www.w3.org/ns/solid/terms#forClass> <http://schema.org/EmailMessage> .
    `),
    );
    const index = new TypeIndexDataset(canonicalizeJeswrDataset(source), DataFactory);
    expect(index.locate("http://schema.org/EmailMessage")).toHaveLength(1);
    expect(index.locate("https://schema.org/EmailMessage")).toEqual([]);
    for (const iri of [
      "http://schema.org/name",
      "http://schema.org/EmailMessage",
      "https://example.test/unknown",
    ])
      expect(canonicalJeswrIri(iri)).toBe(iri);
    expect(canonicalizeJeswrDataset().size).toBe(0);
  });

  it("deduplicates canonical and legacy terms without losing their objects", () => {
    const source = new Store(
      new Parser().parse(`
      <https://pod.test/item> a <https://w3id.org/jeswr/core#Agent>, <${NS.CORE}Agent>;
        <https://w3id.org/jeswr/pod-drive#md5Checksum> "same";
        <${NS.POD_DRIVE}md5Checksum> "same" .
    `),
    );
    const result = canonicalizeJeswrDataset(source);
    expect(result.size).toBe(2);
    expect([...new PodThing("https://pod.test/item", result, DataFactory).types]).toEqual([
      `${NS.CORE}Agent`,
    ]);
  });

  it("canonicalizes 50,000 legacy type triples in linear time", () => {
    const legacyClass = "https://w3id.org/jeswr/core#Agent";
    const legacyStore = (count: number) => {
      const store = new Store();
      for (let i = 0; i < count; i++) {
        new PodThing(`https://pod.test/items#item-${i}`, store, DataFactory).types.add(legacyClass);
      }
      return store;
    };
    // Best of three runs, so a slow or noisy CI runner affects both sizes alike; no wall-clock bound.
    const fastest = (store: Store) => {
      let best = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 3; run++) {
        const started = performance.now();
        canonicalizeJeswrDataset(store);
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    const small = legacyStore(12_500);
    const source = legacyStore(50_000);
    fastest(small);
    // Four times the input: linear work is about 4x, quadratic about 16x.
    expect(fastest(source) / Math.max(fastest(small), 1)).toBeLessThan(10);

    const result = canonicalizeJeswrDataset(source);
    expect(result.size).toBe(50_000);
    expect(result.getQuads(null, `${NS.RDF}type`, `${NS.CORE}Agent`, null)).toHaveLength(50_000);
    expect(result.getQuads(null, `${NS.RDF}type`, legacyClass, null)).toHaveLength(0);
    expect(source.getQuads(null, `${NS.RDF}type`, legacyClass, null)).toHaveLength(50_000);
  });

  it("preserves blank nodes, literal metadata and named graph identities in transformed and unchanged quads", () => {
    const source = new Store();
    const subject = DataFactory.blankNode("synthetic-subject");
    const object = DataFactory.blankNode("synthetic-object");
    const literals = [
      DataFactory.literal("https://w3id.org/jeswr/literal"),
      DataFactory.literal("synthetic note", "en"),
      DataFactory.literal("7", DataFactory.namedNode(`${NS.XSD}integer`)),
    ];
    const graphs = [
      DataFactory.namedNode("https://w3id.org/jeswr/graph"),
      DataFactory.blankNode("synthetic-graph"),
    ];
    for (const graph of graphs) {
      const view = new NamedGraphDataset(graph, source, DataFactory);
      new PodThing(subject, view, DataFactory).types.add("https://w3id.org/jeswr/core#Agent");
      const anchor = new TermWrapper(subject, view, DataFactory);
      const content = SetFrom.subjectPredicate(
        anchor,
        "https://w3id.org/jeswr/sectors/social#content",
        TermAs.term,
        TermFrom.itself,
      );
      for (const literal of literals) content.add(literal);
      for (const predicate of ["https://w3id.org/jeswr/core#about", `${NS.SCHEMA}about`])
        SetFrom.subjectPredicate(anchor, predicate, TermAs.term, TermFrom.itself).add(object);
    }
    const before = [...source];
    const result = canonicalizeJeswrDataset(source);
    expect(result.size).toBe(source.size);
    for (const graph of graphs) {
      expect(result.getQuads(subject, `${NS.RDF}type`, `${NS.CORE}Agent`, graph)).toHaveLength(1);
      for (const literal of literals)
        expect(result.getQuads(subject, `${NS.SOCIAL}content`, literal, graph)).toHaveLength(1);
      for (const predicate of [`${NS.CORE}about`, `${NS.SCHEMA}about`])
        expect(result.getQuads(subject, predicate, object, graph)).toHaveLength(1);
    }
    expect([...source]).toEqual(before);
  });
});
