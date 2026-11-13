// AUTHORED-BY Codex GPT-6

import { alternativeWireId, CONFIG_PUBLIC } from "../profile/configurations.js";
import { BASELINE } from "../suites/baseline.js";
import type { Configuration, LayerId, SuiteRegistry } from "../suites/registry.js";
import type { TraceSink } from "../trace/recorder.js";
import { patch } from "./run.js";
import type { Scenario } from "./schema.js";

export type ScenarioConfiguration = Scenario["configurations"][number];
export function matrixConfiguration(
  entry: ScenarioConfiguration,
  registry: SuiteRegistry,
): Configuration {
  const [layer, suite] = Object.entries(entry.change)[0] as [LayerId, string];
  if (suite === BASELINE.layers[layer])
    throw new Error("a configuration must change one baseline suite");
  const configuration = {
    id: entry.id,
    layers: { ...BASELINE.layers, [layer]: suite },
    pilotConfiguration: alternativeWireId(entry.id),
  };
  return registry.configure(configuration);
}

/** The same literal patch as a branch: arrays replace; objects merge. */
export function matrixWorld(scenario: Scenario, entry: ScenarioConfiguration): Scenario {
  const advertised = {
    ...scenario,
    parties: scenario.parties.map((party) => ({
      ...party,
      configurations: party.configurations.map((id) => (id === "baseline" ? entry.id : id)),
    })),
  };
  return patch(advertised, entry.world);
}
export function advertisedConfigurations(
  ids: readonly string[],
  configuration: Configuration,
): string[] {
  return ids.map((id) =>
    id === "public-read"
      ? CONFIG_PUBLIC
      : id === "baseline"
        ? configuration.id.endsWith("-local")
          ? configuration.pilotConfiguration
          : BASELINE.pilotConfiguration
        : id === configuration.id
          ? configuration.pilotConfiguration
          : alternativeWireId(id),
  );
}
export function preferredConfiguration(
  agent: Scenario["parties"][number],
  peer: Scenario["parties"][number],
  configuration: Configuration,
): string {
  const own = advertisedConfigurations(agent.configurations, configuration);
  const theirs = advertisedConfigurations(peer.configurations, configuration);
  return own.find((id) => theirs.includes(id)) ?? configuration.pilotConfiguration;
}

/** Trace each hop's actual carriage, including unchanged public reads and bank calls. */
export function matrixSink(
  sink: TraceSink,
  configuration: Configuration,
  name: (id: string | undefined) => string,
): TraceSink {
  if (configuration.id === "baseline" || !configuration.id.startsWith("transport-")) return sink;
  return {
    agent: sink.agent,
    emit(input) {
      // This generated step-up question contains an operation name, never exact proposed text.
      const event = input.chat?.text.startsWith("Before ")
        ? {
            ...input,
            chat: {
              ...input.chat,
              text: input.chat.text.replace(/(?:https?:\/\/|urn:)[^\s<>"{}|\\^`]+/g, (id) =>
                name(id),
              ),
            },
          }
        : input;
      const raw = event.packet?.layers.header.raw as { configuration?: string } | undefined;
      if (!event.packet || !raw?.configuration) return sink.emit(event);
      const suite =
        raw.configuration === configuration.pilotConfiguration
          ? configuration.layers.transport
          : "direct-http";
      sink.emit({
        ...event,
        packet: {
          ...event.packet,
          carriage: {
            suite,
            summary:
              suite === "direct-http"
                ? "Signed bytes passed directly in process."
                : `${suite === "email" ? "Email" : suite.toUpperCase()} carries the signed bytes in process.`,
          },
        },
      });
    },
  };
}
