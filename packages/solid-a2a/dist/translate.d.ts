import type { IntentResult, StructuredIntentDraft, TranslateFn } from "./types.js";
/** Options for {@link parseIntent}. */
export interface ParseIntentOptions {
    /**
     * The INJECTED translation seam — the consumer's own LLM. Called ONLY when the
     * deterministic path fails to classify the input. The package never calls a
     * model itself; this fn is the only translator. See {@link TranslateFn}.
     */
    readonly translate?: TranslateFn;
    /**
     * Base IRI under which to mint the intent node's IRI (e.g. the pod / agent
     * origin). Defaults to `urn:a2a:intent:` so an intent always has a stable id
     * even with no base supplied.
     */
    readonly baseIRI?: string;
    /**
     * A vocabulary hint passed through to the injected {@link TranslateFn} (the
     * package does not interpret it). Optional.
     */
    readonly vocabularyHint?: string;
    /**
     * The SHACL request shape (Turtle) passed through to the injected
     * {@link TranslateFn} so the model can target it. Optional.
     */
    readonly shape?: string;
}
/**
 * Parse a natural-language request into a structured RDF intent.
 *
 * 1. Try the deterministic rule/template path (the common verbs — no model).
 * 2. If it cannot classify AND `options.translate` is supplied, call that seam
 *    and LOWER its structured draft to RDF.
 * 3. Otherwise return an UNRESOLVED result (not a throw) — ordinary "couldn't
 *    parse" is a normal outcome.
 *
 * @param nl - the natural-language request.
 */
export declare function parseIntent(nl: string, options?: ParseIntentOptions): Promise<IntentResult>;
/**
 * The deterministic verb classifier. Maps the common intent verbs (+ synonyms,
 * case-insensitive) to a structured draft, extracting an IRI target, grant
 * recipient/modes and simple `key=value` parameters from the text. Returns
 * `undefined` when no verb matches (→ the injected-translate fallback).
 */
export declare function classifyDeterministic(nl: string): StructuredIntentDraft | undefined;
//# sourceMappingURL=translate.d.ts.map