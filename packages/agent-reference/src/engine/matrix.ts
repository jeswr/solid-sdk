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

/**
 * Brief 31 §2.9: the one same-layer configuration this one extends, if it names one. The
 * extended configuration may not itself extend another, and an extending configuration
 * takes its prerequisite from the configuration it extends.
 */
export function matrixExtended(
  scenario: Pick<Scenario, "configurations">,
  entry: ScenarioConfiguration,
): ScenarioConfiguration | undefined {
  if (!entry.extends) return undefined;
  const extended = scenario.configurations.find((c) => c.id === entry.extends);
  if (!extended) throw new Error(`${entry.id}: unknown extended configuration ${entry.extends}`);
  if (extended.extends || extended.id === entry.id)
    throw new Error(`${entry.id}: an extended configuration may not itself extend another`);
  if (Object.keys(extended.change)[0] !== Object.keys(entry.change)[0])
    throw new Error(`${entry.id}: a configuration may extend only one of the same layer`);
  if (entry.requires)
    throw new Error(
      `${entry.id}: an extending configuration takes the extended one's prerequisite`,
    );
  return extended;
}

/** Brief 31 §1: a configuration's single admitted prerequisite, if it names one. */
export function matrixPrerequisite(
  scenario: Pick<Scenario, "configurations">,
  entry: ScenarioConfiguration,
): ScenarioConfiguration | undefined {
  const extended = matrixExtended(scenario, entry);
  if (extended) return matrixPrerequisite(scenario, extended);
  if (!entry.requires) return undefined;
  const prerequisite = scenario.configurations.find((c) => c.id === entry.requires);
  if (!prerequisite) throw new Error(`${entry.id}: unknown prerequisite ${entry.requires}`);
  if (prerequisite.requires || prerequisite.extends || prerequisite.id === entry.id)
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
  const reference = matrixReferenceWorld(scenario, entry);
  const prerequisite = matrixPrerequisite(scenario, entry);
  const extended = matrixExtended(scenario, entry);
  const advertised = {
    ...reference,
    parties: reference.parties.map((party) => ({
      ...party,
      // A prerequisite's added parties are not yet parsed, so their default list is absent.
      configurations: (party.configurations ?? []).map((id) =>
        id === "baseline" || id === prerequisite?.id || id === extended?.id ? entry.id : id,
      ),
    })),
  };
  const world = patch(advertised, entry.world);
  const problem = addedStepProblem(reference.script, world.script, entry);
  if (problem) throw new Error(`${entry.id}: ${problem}`);
  return world;
}

/**
 * The world a configuration's own patch applies to: the extended configuration's full world
 * (brief 31 §2.9), else the prerequisite's world, else the scenario.
 */
export function matrixReferenceWorld(scenario: Scenario, entry: ScenarioConfiguration): Scenario {
  const extended = matrixExtended(scenario, entry);
  if (extended) return matrixWorld(scenario, extended);
  const prerequisite = matrixPrerequisite(scenario, entry);
  return prerequisite ? patch(scenario, prerequisite.world) : scenario;
}

/** The profile entries a configuration runs with, in order: prerequisite, extended, own. */
export function matrixProfileChanges(
  scenario: Pick<Scenario, "configurations">,
  entry: ScenarioConfiguration,
): unknown[] {
  return [
    matrixPrerequisite(scenario, entry)?.profileChange,
    matrixExtended(scenario, entry)?.profileChange,
    entry.profileChange,
  ].filter((change) => change !== undefined);
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
    observePayloads: sink.observePayloads,
    linked: sink.linked,
    emit(input, payload) {
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
      if (!configuration.id.startsWith("transport-")) return sink.emit(event, payload);
      const raw = event.packet?.layers.header.raw as { configuration?: string } | undefined;
      if (!event.packet || !raw?.configuration) return sink.emit(event, payload);
      const suite =
        raw.configuration === configuration.pilotConfiguration
          ? configuration.layers.transport
          : "direct-http";
      sink.emit(
        {
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
        },
        payload,
      );
    },
  };
}
