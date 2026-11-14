// AUTHORED-BY Codex GPT-6
import type { ScenarioConfiguration } from "../engine/matrix.js";
import { alternativeWireId } from "../profile/configurations.js";
import { BASELINE } from "../suites/baseline.js";
import type { Configuration } from "../suites/registry.js";
import { type ProtocolSuiteId, SETTLEMENT_PROFILES } from "./profiles.js";

/** Reviewable declarations, deliberately not advertised as executable wire configurations.
 * Runtime installation requires changes to the other lane's outbound/ingress interfaces.
 */
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
    runtime: "blocked" as const,
    blockedBy:
      "OutboundGate.paymentOrder, engine invoice/provider dispatch and native receipt ingress construct or assume rdf-order; no adapter injection seam is installed.",
  };
});
