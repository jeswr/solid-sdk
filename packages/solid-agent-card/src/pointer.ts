// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// buildAgentPointer(...) — emit the person→agent pointer triple a WebID profile
// publishes ("the README points to an agent", roadmap M1). The triple links the
// person (the WebID subject) to the agent that represents them, via a STANDARD
// predicate (interop:hasAuthorizationAgent by default — the SAI "agent that
// represents you" — or schema:agent for industry reach). Built through the typed
// wrapper write path, serialised via n3.Writer. Never a hand-built triple.

import type { Quad } from "@rdfjs/types";
import { serialize } from "./serialize.js";
import { HAS_AUTHORIZATION_AGENT, SCHEMA_AGENT } from "./vocab.js";
import { PointerBuilder } from "./wrappers.js";

/** Which standard predicate to use for the person→agent link. */
export type PointerPredicate = "interop:hasAuthorizationAgent" | "schema:agent";

/** Options for {@link buildAgentPointer}. */
export interface AgentPointerOptions {
  /**
   * The predicate to link the person to their agent. Defaults to
   * `interop:hasAuthorizationAgent` (the SAI "agent that represents you"). Use
   * `schema:agent` for the broader schema.org link, or pass both via
   * {@link buildAgentPointer}'s array form.
   */
  readonly predicate?: PointerPredicate;
}

const PREDICATE_IRI: Record<PointerPredicate, string> = {
  "interop:hasAuthorizationAgent": HAS_AUTHORIZATION_AGENT,
  "schema:agent": SCHEMA_AGENT,
};

/** The output of {@link buildAgentPointer}. */
export interface AgentPointerDocument {
  /** The constructed pointer quad(s). */
  readonly quads: readonly Quad[];
  /** Serialise to Turtle (default) or another n3 format. */
  toString(format?: string): Promise<string>;
}

/**
 * Build the person→agent pointer triple(s) to add to `webId`'s profile.
 *
 * @param webId - the person's WebID (the subject of the pointer).
 * @param agent - the agent IRI the profile should point to.
 * @param predicates - one predicate (default `interop:hasAuthorizationAgent`) or
 *   an array to emit several pointer predicates at once (e.g. both the SAI and
 *   the schema.org link, for maximum reach).
 * @returns the quad(s) + a Turtle serialiser. The caller PATCHes/PUTs these into
 *   the profile document (M1 client-side; no server change).
 */
export function buildAgentPointer(
  webId: string,
  agent: string,
  predicates: PointerPredicate | readonly PointerPredicate[] = "interop:hasAuthorizationAgent",
): AgentPointerDocument {
  if (!webId) {
    throw new TypeError("buildAgentPointer: webId is required.");
  }
  if (!agent) {
    throw new TypeError("buildAgentPointer: agent IRI is required.");
  }

  const list = Array.isArray(predicates) ? predicates : [predicates as PointerPredicate];
  if (list.length === 0) {
    throw new TypeError("buildAgentPointer: at least one predicate is required.");
  }

  const builder = new PointerBuilder();
  // De-dupe predicates so passing the same one twice does not emit a dup triple.
  for (const predicate of new Set<PointerPredicate>(list)) {
    builder.link(webId, agent, PREDICATE_IRI[predicate]);
  }

  const quads = builder.quads();
  return {
    quads,
    toString: (format?: string) => serialize(quads, format),
  };
}
