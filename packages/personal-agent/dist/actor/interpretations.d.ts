import type { DatasetCore } from "@rdfjs/types";
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
export declare function readInterpretations(store: DatasetCore): ReadInterpretation[];
/** Read the raw-message anchor, channel, and sender reply address from a graph. */
export declare function readInboundContext(store: DatasetCore): InboundContext;
/** True iff the interpretation is a DETERMINISTIC one (the zero-LLM autonomous signal). */
export declare function isDeterministic(interp: ReadInterpretation): boolean;
//# sourceMappingURL=interpretations.d.ts.map