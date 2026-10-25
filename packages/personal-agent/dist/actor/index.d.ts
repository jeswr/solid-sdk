/** The Actor — deterministic-first proposal derivation + the fail-closed §3.3 SDK loop. */
export { type ClaudeActor, type CreateClaudeActorOptions, createClaudeActor, } from "./claude-actor.js";
export { type DeriveContext, deriveProposals } from "./derive.js";
export { createGate, type Gate, type GateConfig, type GateDecision, POD_READ_TOOLS, PROPOSAL_WRITE_TOOL, } from "./gate.js";
export { type InboundContext, isDeterministic, type ReadInterpretation, readInboundContext, readInterpretations, } from "./interpretations.js";
export { type ActorOptions, type BuildActorOptionsConfig, buildActorOptions, DENIED_TOOLS, } from "./options.js";
export { type RunActorOptions, type RunActorResult, runActorOnce } from "./run.js";
//# sourceMappingURL=index.d.ts.map