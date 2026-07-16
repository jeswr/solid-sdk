// AUTHORED-BY GPT-5.6 Sol via codex

import type { DatasetCore, Literal, NamedNode } from "@rdfjs/types";
import { DataFactory, Parser, Store } from "n3";
import type { ShaclValidator } from "../src/index.js";

export const PREFIXES = `
  @prefix ex: <https://example.test/vocab#> .
  @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
  @prefix sh: <http://www.w3.org/ns/shacl#> .
  @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
`;

export function shapes(body: string): DatasetCore {
  return new Store(new Parser().parse(`${PREFIXES}\n${body}`)) as unknown as DatasetCore;
}

export function nn(value: string): NamedNode {
  return DataFactory.namedNode(value) as unknown as NamedNode;
}

export function lit(value: string, datatype?: NamedNode): Literal {
  return DataFactory.literal(value, datatype as never) as unknown as Literal;
}

export const EX = {
  AddressShape: nn("https://example.test/vocab#AddressShape"),
  OrganizationShape: nn("https://example.test/vocab#OrganizationShape"),
  PersonShape: nn("https://example.test/vocab#PersonShape"),
  fixed: nn("https://example.test/vocab#fixed"),
  name: nn("https://example.test/vocab#name"),
  score: nn("https://example.test/vocab#score"),
  status: nn("https://example.test/vocab#status"),
} as const;

export const XSD_STRING = nn("http://www.w3.org/2001/XMLSchema#string");
export const XSD_INTEGER = nn("http://www.w3.org/2001/XMLSchema#integer");

export const acceptingValidator: ShaclValidator = {
  async validate() {
    return { conforms: true, report: "accepted by test seam" };
  },
};
