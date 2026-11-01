// AUTHORED-BY Codex GPT-6.1-Sol
import type { Effect, Mandate, MandateVerifier, PolicyEngine } from "./types.js";
/** Explicit in-memory verifier for executor tests; never verifies real credentials. */
export function memoryMandateVerifier(mandate: Mandate | undefined): MandateVerifier {
  return { load: async () => mandate };
}
/** Scripted policy effects by policy IRI, with indeterminate for an unscripted policy. */
export function scriptedPolicyEngine(effects: Readonly<Record<string, Effect>>): PolicyEngine {
  return {
    id: "test:scripted",
    evaluate: (policy) => ({ effect: effects[policy.id] ?? "indeterminate" }),
  };
}
