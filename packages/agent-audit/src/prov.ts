// AUTHORED-BY Codex GPT-6.1-Sol
import { canonicalJson } from "@jeswr/agent-model/core/canonical";
import { AGENT, PROV } from "@jeswr/agent-model/vocab";
import { writeDecisionRecord } from "./decision-record.js";
import type { LedgerEntry } from "./records.js";

/** Wrapper-backed nodes supplied by the caller keep projection free of parsers and Node I/O. */
export interface AuditProjectionNode {
  readonly value: string;
  setIri(predicate: string, value: string): void;
  setText(predicate: string, value: string, datatype?: string): void;
}
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/** Write the exact PROV projection of a hashed entry to its activity and #entry nodes. */
export function writeEntryGraph(
  n: AuditProjectionNode,
  entity: AuditProjectionNode,
  e: LedgerEntry,
): void {
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
}

/** Write the exact published head projection, including its entry entity. */
export function writeHeadGraph(n: AuditProjectionNode, seq: number, hash: string): void {
  n.setIri(RDF_TYPE, `${AGENT}AuditChain`);
  n.setIri(RDF_TYPE, `${PROV}Collection`);
  n.setText(`${AGENT}seq`, String(seq), "http://www.w3.org/2001/XMLSchema#integer");
  n.setText(`${AGENT}ledgerHash`, hash);
  n.setIri(`${PROV}hadMember`, new URL(`${seq}.ttl#entry`, n.value).href);
}
