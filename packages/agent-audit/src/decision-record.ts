// AUTHORED-BY Codex GPT-6.1-Sol
// Adapted from accountable-agent-runtime's provisional decision record to agent-mandate.
import { AGENT } from "@jeswr/agent-model";
import type { Node } from "./rdf.js";
import type { AuditRecord } from "./records.js";

/** Reify the exact request and recorded verdict so RDF readers can compare a re-run. */
export function writeDecisionRecord(n: Node, record: AuditRecord, at: string): void {
  n.setIri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type", `${AGENT}DecisionRecord`);
  n.setText(`${AGENT}evaluatedAt`, at, "http://www.w3.org/2001/XMLSchema#dateTime");
  n.setIri(`${AGENT}rootPrincipal`, record.owner);
  n.setIri(`${AGENT}leafAssignee`, record.agent);
  if (record.decision !== undefined) n.setText(`${AGENT}decision`, record.decision);
  if (record.reason !== undefined) n.setText(`${AGENT}reason`, record.reason);
  if (record.termsDigest !== undefined) n.setText(`${AGENT}termsDigest`, record.termsDigest);
  if (record.mandate !== undefined) n.setIri(`${AGENT}chainPolicy`, record.mandate);
  if (record.terms !== undefined) {
    n.setIri(`${AGENT}requestAction`, record.terms.action);
    n.setIri(`${AGENT}requestTarget`, record.terms.target);
    if (record.terms.purpose !== undefined)
      n.setIri(`${AGENT}requestPurpose`, record.terms.purpose);
  }
}
