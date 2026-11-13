/**
 * The policy module the scenario harness uses for EVERY runtime it creates and every
 * enforcement point it builds (mandate decisions and data-use grant decisions alike).
 * Selected explicitly per run (`awp-pilot demo --policy-engine …`); undefined means the
 * runtime's own default (solid-odrl). Harness-only state: agents run through the CLI use the
 * module recorded in their directory instead (`policy-config.ts`).
 */
import type { PolicyEngine } from "../mechanisms/policy-engine.js";

let selected: PolicyEngine | undefined;

/** Select the module for subsequent scenario runs (undefined restores the default). */
export function useScenarioPolicyEngine(engine: PolicyEngine | undefined): void {
  selected = engine;
}

export function scenarioPolicyEngine(): PolicyEngine | undefined {
  return selected;
}
