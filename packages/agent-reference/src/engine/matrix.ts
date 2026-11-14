// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5

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
  prerequisite?: ScenarioConfiguration,
): Configuration {
  const [layer, suite] = Object.entries(entry.change)[0] as [LayerId, string];
  if (suite === BASELINE.layers[layer])
    throw new Error("a configuration must change one baseline suite");
  const configuration = {
    id: entry.id,
    layers: { ...BASELINE.layers, ...prerequisite?.change, [layer]: suite },
    pilotConfiguration: alternativeWireId(entry.id),
  };
  return registry.configure(configuration);
}

/** Brief 31 §1: a configuration's single admitted prerequisite, if it names one. */
export function matrixPrerequisite(
  scenario: Pick<Scenario, "configurations">,
  entry: ScenarioConfiguration,
): ScenarioConfiguration | undefined {
  if (!entry.requires) return undefined;
  const prerequisite = scenario.configurations.find((c) => c.id === entry.requires);
  if (!prerequisite) throw new Error(`${entry.id}: unknown prerequisite ${entry.requires}`);
  if (prerequisite.requires || prerequisite.id === entry.id)
    throw new Error(`${entry.id}: only one prerequisite configuration is admitted`);
  if (Object.keys(prerequisite.change)[0] === Object.keys(entry.change)[0])
    throw new Error(`${entry.id}: a prerequisite must change a different layer`);
  return prerequisite;
}

/**
 * The same literal patch as a branch: arrays replace; objects merge. With `requires`, the
 * prerequisite's patch applies first. A patch may add script steps only inside a declared
 * added segment (brief 31 §1); transport configurations may add none.
 */
export function matrixWorld(scenario: Scenario, entry: ScenarioConfiguration): Scenario {
  const prerequisite = matrixPrerequisite(scenario, entry);
  const reference = prerequisite ? patch(scenario, prerequisite.world) : scenario;
  const advertised = {
    ...reference,
    parties: reference.parties.map((party) => ({
      ...party,
      // A prerequisite's added parties are not yet parsed, so their default list is absent.
      configurations: (party.configurations ?? []).map((id) =>
        id === "baseline" || id === prerequisite?.id ? entry.id : id,
      ),
    })),
  };
  const world = patch(advertised, entry.world);
  const problem = addedStepProblem(reference.script, world.script, entry);
  if (problem) throw new Error(`${entry.id}: ${problem}`);
  return world;
}

/** Where a patched script adds a step outside an added segment, or opens one wrongly. */
export function addedStepProblem(
  reference: readonly Pick<Scenario["script"][number], "id" | "segment" | "segmentEnd">[],
  script: readonly Scenario["script"][number][],
  entry: Pick<ScenarioConfiguration, "id" | "change">,
): string | undefined {
  const known = new Set(reference.map((step) => step.id));
  const transport = "transport" in entry.change;
  let open: string | undefined;
  for (const step of script) {
    // A reference step with unchanged marks, a prerequisite's own added segment included,
    // is part of the reference.
    const before = reference.find((candidate) => candidate.id === step.id);
    if (before && !open && step.segment === before.segment && step.segmentEnd === before.segmentEnd)
      continue;
    if (step.segment === "added") {
      if (transport) return `transport configurations may not add exchanges (step ${step.id})`;
      if (open) return `added segment ${open} is still open at step ${step.id}`;
      open = step.id;
    }
    if (open && known.has(step.id)) return `baseline step ${step.id} lies inside an added segment`;
    if (!open && !known.has(step.id)) return `step ${step.id} is added outside an added segment`;
    if (step.segmentEnd === "added") {
      if (!open) return `step ${step.id} ends an added segment that was not opened`;
      open = undefined;
    }
  }
  return open ? `added segment ${open} is never closed` : undefined;
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
  if (configuration.id === "baseline") return sink;
  return {
    agent: sink.agent,
    emit(input) {
      // This generated step-up question contains an operation name, never exact proposed text.
      const event = input.chat?.text.startsWith("Before ")
        ? {
            ...input,
            chat: {
              ...input.chat,
              text: input.chat.text.replace(/(?:https?:\/\/|urn:|did:)[^\s<>"{}|\\^`]+/g, (id) =>
                name(id),
              ),
            },
          }
        : input;
      if (!configuration.id.startsWith("transport-")) return sink.emit(event);
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
