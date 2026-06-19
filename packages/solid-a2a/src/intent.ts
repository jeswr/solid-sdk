// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The intent ↔ RDF lowering + round-trip. `intentToRdf` lowers a structured
// Intent to quads (via the typed wrapper write path — never hand-built triples);
// `intentToTurtle`/`intentToJsonLd` serialise; `intentFromRdf`/`parseIntentGraph`
// read an intent back from RDF (round-trip lossless on the intent fields). All RDF
// reads/writes go through src/wrappers.ts.

import { parseRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore, Quad } from "@rdfjs/types";
import { serialize } from "./serialize.js";
import type { Intent, IntentParameter } from "./types.js";
import {
  A2A_INLINE_CONTEXT,
  ACL_MODE_IRI,
  type AclMode,
  VALID_ACL_MODE_IRIS,
  VALID_INTENT_ACTIONS,
} from "./vocab.js";
import {
  actionKindOf,
  firstIri,
  firstLiteral,
  IntentBuilder,
  type IntentNode,
  wrapIntent,
} from "./wrappers.js";

/**
 * Lower a structured {@link Intent} to RDF quads (an `a2a:Intent` graph) through
 * the typed wrapper write path.
 */
export function intentToRdf(intent: Intent): Quad[] {
  const builder = new IntentBuilder();
  const node = builder.intent(intent.id);
  if (intent.agent !== undefined) {
    node.setAgent(intent.agent);
  }

  const action = node.linkAction(IntentBuilder.actionTypeIri(intent.action));
  // The verb's direct object/target IRI. A `list` intent's target is the
  // container — modelled with schema:target; everything else with schema:object.
  if (intent.target !== undefined) {
    if (intent.action === "list") {
      action.setTarget(intent.target);
    } else {
      action.setObject(intent.target);
    }
  }
  if (intent.recipient !== undefined) {
    action.setRecipient(intent.recipient);
  }
  if (intent.agent !== undefined) {
    action.setAgent(intent.agent);
  }
  for (const mode of intent.modes ?? []) {
    action.addMode(ACL_MODE_IRI[mode]);
  }

  for (const param of intent.parameters ?? []) {
    const p = node.linkParameter();
    p.setKey(param.key);
    p.setValue(param.value);
  }

  return builder.quads();
}

/** Serialise an intent to Turtle (default) or another n3 format. */
export function intentToTurtle(intent: Intent, format?: string): Promise<string> {
  return serialize(intentToRdf(intent), format);
}

/**
 * Build the JSON-LD document for an intent. A deterministic projection of the
 * SAME Intent (so it stays in lock-step with the RDF quads) with the pinned inline
 * `@context` — NOT a re-serialisation through a JSON-LD library (we own the exact
 * shape). A consumer parses it via `@jeswr/fetch-rdf` (which handles
 * `application/ld+json`) — see {@link parseIntentGraph}.
 */
export function intentToJsonLd(intent: Intent): Record<string, unknown> {
  const action: Record<string, unknown> = {
    "@type": actionTypeAlias(intent),
  };
  if (intent.target !== undefined) {
    if (intent.action === "list") {
      action.target = { "@id": intent.target };
    } else {
      action.object = { "@id": intent.target };
    }
  }
  if (intent.recipient !== undefined) {
    action.recipient = { "@id": intent.recipient };
  }
  if (intent.agent !== undefined) {
    action.agent = { "@id": intent.agent };
  }
  if (intent.modes && intent.modes.length > 0) {
    action.mode = intent.modes.map((m) => ({ "@id": ACL_MODE_IRI[m] }));
  }

  const doc: Record<string, unknown> = {
    "@context": A2A_INLINE_CONTEXT,
    "@id": intent.id,
    "@type": "Intent",
    action,
  };
  if (intent.agent !== undefined) {
    doc.agent = { "@id": intent.agent };
  }
  if (intent.parameters && intent.parameters.length > 0) {
    doc.parameter = intent.parameters.map((p) => ({
      "@type": "Parameter",
      paramKey: p.key,
      paramValue: p.value,
    }));
  }
  return doc;
}

/**
 * The action node's JSON-LD `@type` alias. The inline `@context` does not alias
 * the action subclasses (they are many), so emit the full IRI as the type — a
 * JSON-LD `@type` value that is an absolute IRI is valid and parses to the right
 * rdf:type. (The action subclass IRIs are the keys of {@link IRI_TO_ACTION}'s
 * reverse map; we read the IRI straight from the vocab via the builder.)
 */
function actionTypeAlias(intent: Intent): string {
  return IntentBuilder.actionTypeIri(intent.action);
}

/**
 * Read a structured {@link Intent} back from an already-parsed RDF dataset (the
 * round-trip read). Returns the FIRST well-formed `a2a:Intent` found, or
 * `undefined` if there is none / it lacks a recognised action.
 */
export function intentFromRdf(dataset: DatasetCore): Intent | undefined {
  const intents = wrapIntent(dataset).intents();
  for (const node of intents) {
    const intent = projectIntent(node);
    if (intent !== undefined) {
      return intent;
    }
  }
  return undefined;
}

/**
 * Parse an intent from a Turtle/JSON-LD string (or an already-parsed dataset).
 * Convenience over {@link intentFromRdf} that does the parse via `@jeswr/fetch-rdf`
 * (the sanctioned parser — never a bespoke one).
 *
 * @param input - Turtle/JSON-LD text, or a parsed `DatasetCore`.
 * @param contentType - media type when `input` is text (default `text/turtle`).
 * @param baseIRI - base IRI for relative IRIs when parsing text.
 */
export async function parseIntentGraph(
  input: string | DatasetCore,
  contentType = "text/turtle",
  baseIRI?: string,
): Promise<Intent | undefined> {
  const dataset =
    typeof input === "string"
      ? await parseRdf(input, contentType, baseIRI ? { baseIRI } : {})
      : input;
  return intentFromRdf(dataset);
}

/** Project an {@link IntentNode} to a plain {@link Intent}, or `undefined` if malformed. */
function projectIntent(node: IntentNode): Intent | undefined {
  const actions = [...node.actions];
  const action = actions[0];
  if (action === undefined) {
    return undefined;
  }
  const kind = actionKindOf(action);
  if (kind === undefined || !VALID_INTENT_ACTIONS.has(kind)) {
    return undefined;
  }

  // The target is schema:target for a list (the container) else schema:object.
  const target = kind === "list" ? firstIri(action.targets) : firstIri(action.objects);
  const recipient = firstIri(action.recipients);
  // Prefer the action's agent; fall back to the intent-node-level agent.
  const agent = firstIri(action.agents) ?? firstIri(node.agents);

  const modes: AclMode[] = [];
  for (const m of action.modes) {
    if (m.termType === "NamedNode" && VALID_ACL_MODE_IRIS.has(m.value)) {
      modes.push(aclModeFromIri(m.value));
    }
  }

  const parameters: IntentParameter[] = [];
  for (const p of node.parameters) {
    const key = firstLiteral(p.keys);
    const value = firstLiteral(p.values);
    if (key !== undefined && value !== undefined) {
      parameters.push({ key, value });
    }
  }

  return {
    id: node.value,
    action: kind,
    ...(target !== undefined && { target }),
    ...(agent !== undefined && { agent }),
    ...(recipient !== undefined && { recipient }),
    ...(modes.length > 0 && { modes }),
    ...(parameters.length > 0 && { parameters }),
  };
}

/** Map an acl: mode IRI to its short name (the reverse of ACL_MODE_IRI). */
function aclModeFromIri(iri: string): AclMode {
  for (const [name, modeIri] of Object.entries(ACL_MODE_IRI)) {
    if (modeIri === iri) {
      return name as AclMode;
    }
  }
  // Unreachable — caller pre-checks VALID_ACL_MODE_IRIS.
  return "Read";
}
