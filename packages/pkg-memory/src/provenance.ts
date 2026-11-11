// AUTHORED-BY Codex GPT-6.1-Sol

import type { DatasetCore } from "@rdfjs/types";
import { pkgId } from "./ids.js";
import type { Nanopublication, Nanopublications, Source } from "./model.js";
import { graph, NS, RdfNode } from "./rdf.js";

/** A referenced source record, scoped to this nanopublication's batch. */
export interface SourceInfo {
  iri: string;
  kind?: Source["kind"];
  title?: string;
  threadId?: string;
  model?: string;
  created?: string;
  url?: string;
}
/** Read-only provenance projection. Message times/senders stay attached to their evidence. */
export interface FactProvenance {
  generatedAt: string;
  agent: { iri: string; label?: string };
  batch: string;
  attributedTo: string[];
  sources: SourceInfo[];
  evidence: {
    source: string;
    quote?: string;
    timestamp?: string;
    speaker?: string;
    locator?: string;
  }[];
}

function optional(node: RdfNode, predicate: string, kinds: readonly string[]): string | undefined {
  const terms = [...node.terms(predicate)];
  if (terms.length === 0) return undefined;
  const term = terms[0];
  if (
    terms.length !== 1 ||
    !term ||
    !kinds.includes(term.termType === "Literal" ? term.datatype.value : term.termType)
  )
    throw new Error("Invalid provenance field");
  return term.value;
}
const text = (node: RdfNode, predicate: string) => optional(node, predicate, [`${NS.xsd}string`]);

/** Read only linked evidence and its batch source records; never scan unrelated graphs. */
export function readNanopubProvenance(
  value: Nanopublications,
  np: Nanopublication,
): FactProvenance {
  return readProvenance(graph(value.dataset, pkgId("batch", np.batch, "sources")), np);
}

/** Per-projection cache: batch graphs are copied once, with no stale global cache. */
export function createNanopubProvenanceReader(
  value: Nanopublications,
): (np: Nanopublication) => FactProvenance {
  const batches = new Map<string, DatasetCore>();
  return (np) => {
    let sources = batches.get(np.batch);
    if (!sources) {
      sources = graph(value.dataset, pkgId("batch", np.batch, "sources"));
      batches.set(np.batch, sources);
    }
    return readProvenance(sources, np);
  };
}
function readProvenance(sources: DatasetCore, np: Nanopublication): FactProvenance {
  const node = (id: string) => new RdfNode(id, sources);
  const records = new Map<string, SourceInfo>();
  const evidence = np.evidence.map((ev) => {
    const message = node(ev.source);
    const parent = optional(message, `${NS.schema}isPartOf`, ["NamedNode"]);
    const sourceId = parent ?? ev.source;
    const source = node(sourceId);
    const types = [...source.terms(`${NS.rdf}type`)].map((t) => t.value);
    const provider = text(source, `${NS.schema}provider`);
    let kind: SourceInfo["kind"];
    if (types.includes(`${NS.schema}Conversation`)) {
      if (provider === "OpenAI Codex") kind = "codex-thread";
      if (provider === "Claude Code") kind = "claude-session";
    } else if (types.includes(`${NS.schema}DigitalDocument`)) kind = "document";
    else if (types.includes(`${NS.schema}EmailMessage`)) kind = "email";
    records.set(sourceId, {
      iri: sourceId,
      kind,
      title: text(source, `${NS.schema}name`),
      threadId: text(source, `${NS.dcterms}identifier`),
      model: text(source, `${NS.schema}instrument`),
      created: optional(source, `${NS.schema}dateCreated`, [`${NS.xsd}date`, `${NS.xsd}dateTime`]),
      url: /^https?:/.test(sourceId) ? sourceId : undefined,
    });
    return {
      source: ev.source,
      quote: ev.quote,
      locator: ev.locator,
      timestamp: optional(message, `${NS.schema}dateSent`, [`${NS.xsd}dateTime`]),
      speaker: optional(message, `${NS.schema}sender`, ["NamedNode", `${NS.xsd}string`]),
    };
  });
  return {
    generatedAt: np.generatedAt,
    agent: { iri: np.agent, label: text(node(np.agent), `${NS.rdfs}label`) },
    batch: np.batch,
    attributedTo: [...np.attributedTo],
    sources: [...records.values()].sort((a, b) => a.iri.localeCompare(b.iri)),
    evidence,
  };
}
