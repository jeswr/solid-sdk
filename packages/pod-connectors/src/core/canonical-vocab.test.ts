// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import { NamedGraphDataset } from "@rdfjs/wrapper";
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
});
