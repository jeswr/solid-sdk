// AUTHORED-BY Codex GPT-6
/** Trusted evidence used by symbolic containment proofs. */
export type { ProofContext } from "./policy.js";
/** Effective resource/member policies and bounded, never-widen implication proofs. */
export {
  assertNotWider,
  effectiveMembers,
  effectivePolicy,
  emptyPolicy,
  ownerPolicy,
  policiesEqual,
  scopePolicy,
  unionPolicies,
} from "./policy.js";
export type { AcpDialect } from "./systems/acp.js";
/** ACP reader/writer with separate source and existing-target interpretations. */
export { isPolicyTooComplex, readAcp, writeAcp } from "./systems/acp.js";
/** WAC reader/writer with explicit CSS/NSS implementation handling. */
export { readWac, writeWac } from "./systems/wac.js";
export type { TranslationContext } from "./translation.js";
/** Pure policy translation; reports every omitted or conservatively narrowed construct. */
export { reportItem, translatePolicy } from "./translation.js";
/** Neutral model, reports and caller-selected narrowing decisions. */
export type * from "./types.js";
