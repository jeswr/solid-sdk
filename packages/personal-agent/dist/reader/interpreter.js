// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The Reader's §5 interpreter chain: DETERMINISTIC METADATA FIRST, LLM LAST. Composes the
 * bridge's own interpreters (never re-implemented):
 *
 *  1. `structuredMetadataInterpreter` — Rule 1: embedded schema.org JSON-LD +
 *     `text/calendar` VEVENTs + a peer's `AgenticReply`, parsed by fixed code at
 *     confidence 1.0, zero LLM tokens, zero prompt-injection surface;
 *  2. `deterministicInterpreter` — textual meeting-times / relative-dates / yes-no;
 *  3. the optional injected LLM interpreter — ONLY the residual unstructured prose,
 *     entering at LLM-grade confidence and facing the reliability gates.
 *
 * `composeInterpreters` runs them in order under a shared cap. The LLM is the ratchet's
 * bootstrap, not its steady state.
 */
import { deterministicInterpreter, metadata } from "@jeswr/agentic-legacy-bridge";
/** Build the deterministic-first (LLM-last) interpreter for the Reader pipeline. */
export function buildReaderInterpreter(options = {}) {
    const chain = [metadata.structuredMetadataInterpreter, deterministicInterpreter];
    if (options.llm)
        chain.push(options.llm);
    return metadata.composeInterpreters(...chain);
}
//# sourceMappingURL=interpreter.js.map