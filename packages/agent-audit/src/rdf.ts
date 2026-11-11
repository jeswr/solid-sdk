// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { AGENT, PROV } from "@jeswr/agent-model/vocab";
import { parseRdf } from "@jeswr/fetch-rdf";
import type { DataFactory as Factory, Quad } from "@rdfjs/types";
import {
  NamedGraphDataset,
  NamedNodeFrom,
  SetFrom,
  TermAs,
  TermFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { writeEntryGraph, writeHeadGraph } from "./prov.js";
import type { LedgerEntry } from "./records.js";

export { AGENT, PROV } from "@jeswr/agent-model/vocab";
/** Strict wrapper accessors; an ambiguous/missing/wrong-kind value is unwalkable. */
export class Node extends TermWrapper {
  values(p: string): Node[] {
    return [...SetFrom.subjectPredicate(this, p, TermAs.instance(Node), TermFrom.instance)];
  }
  text(p: string): string {
    const values = this.values(p);
    if (values.length !== 1 || values[0]?.termType !== "Literal")
      throw new Error("Missing or ambiguous audit literal");
    return values[0].value;
  }
  setIri(p: string, value: string): void {
    SetFrom.subjectPredicate(this, p, TermAs.instance(Node), TermFrom.instance).add(
      new Node(DataFactory.namedNode(value), this.dataset, this.factory),
    );
  }
  setText(p: string, value: string, datatype = "http://www.w3.org/2001/XMLSchema#string"): void {
    SetFrom.subjectPredicate(this, p, TermAs.instance(Node), TermFrom.instance).add(
      new Node(
        DataFactory.literal(value, DataFactory.namedNode(datatype)),
        this.dataset,
        this.factory,
      ),
    );
  }
}
export function node(store: Store, id: string): Node {
  return new Node(
    NamedNodeFrom.string(id, DataFactory as unknown as Factory),
    store,
    DataFactory as unknown as Factory,
  );
}
/** Read only after verifyApproval has authenticated the single linked proof graph. */
export async function verifiedApprovalCreatedAt(document: string, id: string): Promise<number> {
  const store = await parseRdf(document, "application/trig");
  const graph = node(store, id).values("https://w3id.org/security#proof")[0] as Node;
  const dataset = new NamedGraphDataset(TermAs.term(graph) as Quad["graph"], store, graph.factory);
  // Approval verification requires one proof subject and one creation-time literal.
  const proof = new Node(([...dataset][0] as Quad).subject, dataset, graph.factory);
  return Date.parse(proof.text("http://purl.org/dc/terms/created"));
}
export function entryGraph(url: string, e: LedgerEntry): Store {
  const store = new Store();
  writeEntryGraph(node(store, url), node(store, new URL("#entry", url).href), e);
  return store;
}
export function headGraph(url: string, seq: number, hash: string): Store {
  const store = new Store();
  writeHeadGraph(node(store, url), seq, hash);
  return store;
}
export function turtle(store: Store): Promise<string> {
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format: "Turtle", prefixes: { agent: AGENT, prov: PROV } });
    writer.addQuads([...store]);
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}
export async function parseTurtle(body: string, url: string): Promise<Store> {
  return new Store([...(await parseRdf(body, "text/turtle", { baseIRI: url }))]);
}
/** The PROV projection must agree with the exact hashed record, with no unsigned additions. */
export function assertSameGraph(actual: Store, expected: Store): void {
  if (actual.size !== expected.size || ![...expected].every((q) => actual.has(q)))
    throw new Error("missing-prov: audit projection differs from its hashed record");
}
