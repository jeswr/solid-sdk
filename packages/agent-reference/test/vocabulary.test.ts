// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync } from "fs";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { MESSAGE_KINDS, REASON_CODES } from "../src/core/types.js";
import { bundledContext } from "../src/wire/contexts.js";

const { namedNode } = DataFactory;
const AWP = "https://w3id.org/jeswr/awp#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const SH = "http://www.w3.org/ns/shacl#";
const ontology = await parseRdf(
  readFileSync(new URL("../vocab/answerable.ttl", import.meta.url), "utf8"),
  "text/turtle",
);
const shapes = await parseRdf(
  readFileSync(new URL("../vocab/answerable.shacl.ttl", import.meta.url), "utf8"),
  "text/turtle",
);
const context = JSON.parse(
  readFileSync(new URL("../vocab/context/v1.jsonld", import.meta.url), "utf8"),
);

describe("the published Answerable RDF model", () => {
  it("parses and defines every declared term with a human label and definition", () => {
    expect(ontology.size).toBeGreaterThan(500);
    for (const term of new Set(ontology.getSubjects(namedNode(RDF + "type"), null, null))) {
      expect(ontology.countQuads(term, namedNode(RDFS + "label"), null, null), term.value).toBe(1);
      expect(ontology.countQuads(term, namedNode(RDFS + "comment"), null, null), term.value).toBe(
        1,
      );
    }
    for (const term of ontology.getSubjects(
      namedNode(RDF + "type"),
      namedNode(RDF + "Property"),
      null,
    )) {
      for (const field of ["domain", "range"])
        expect(ontology.countQuads(term, namedNode(RDFS + field), null, null), term.value).toBe(1);
    }
  });

  it("defines every context term, uses no implicit vocabulary or base, and protects version 1", () => {
    const answerable = context["@context"].find((entry: unknown) => typeof entry === "object");
    expect(answerable["@version"]).toBe(1.1);
    expect(answerable["@protected"]).toBe(true);
    const walk = (value: unknown): void => {
      if (typeof value === "string") {
        walk(bundledContext(value)["@context"]);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
        return;
      }
      if (!value || typeof value !== "object") return;
      expect(value).not.toHaveProperty("@vocab");
      expect(value).not.toHaveProperty("@base");
      for (const [key, item] of Object.entries(value)) {
        if (key === "@context") {
          walk(item);
          continue;
        }
        const iri = typeof item === "string" ? item : item?.["@id"];
        if (typeof iri === "string" && !iri.startsWith("@"))
          expect(ontology.countQuads(namedNode(iri), null, null, null), iri).toBeGreaterThan(0);
        if (typeof item === "object" && item !== null && "@context" in item) walk(item["@context"]);
      }
    };
    walk(context["@context"]);
    for (const kind of MESSAGE_KINDS) {
      const type = kind[0]?.toUpperCase() + kind.slice(1);
      expect(answerable[type]["@context"].body["@context"]).toBeDefined();
    }
  });

  it("defines every shape path and covers every ontology class", () => {
    for (const shape of shapes.getSubjects(
      namedNode(RDF + "type"),
      namedNode(SH + "NodeShape"),
      null,
    ))
      expect(shape.value).toMatch(/^https:\/\/w3id\.org\/jeswr\/awp[#/]/);
    for (const path of shapes.getObjects(null, namedNode(SH + "path"), null))
      expect(ontology.countQuads(path, null, null, null), path.value).toBeGreaterThan(0);
    for (const type of ontology.getSubjects(
      namedNode(RDF + "type"),
      namedNode("http://www.w3.org/2002/07/owl#Class"),
      null,
    ))
      expect(
        shapes.countQuads(null, namedNode(SH + "targetClass"), type, null),
        type.value,
      ).toBeGreaterThan(0);
  });

  it("has exactly one reason individual per public reason code, in both directions", () => {
    const reasons = ontology
      .getSubjects(namedNode(RDF + "type"), namedNode(AWP + "ReasonCode"), null)
      .map((node) => node.value);
    expect(reasons.sort()).toEqual(REASON_CODES.map((code) => AWP + "reason/" + code).sort());
    expect(new Set(reasons).size).toBe(REASON_CODES.length);
  });
});
