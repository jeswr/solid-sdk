// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Read the DETERMINISTIC structured metadata the Reader already landed (§5.1) — the Actor's
 * zero-LLM-tokens hot path. This walks the bridge's reified `agentic:Interpretation` graph
 * (produced by `addInterpretation`) and the raw-message anchor, using RDF/JS `.match()`
 * queries on a `parseRdf` result (never a bespoke parser). Only DETERMINISTIC, high-confidence
 * interpretations feed the Actor's autonomous proposals; residual prose is left for the LLM.
 */
import { normalizeEmailAddress, vocab } from "@jeswr/agentic-legacy-bridge";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory } from "n3";
import { firstIriOf, firstLiteralOf, objectsOf, subjectsOf } from "../pod/rdf-query.js";

const { namedNode } = DataFactory;

/** One reified interpretation read back from the pod. */
export interface ReadInterpretation {
  /** The interpretation node IRI. */
  readonly node: string;
  /** The reified statement's subject IRI. */
  readonly assertsSubject?: string;
  /** The reified statement's predicate IRI. */
  readonly assertsPredicate?: string;
  /** The reified statement's object IRI (when the object was an IRI). */
  readonly assertsObjectIri?: string;
  /** The reified statement's object literal value (when the object was a literal). */
  readonly assertsObjectLiteral?: string;
  /** The confidence in [0,1]. */
  readonly confidence: number;
  /** The interpretation method IRI (`agentic:Deterministic` / `…LlmInterpretation` / …). */
  readonly method?: string;
  /** The calibration IRI. */
  readonly calibration?: string;
  /** Security-bearing data can never drive an autonomous proposal. */
  readonly securityBearing?: boolean;
}

/** Context about the inbound message the interpretations derive from. */
export interface InboundContext {
  /** The raw-message anchor IRI (a `urn:agentic:raw:…`). */
  readonly rawAnchor?: string;
  /** The channel the message arrived on (`agentic:channel`). */
  readonly channel?: string;
  /** The sender's reply address (validated), when the graph carries one. */
  readonly senderEmail?: string;
}

/** Read every reified interpretation node from an inbound-message graph. */
export function readInterpretations(store: DatasetCore): ReadInterpretation[] {
  const out: ReadInterpretation[] = [];
  for (const subject of subjectsOf(
    store,
    vocab.RDF_TYPE,
    namedNode(vocab.AGENTIC_INTERPRETATION),
  )) {
    const node = subject.value;
    const confidenceRaw = firstLiteralOf(store, node, vocab.AGENTIC_CONFIDENCE);
    const confidence = confidenceRaw !== undefined ? Number(confidenceRaw) : Number.NaN;
    const record: ReadInterpretation = {
      node,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      securityBearing: objectsOf(store, node, vocab.AGENTIC_SECURITY_BEARING).some(
        (term) => term.termType !== "Literal" || (term.value !== "false" && term.value !== "0"),
      ),
      ...optional("assertsSubject", firstIriOf(store, node, vocab.AGENTIC_ASSERTS_SUBJECT)),
      ...optional("assertsPredicate", firstIriOf(store, node, vocab.AGENTIC_ASSERTS_PREDICATE)),
      ...optional("assertsObjectIri", firstIriOf(store, node, vocab.AGENTIC_ASSERTS_OBJECT_IRI)),
      ...optional(
        "assertsObjectLiteral",
        firstLiteralOf(store, node, vocab.AGENTIC_ASSERTS_OBJECT),
      ),
      ...optional("method", firstIriOf(store, node, vocab.AGENTIC_INTERPRETATION_METHOD)),
      ...optional("calibration", firstIriOf(store, node, vocab.AGENTIC_CALIBRATION)),
    };
    out.push(record);
  }
  return out;
}

function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

/** Read the raw-message anchor, channel, and sender reply address from a graph. */
export function readInboundContext(store: DatasetCore): InboundContext {
  const anchorTerm = subjectsOf(
    store,
    vocab.RDF_TYPE,
    namedNode(vocab.AGENTIC_RAW_INBOUND_MESSAGE),
  )[0];
  const rawAnchor = anchorTerm?.value;
  const channel = rawAnchor ? firstLiteralOf(store, rawAnchor, vocab.AGENTIC_CHANNEL) : undefined;
  // The sender address is written on the sender Person node as a `mailto:` NamedNode via
  // `schema:email` / `foaf:mbox` / `vcard:hasEmail` (a literal only for a non-mailto handle).
  const senderEmail = readSenderEmail(store);
  return {
    ...optional("rawAnchor", rawAnchor),
    ...optional("channel", channel),
    ...optional("senderEmail", senderEmail),
  };
}

/** Extract a validated sender reply address from the sender-Person email predicates. */
function readSenderEmail(store: DatasetCore): string | undefined {
  for (const predicate of [vocab.SCHEMA_EMAIL, vocab.FOAF_MBOX, vocab.VCARD_HAS_EMAIL]) {
    for (const q of store.match(null, namedNode(predicate), null, null)) {
      const obj = q.object;
      let candidate: string | undefined;
      if (obj.termType === "NamedNode" && obj.value.startsWith("mailto:")) {
        candidate = obj.value.slice("mailto:".length);
      } else if (obj.termType === "Literal") {
        candidate = obj.value;
      }
      const normalised = candidate ? normalizeEmailAddress(candidate) : undefined;
      if (normalised) return normalised;
    }
  }
  return undefined;
}

/** True iff the interpretation is a DETERMINISTIC one (the zero-LLM autonomous signal). */
export function isDeterministic(interp: ReadInterpretation): boolean {
  return interp.method === vocab.AGENTIC_DETERMINISTIC;
}
