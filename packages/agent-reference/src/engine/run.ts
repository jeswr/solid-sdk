// AUTHORED-BY Codex GPT-6.1-Sol
/** A scripted core supplies proposals; only AgentRuntime and the real gates emit events. */
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readdirSync, readFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { canonicalJson } from "../core/canonical.js";
import type { Json } from "../core/types.js";
import type { GateContext } from "../gates/common.js";
import { type OwnerMandate, signMandate } from "../mechanisms/mandate.js";
import { signStatement } from "../mechanisms/statements.js";
import { TrustStore } from "../mechanisms/trust.js";
import { idSource, testKey } from "../reference/keys.js";
import type { AgentRuntime } from "../runtime/agent.js";
import type { OperationHandler } from "../runtime/operations.js";
import { Cast } from "../scenarios/common.js";
import { baselineRegistry } from "../suites/baseline.js";
import { withPublicRead } from "../suites/public-read.js";
import type { Configuration } from "../suites/registry.js";
import { TraceRecorder } from "../trace/recorder.js";
import { outlineOf, TRACE_SCHEMA, type TraceFile } from "../trace/types.js";
import { type OwnListEntry, TrustResolver, type TrustRoot } from "../trust/resolver.js";
import { type DomainProfile, profileSchema, type Scenario, validateScenario } from "./schema.js";

export const DATA_ROOT = join(import.meta.dirname, "../..");
export function scenarioIds(root = DATA_ROOT): string[] {
  return readdirSync(join(root, "scenarios"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
}
function readData(root: string, directory: string, id: string): unknown {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error("invalid data identifier");
  return JSON.parse(readFileSync(join(root, directory, `${id}.json`), "utf8"));
}
export function loadScenario(id: string, root = DATA_ROOT): Scenario {
  return validateScenario(readData(root, "scenarios", id));
}
export function loadProfile(id: string, root = DATA_ROOT): DomainProfile {
  return profileSchema.parse(readData(root, "profiles", id));
}

/** JSON pointer changes are restricted to the world and script, never the expected verdicts. */
export function applyChanges(
  scenario: Scenario,
  changes: readonly { path: string; value: Json }[],
): Scenario {
  const copy = structuredClone(scenario);
  for (const change of changes) {
    const path = change.path
      .slice(1)
      .split("/")
      .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
    if (
      !["script", "core", "statements", "trust", "mandates", "settings", "inject"].includes(
        path[0] ?? "",
      ) ||
      path.some((p) => ["__proto__", "prototype", "constructor"].includes(p))
    )
      throw new Error("invalid scenario change path");
    let target: unknown = copy;
    for (const key of path.slice(0, -1)) {
      if (!target || typeof target !== "object" || !Object.hasOwn(target, key))
        throw new Error(`unknown change path ${change.path}`);
      target = (target as Record<string, unknown>)[key];
    }
    const key = path.at(-1);
    if (!key || !target || typeof target !== "object" || !Object.hasOwn(target, key))
      throw new Error(`unknown change path ${change.path}`);
    (target as Record<string, unknown>)[key] = structuredClone(change.value);
  }
  return validateScenario(copy);
}
function getPath(value: unknown, path: string): unknown {
  for (const p of path.split(".")) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, p))
      throw new Error(`unresolved script reference ${path}`);
    value = (value as Record<string, unknown>)[p];
  }
  return value;
}

export interface RunOptions {
  commit?: string;
  configuration?: Configuration;
}
export async function runScenario(
  profileInput: DomainProfile,
  scenarioInput: Scenario,
  opts: RunOptions = {},
): Promise<TraceFile> {
  const profile = profileSchema.parse(profileInput);
  const scenario = validateScenario(scenarioInput);
  if (profile.id !== scenario.profile) throw new Error("scenario/profile mismatch");
  const registry = withPublicRead(baselineRegistry());
  const configuration = opts.configuration ?? scenario.configuration;
  for (const c of [
    configuration,
    ...Object.values(scenario.settings).flatMap((s) => [
      s.configuration,
      ...Object.values(s.configurations ?? {}),
    ]),
  ])
    if (registry.check(c).length) throw new Error(`configuration ${c.id} is not runnable here`);
  let time = Date.parse(scenario.start);
  const now = () => new Date(time);
  const recorder = new TraceRecorder();
  recorder.label(
    (agent, event, step) =>
      scenario.stepLabels.find(
        (l) => l.step === step && l.agent === agent && l.parts.includes(event.part),
      )?.to ?? step,
  );
  const cast = new Cast(now, {
    keys: async (name) => ({
      owner: await testKey(`${name}/owner`),
      actor: await testKey(`${name}/actor`),
    }),
    ids: idSource(scenario.ids),
  });
  for (const p of scenario.parties.filter((p) => p.runs === "agent")) {
    if (!p.identity) throw new Error(`missing identity ${p.id}`);
    await cast.add(
      p.identity,
      () => scenario.mandates[p.id] as unknown as OwnerMandate,
      p.representationOperations ?? [],
    );
  }
  const statements = new Map<string, string>();
  for (const statement of scenario.statements) {
    if (!scenario.parties.some((p) => p.key === statement.key))
      throw new Error(`unlisted issuer ${statement.key}`);
    statements.set(
      statement.id,
      await signStatement(await testKey(statement.key), statement.typ, statement.value),
    );
  }
  const results: Record<string, unknown> = {};
  const render = (value: Json, context?: unknown): unknown => {
    if (Array.isArray(value)) return value.map((v) => render(v, context));
    if (!value || typeof value !== "object") return value;
    if (typeof value.$ref === "string") return getPath(results, value.$ref);
    if (typeof value.$context === "string") return getPath(context, value.$context);
    if (typeof value.$statement === "string") {
      const jws = statements.get(value.$statement);
      if (!jws) throw new Error(`unknown statement ${value.$statement}`);
      return jws;
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, render(v, context)]));
  };
  const runtimes = new Map<string, Awaited<ReturnType<Cast["runtime"]>>>();
  for (const p of scenario.parties.filter((p) => p.runs === "agent")) {
    const own = scenario.trust[p.id];
    const setting = scenario.settings[p.id];
    if (!own || !setting) throw new Error(`missing settings ${p.id}`);
    const trust = await TrustStore.load(own.data);
    cast.trust.set(p.id, trust.data);
    // The scenario has no functions: each hook is an ordered list of core proposals.
    const handlers = (scenario.core[p.id] ?? []).map((spec) => {
      const handler: Record<string, unknown> = {
        description: spec.description,
        requiresRepresentation: spec.requiresRepresentation,
        ...(spec.agreementDelivery ? { agreementDelivery: spec.agreementDelivery } : {}),
        ...(spec.requiredApproval ? { requiredApproval: spec.requiredApproval } : {}),
      };
      for (const [hook, responses] of Object.entries(spec.hooks)) {
        let index = 0;
        handler[hook] = (...args: unknown[]) => {
          const response = responses[index++];
          if (!response) throw new Error(`script exhausted: ${p.id} ${hook}`);
          const ctx = args[0] as { record: (value: unknown) => void };
          for (const record of response.records ?? []) ctx.record(render(record, args));
          return response.result === null ? undefined : render(response.result, args);
        };
      }
      return handler as unknown as OperationHandler;
    });
    const name = (iri: string | undefined) =>
      iri ? (scenario.names[iri] ?? iri) : "an anonymous asker";
    const gate: GateContext = {
      sink: recorder.sink(setting.agent),
      configuration:
        setting.configuration.id === scenario.configuration.id
          ? configuration
          : setting.configuration,
      ...(setting.configurations ? { configurations: setting.configurations } : {}),
      name,
      taskLabel: (op) => scenario.tasks[op] ?? op,
      claimLabel: (st) =>
        scenario.labels[String(st.id)]?.claimLabel ?? String(st.claimType ?? st.id),
      tellPrincipal: (st) => scenario.labels[String(st.id)]?.tellPrincipal,
      reliance: profile.reliance,
      resolver: new TrustResolver({
        principal: own.principal,
        trust,
        name,
        ...(own.root ? { root: own.root as unknown as TrustRoot } : {}),
        ...(own.ownList ? { ownList: own.ownList as unknown as OwnListEntry[] } : {}),
      }),
      ...(setting.principalLimits ? { principalLimits: setting.principalLimits } : {}),
    };
    // Re-sign the mandate from data; never consume a pre-signed mandate or private key file.
    const provisioned = cast.get(p.id);
    cast.agents.set(p.id, {
      ...provisioned,
      mandateJws: await signMandate(
        provisioned.ownerKey,
        scenario.mandates[p.id] as unknown as OwnerMandate,
      ),
    });
    runtimes.set(p.id, await cast.runtime(p.id, handlers, [], setting.accepted, { gates: gate }));
  }
  try {
    for (const command of scenario.script) {
      const built = runtimes.get(command.by);
      if (!built) throw new Error(`no runtime ${command.by}`);
      time = Date.parse(command.at);
      recorder.step(command.step);
      const args = render(command.args) as unknown[];
      const runtime = built.runtime;
      // Closed dispatch: data cannot name arbitrary runtime methods.
      switch (command.method) {
        case "showMandate":
          results[command.id] = runtime.showMandate();
          break;
        case "instruct":
          results[command.id] = runtime.instruct(...(args as Parameters<AgentRuntime["instruct"]>));
          break;
        case "startNegotiation":
          results[command.id] = await runtime.startNegotiation(
            ...(args as Parameters<AgentRuntime["startNegotiation"]>),
          );
          break;
        case "startInvocation":
          results[command.id] = await runtime.startInvocation(
            ...(args as Parameters<AgentRuntime["startInvocation"]>),
          );
          break;
        case "admitStatements":
          results[command.id] = await runtime.admitStatements(
            ...(args as Parameters<AgentRuntime["admitStatements"]>),
          );
          break;
        case "receive": {
          let wire = args[0] as Json;
          for (const injection of scenario.inject.filter(
            (i) => i.step === command.step && i.by === command.by,
          )) {
            // Wire patches deliberately do not re-sign: integrity must detect alterations.
            const holder = { ...scenario, script: [{ ...command, args: [wire] }] };
            wire = applyChanges(
              holder,
              injection.patches.map((patch) => ({
                ...patch,
                path: `/script/0/args/0${patch.path}`,
              })),
            ).script[0]?.args[0] as Json;
          }
          results[command.id] = await runtime.receive(
            wire,
            args[1] as Parameters<AgentRuntime["receive"]>[1],
          );
          break;
        }
        case "submitApproval":
          results[command.id] = await runtime.submitApproval(
            ...(args as Parameters<AgentRuntime["submitApproval"]>),
          );
          break;
        case "sendReceipt":
          results[command.id] = await runtime.sendReceipt(
            ...(args as Parameters<AgentRuntime["sendReceipt"]>),
          );
          break;
        case "runTask":
          results[command.id] = await runtime.runTask(
            ...(args as Parameters<AgentRuntime["runTask"]>),
          );
          break;
        case "checkRecord":
          results[command.id] = runtime.checkRecord(built.ledger.entries());
          break;
      }
    }
    const trace: TraceFile = {
      schema: TRACE_SCHEMA,
      scenario: { id: scenario.id, title: scenario.title, steps: scenario.steps },
      configuration: { id: configuration.id, layers: { ...configuration.layers } },
      agents: scenario.traceAgents,
      generated: { commit: opts.commit ?? "unknown", core: "scripted" },
      events: recorder.events(),
    };
    assertOutline(trace, scenario.expect);
    return trace;
  } finally {
    for (const { runtime } of runtimes.values()) runtime.close();
  }
}
export function assertOutline(trace: TraceFile, expected: Scenario["expect"]): void {
  const actual = outlineOf(trace);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    const index = actual.findIndex(
      (entry, i) => canonicalJson(entry) !== canonicalJson(expected[i] ?? null),
    );
    throw new Error(
      `${trace.scenario.id}: outline mismatch at ${index < 0 ? actual.length : index}: ${JSON.stringify(actual[index])} expected ${JSON.stringify(expected[index])}`,
    );
  }
}
export async function runScenarioPaths(
  profile: DomainProfile,
  scenario: Scenario,
  opts: RunOptions = {},
): Promise<Map<string, TraceFile>> {
  const traces = new Map<string, TraceFile>();
  traces.set(scenario.id, await runScenario(profile, scenario, opts));
  for (const branch of scenario.branches) {
    const changed = applyChanges(scenario, branch.changes);
    const trace = await runScenario(
      profile,
      {
        ...changed,
        id: `${scenario.id}-${branch.id}`,
        title: branch.title,
        expect: branch.expect,
        branches: [],
      },
      opts,
    );
    if (
      !trace.events.some((e) => e.check === branch.check && e.reason === branch.reason) ||
      !trace.events.some((e) => e.kind === "decision" && e.outcome === branch.outcome)
    )
      throw new Error(`branch ${branch.id}: missing expected outcome/check/reason`);
    traces.set(trace.scenario.id, trace);
  }
  return traces;
}
export async function runDataScenario(id: string, opts: RunOptions = {}): Promise<TraceFile> {
  const scenario = loadScenario(id);
  return runScenario(loadProfile(scenario.profile), scenario, opts);
}
