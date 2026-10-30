// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import { NamedGraphDataset, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
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

  it("canonicalizes 50,000 legacy type triples with linear dataset reads", () => {
    const count = 50_000;
    const legacyClass = "https://w3id.org/jeswr/core#Agent";
    const source = new Store();
    for (let i = 0; i < count; i++) {
      new PodThing(`https://pod.test/items#item-${i}`, source, DataFactory).types.add(legacyClass);
    }
    // Every Store read (iteration, match, getQuads, has) goes through readQuads, so counting the quads it
    // yields bounds the work by operations rather than wall-clock time: a per-quad scan would be ~count².
    const readQuads = Store.prototype.readQuads;
    const budget = count * 4;
    let visited = 0;
    const reads = vi.spyOn(Store.prototype, "readQuads").mockImplementation(function* (
      this: Store,
      ...args: Parameters<Store["readQuads"]>
    ) {
      for (const quad of readQuads.apply(this, args)) {
        visited += 1;
        if (visited > budget) throw new Error("canonicalization read budget exceeded");
        yield quad;
      }
    });
    let result: Store;
    try {
      result = canonicalizeJeswrDataset(source);
    } finally {
      reads.mockRestore();
    }
    expect(visited).toBeGreaterThanOrEqual(count);
    expect(visited).toBeLessThanOrEqual(budget);
    expect(result.size).toBe(count);
    expect(result.getQuads(null, `${NS.RDF}type`, `${NS.CORE}Agent`, null)).toHaveLength(count);
    expect(result.getQuads(null, `${NS.RDF}type`, legacyClass, null)).toHaveLength(0);
    expect(source.getQuads(null, `${NS.RDF}type`, legacyClass, null)).toHaveLength(count);
  }, 60_000);

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
