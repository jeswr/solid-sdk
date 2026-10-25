// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/** The Actor — deterministic-first proposal derivation + the fail-closed §3.3 SDK loop. */
export { createClaudeActor, } from "./claude-actor.js";
export { deriveProposals } from "./derive.js";
export { createGate, POD_READ_TOOLS, PROPOSAL_WRITE_TOOL, } from "./gate.js";
export { isDeterministic, readInboundContext, readInterpretations, } from "./interpretations.js";
export { buildActorOptions, DENIED_TOOLS, } from "./options.js";
export { runActorOnce } from "./run.js";
//# sourceMappingURL=index.js.map