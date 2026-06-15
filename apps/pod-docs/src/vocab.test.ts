import { describe, expect, it } from "vitest";
import { DCT, DEFAULT_FORMAT, DOCUMENT_CLASS, NS, PD, PREFIXES, PROV, RDF_TYPE } from "./vocab.js";

describe("vocab", () => {
  it("composes predicate IRIs from their namespace bases", () => {
    expect(DOCUMENT_CLASS).toBe("https://w3id.org/jeswr/pod-docs#Document");
    expect(RDF_TYPE).toBe("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
    expect(PD.body).toBe(`${NS.PD}body`);
    expect(PD.format).toBe(`${NS.PD}format`);
    expect(PD.currentRevision).toBe(`${NS.PD}currentRevision`);
    expect(DCT.title).toBe("http://purl.org/dc/terms/title");
    expect(DCT.created).toBe(`${NS.DCT}created`);
    expect(DCT.modified).toBe(`${NS.DCT}modified`);
    expect(DCT.creator).toBe(`${NS.DCT}creator`);
    expect(PROV.Entity).toBe("http://www.w3.org/ns/prov#Entity");
    expect(PROV.wasRevisionOf).toBe(`${NS.PROV}wasRevisionOf`);
    expect(PROV.generatedAtTime).toBe(`${NS.PROV}generatedAtTime`);
    expect(PROV.wasAttributedTo).toBe(`${NS.PROV}wasAttributedTo`);
  });

  it("defaults the body format to text/html", () => {
    expect(DEFAULT_FORMAT).toBe("text/html");
  });

  it("exposes a prefix map covering the document namespaces", () => {
    expect(PREFIXES.pd).toBe(NS.PD);
    expect(PREFIXES.dct).toBe(NS.DCT);
    expect(PREFIXES.prov).toBe(NS.PROV);
    expect(PREFIXES.xsd).toBe(NS.XSD);
  });
});
