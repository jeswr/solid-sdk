// AUTHORED-BY Codex GPT-6.1-Sol
/** Browser-safe mandate verification and policy evaluation entry point. */
export { parseMandateCredential } from "./document.js";
export { createVcMandateVerifier } from "./mandate.js";
export { createPodMandateVerifier, type PodMandateOptions } from "./pod.js";
export { evaluateIntent, solidOdrlEngine } from "./policy.js";
export { autonomousTargets } from "./scope.js";
export { AGENT } from "./types.js";
