// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
import type { DatasetCore } from "@jeswr/fetch-rdf";
import { digestOf } from "../core/canonical.js";
import type { AdmittedFact, ContextItem, ItemTerms } from "../gates/common.js";
import { jointLogView } from "../mechanisms/joint-privacy.js";
import { makeNode } from "../model/core-node.js";
import { IndexedStore } from "../model/indexed-store.js";
import { NamedValuesNode, scopedId } from "../model/named-values.js";
import { writeMemoryFact, writePolicy } from "../model/store/memory.js";
import { policyDataset, policySubject } from "../model/store/policy.js";
import { recordEntryDataset, recordGraphIri } from "../model/store/record.js";
import { trustDataset } from "../model/store/trust.js";
import { AWP } from "../profile/vocabulary.js";
import type { LedgerEntry as PaymentLedgerEntry } from "../settlement/ledger.js";
import type { LedgerEntry } from "../store/ledger.js";
import type { TrustBasis } from "../trust/resolver.js";
import type { TraceLinkedKind } from "./types.js";

export interface TraceLinkedInput {
  readonly dataset: DatasetCore;
  readonly root: string;
  readonly what: TraceLinkedKind;
}

export function memoryLink(fact: AdmittedFact | ContextItem): TraceLinkedInput {
  const dataset = new IndexedStore();
  const root = fact.id;
  const item = jointLogView(fact);
  const stored: ContextItem = {
    kind: "statement",
    accepted: true,
    ...item,
    digest: fact.digest ?? digestOf(fact),
  };
  writeMemoryFact(stored, "MemoryItem", root, dataset, writePolicy(dataset));
  return { what: "memory-item", root, dataset };
}

export function recordLink(entry: LedgerEntry): TraceLinkedInput {
  return {
    what: "record-entry",
    root: recordGraphIri(entry.hash),
    dataset: recordEntryDataset(entry),
  };
}

export function paymentTransferLink(entry: Readonly<PaymentLedgerEntry>): TraceLinkedInput {
  const dataset = new IndexedStore();
  const root = recordGraphIri(entry.digest);
  NamedValuesNode.from({ ...entry }, root, dataset);
  return { what: "record-entry", root, dataset };
}

export function termsLinks(
  enabled: boolean | undefined,
  terms: ItemTerms | undefined,
): { linkedInputs?: readonly TraceLinkedInput[] } {
  if (!enabled || !terms?.policy) return {};
  const policy = jointLogView(terms.policy);
  return {
    linkedInputs: [
      { what: "policy", root: policySubject(policy.id), dataset: policyDataset(policy) },
    ],
  };
}

export function trustLinks(
  basis: TrustBasis,
  owner: string,
  policy: boolean,
): readonly TraceLinkedInput[] {
  if ("claimTypes" in basis && "source" in basis) {
    // Show only the rule the answer rests on. The enclosing store identifies its owner.
    const dataset = trustDataset({ version: 1, owner, keys: [], sourceAuthority: [basis] });
    const [graph] = dataset.getGraphs(null, null, null);
    if (!graph) throw new Error("Missing trust store graph");
    const root = graph.value;
    const [rule] = dataset.getObjects(null, `${AWP}sourceAuthorityRule`, null);
    return [
      ...(policy && rule?.termType === "NamedNode"
        ? [{ what: "policy" as const, root: rule.value, dataset }]
        : []),
      { what: "trust-entry", root, dataset },
    ];
  }
  const dataset = new IndexedStore();
  if ("id" in basis) {
    makeNode("RegisterEntry", basis, basis.id, dataset);
    return [{ what: "trust-entry", root: basis.id, dataset }];
  }
  // Scenario own-list entries can also carry purposes for identity pins.
  const { party, tasks, block, note, expiresAt } = basis;
  const entry = { party, tasks, block, note, expiresAt };
  const root = scopedId(owner, digestOf(entry));
  makeNode("OwnListEntry", entry, root, dataset);
  return [{ what: "trust-entry", root, dataset }];
}
