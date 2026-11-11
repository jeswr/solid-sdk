// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { canonicalJson } from "@jeswr/agent-model";
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
import { writeDecisionRecord } from "./decision-record.js";
import type { LedgerEntry } from "./records.js";

export const AGENT = "https://jeswr.org/ns/agent#";
export const PROV = "http://www.w3.org/ns/prov#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
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
  const n = node(store, url);
  const entity = node(store, new URL("#entry", url).href);
  n.setIri(RDF_TYPE, `${PROV}Activity`);
  entity.setIri(RDF_TYPE, `${PROV}Entity`);
  n.setIri(`${PROV}generated`, entity.value);
  n.setText(`${AGENT}seq`, String(e.seq), "http://www.w3.org/2001/XMLSchema#integer");
  n.setText(`${PROV}startedAtTime`, e.at, "http://www.w3.org/2001/XMLSchema#dateTime");
  n.setText(`${AGENT}ledgerHash`, e.hash);
  n.setText(`${AGENT}prevHash`, e.prev);
  n.setText(
    `${AGENT}record`,
    canonicalJson(e.record),
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON",
  );
  if (e.record.type !== "ledger-checkpoint") {
    const r = e.record;
    n.setIri(`${PROV}wasAssociatedWith`, r.agent);
    entity.setIri(`${PROV}wasAttributedTo`, r.owner);
    n.setIri(`${PROV}generated`, r.id);
    if (r.taskId !== undefined) n.setText(`${AGENT}taskId`, r.taskId);
    if (r.conversation !== undefined) n.setIri(`${AGENT}conversation`, r.conversation);
    for (const id of [
      r.proposal,
      r.mandate,
      r.approval,
      r.decisionRecord,
      r.transmission,
      r.receipt,
      r.modelCall,
    ])
      if (id !== undefined) n.setIri(`${PROV}used`, id);
    if (r.type === "decision") writeDecisionRecord(n, r, e.at);
    if (r.type === "personal-data-read") {
      if (r.purpose !== undefined) n.setIri("https://w3id.org/dpv#hasPurpose", r.purpose);
      for (const category of r.categories as string[])
        n.setIri("https://w3id.org/dpv#hasPersonalData", category);
      for (const resource of r.resources as string[]) n.setIri(`${PROV}used`, resource);
    }
  }
  return store;
}
export function headGraph(url: string, seq: number, hash: string): Store {
  const store = new Store();
  const n = node(store, url);
  n.setIri(RDF_TYPE, `${AGENT}AuditChain`);
  n.setIri(RDF_TYPE, `${PROV}Collection`);
  n.setText(`${AGENT}seq`, String(seq), "http://www.w3.org/2001/XMLSchema#integer");
  n.setText(`${AGENT}ledgerHash`, hash);
  n.setIri(`${PROV}hadMember`, new URL(`${seq}.ttl#entry`, url).href);
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
