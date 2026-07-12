import type { Quad } from "@rdfjs/types";
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
export declare function buildAgentPointer(webId: string, agent: string, predicates?: PointerPredicate | readonly PointerPredicate[]): AgentPointerDocument;
//# sourceMappingURL=pointer.d.ts.map