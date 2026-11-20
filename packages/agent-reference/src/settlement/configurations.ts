// AUTHORED-BY Codex GPT-6

import type { ScenarioConfiguration } from "../engine/matrix.js";
import { alternativeWireId } from "../profile/configurations.js";
import { BASELINE } from "../suites/baseline.js";
import type { Configuration } from "../suites/registry.js";
import { type ProtocolSuiteId, SETTLEMENT_PROFILES } from "./profiles.js";
import { RdfOrderSuite } from "./rdf-order.js";
import type { SettlementSuite } from "./types.js";

/** Executable single-layer alternatives; the engine installs their authenticated host profiles. */
export const SETTLEMENT_CONFIGURATIONS = (
  Object.keys(SETTLEMENT_PROFILES) as ProtocolSuiteId[]
).map((suite) => {
  const id = `settlement-${suite}`;
  const configuration: Configuration = {
    id,
    pilotConfiguration: alternativeWireId(id),
    layers: { ...BASELINE.layers, settlement: suite },
  };
  const scenario = { id, change: { settlement: suite }, world: {} } as ScenarioConfiguration;
  return {
    configuration,
    scenario,
    runtime: "executable" as const,
  };
});

/** Host-installed adapters are selected explicitly; an unavailable choice never falls back. */
export function selectedSettlement(id = "rdf-order", installed?: SettlementSuite): SettlementSuite {
  if (installed?.id === id) return installed;
  if (id === "rdf-order") return new RdfOrderSuite();
  throw new TypeError(`No settlement adapter installed for ${id}`);
}
