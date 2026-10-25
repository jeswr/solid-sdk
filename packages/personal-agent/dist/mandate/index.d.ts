/** The autonomy-mandate module — ODRL policy + signed-credential enforcement (§5/§7). */
export { type DefaultMandateOptions, defaultAutonomyPolicy, withAutonomousScheduling, } from "./default-mandate.js";
export { buildRequestContext, type EvaluateAutonomyOptions, evaluateAutonomy, } from "./evaluate.js";
export { createSolidVcMandateVerifier, type SolidVcMandateVerifierOptions, } from "./solid-vc-verifier.js";
export type { AutonomyDecision, AutonomyEvaluation, LoadedMandate, MandateVerifier, } from "./types.js";
//# sourceMappingURL=index.d.ts.map