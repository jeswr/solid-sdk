// AUTHORED-BY Codex GPT-6
/** Data drives cores and the synthetic world. Only the real runtime/gates emit events. */
import type { OdrlRule } from "@jeswr/solid-odrl";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { isDeepStrictEqual } from "util";
import { digestOf } from "../core/canonical.js";
import type { ActionIntent, EvidenceItem, Iri, Json, JsonObject } from "../core/types.js";
import type { GateContext } from "../gates/common.js";
import { signStatement, TYP } from "../mechanisms/statements.js";
import { TrustStore } from "../mechanisms/trust.js";
import { CONFIG_ED25519 } from "../profile/configurations.js";
import { idSource, testKey } from "../reference/keys.js";
import type { AgentRuntime, OutboundMessage, StepResult } from "../runtime/agent.js";
import type {
  AgreementPlan,
  HandlerContext,
  HandlerReply,
  OperationHandler,
  OutboundPlan,
} from "../runtime/operations.js";
import { Cast, mandateOf, signClaim } from "../scenarios/common.js";
import { BASELINE } from "../suites/baseline.js";
import { TraceRecorder } from "../trace/recorder.js";
import { type OutlineEntry, outlineOf, TRACE_SCHEMA, type TraceFile } from "../trace/types.js";
import { TrustResolver } from "../trust/resolver.js";
import { validateReferences } from "./load.js";
import {
  type DomainProfile,
  domainProfileSchema,
  type Scenario,
  scenarioSchema,
} from "./schema.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("a validated scenario reference is missing");
  return value;
}

export interface PathResult {
  readonly path: string;
  readonly trace?: TraceFile;
  readonly blocked?: string;
  readonly matches?: boolean;
  readonly difference?: { index: number; expected?: OutlineEntry; actual?: OutlineEntry };
}

/** A literal deep patch; arrays replace, objects merge. No code is evaluated. */
export function patch<T>(original: T, change: unknown): T {
  if (!change || typeof change !== "object" || Array.isArray(change))
    return structuredClone(change) as T;
  const out: Record<string, unknown> =
    original && typeof original === "object" && !Array.isArray(original)
      ? (structuredClone(original) as Record<string, unknown>)
      : {};
  for (const [key, value] of Object.entries(change)) {
    if (["__proto__", "prototype", "constructor"].includes(key))
      throw new Error("unsafe patch key");
    out[key] = patch(out[key], value);
  }
  return out as T;
}
function atPath(value: unknown, path: string): unknown {
  let at = value;
  for (const key of path.split(".")) {
    if (
      !key ||
      ["__proto__", "prototype", "constructor"].includes(key) ||
      !at ||
      typeof at !== "object" ||
      !Object.hasOwn(at, key)
    )
      throw new Error(`unresolved reference ${path}`);
    at = (at as Record<string, unknown>)[key];
  }
  return structuredClone(at);
}
export function resolveTemplate(value: unknown, context: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveTemplate(v, context));
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Object.keys(obj).length === 1 && typeof obj.$ref === "string")
      return atPath(context, obj.$ref);
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, resolveTemplate(v, context)]),
    );
  }
  return value;
}
function difference(expected: readonly OutlineEntry[], actual: readonly OutlineEntry[]) {
  for (let i = 0; i < Math.max(expected.length, actual.length); i++)
    if (!isDeepStrictEqual(expected[i], actual[i]))
      return { index: i, expected: expected[i], actual: actual[i] };
  return undefined;
}

function unsupported(profile: DomainProfile, scenario: Scenario, path: string): string | undefined {
  const named = scenario.blocked.find((b) => b.path === path || b.path === "*");
  if (named) return named.reason;
  if (scenario.assurance)
    return scenario.assurance === "proved"
      ? "needs the proof system"
      : "needs the joint computation";
  for (const [layer, suite] of Object.entries(scenario.suites))
    if (BASELINE.layers[layer as keyof typeof BASELINE.layers] !== suite)
      return `suite ${layer}/${suite} is not implemented by this engine`;
  // These are declared for inspection, never silently interpreted as a weaker baseline rule.
  if (profile.rules.length) return "general DER rule evaluation is not implemented";
  if (scenario.mandates.some((m) => m.standingRules.length))
    return "standing-rule execution and notification are not implemented";
  return undefined;
}

/** Run every path independently, including branches whose world changes affect setup. */
export async function runScenario(
  profileInput: unknown,
  scenarioInput: unknown,
  options: { commit?: string; compare?: boolean } = {},
): Promise<PathResult[]> {
  const profile = domainProfileSchema.parse(profileInput);
  const scenario = scenarioSchema.parse(scenarioInput);
  if (profile.id !== scenario.profile) throw new Error("profile/scenario id mismatch");
  validateReferences(profile, scenario);
  const paths = [
    {
      id: "main",
      change: {},
      outline: scenario.expect,
      blocked: undefined as string | undefined,
      expect: undefined,
    },
    ...scenario.branches,
  ];
  const results: PathResult[] = [];
  for (const path of paths) {
    const world = scenarioSchema.parse(patch(scenario, path.change));
    if (profile.id !== world.profile) throw new Error("branch profile mismatch");
    validateReferences(profile, world);
    const blocker = path.blocked ?? unsupported(profile, world, path.id);
    if (blocker) {
      results.push({ path: path.id, blocked: blocker });
      continue;
    }
    const trace = await runPath(profile, world, path.id, options.commit ?? "unknown");
    if (path.expect) {
      const witness = trace.events.findIndex(
        (e) => e.check === required(path.expect).check && e.reason === required(path.expect).reason,
      );
      const checkEvent = trace.events[witness];
      const decision = trace.events
        .slice(witness + 1)
        .find((e) => e.kind === "decision" && e.agent === checkEvent?.agent);
      if (witness < 0 || decision?.outcome !== path.expect.outcome)
        throw new Error(
          `${scenario.id}/${path.id}: expected ${path.expect.check}/${path.expect.reason} -> ${path.expect.outcome}`,
        );
      if (path.expect.outcome === "stop" || path.expect.outcome === "refuse") {
        if (
          trace.events
            .slice(decision?.seq ?? trace.events.length)
            .some(
              (e) =>
                e.agent === decision?.agent && (e.kind === "message-out" || e.kind === "store"),
            )
        )
          throw new Error(`${scenario.id}/${path.id}: an effect followed a stop`);
      }
    }
    const diff = difference(path.outline, outlineOf(trace));
    if (diff && options.compare !== false)
      throw new Error(
        `${scenario.id}/${path.id}: outline differs at ${diff.index}: ${JSON.stringify(diff)}`,
      );
    results.push({ path: path.id, trace, matches: !diff, ...(diff ? { difference: diff } : {}) });
  }
  const events = results.flatMap((result) => result.trace?.events ?? []);
  if (events.length)
    for (const check of scenario.stress) {
      if (!events.some((event) => event.check === check))
        throw new Error(`${scenario.id}: stress check ${check} was not exercised`);
    }
  return results;
}

async function runPath(
  profile: DomainProfile,
  scenario: Scenario,
  path: string,
  commit: string,
): Promise<TraceFile> {
  let clock = Date.parse("2026-11-13T09:00:00.000Z");
  const now = () => new Date(clock);
  const ids = idSource(`engine-${scenario.id}-${path}`);
  const recorder = new TraceRecorder();
  const cast = new Cast(now, {
    keys: async (id) => ({
      owner: await testKey(`engine/${id}/owner`),
      actor: await testKey(`engine/${id}/actor`),
    }),
    ids,
  });
  const parties = new Map(scenario.parties.map((p) => [p.id, p]));
  const agents = scenario.parties.filter((p) => p.runs === "agent");
  for (const party of agents) {
    const principal = required(parties.get(required(party.actsFor)));
    const mandate = scenario.mandates.find((m) => m.agent === party.id);
    if (!mandate) throw new Error(`missing mandate for ${party.id}`);
    await cast.add(
      { name: party.id, actor: required(party.actor), party: principal.identity },
      mandateOf(
        scenario.id,
        mandate.autonomous as unknown as OdrlRule[],
        mandate.withApproval as unknown as OdrlRule[],
        mandate.prohibitions as unknown as OdrlRule[],
      ),
      profile.operations.map((o) => o.id),
    );
  }
  for (const [a, b] of scenario.trust.introductions) {
    if (!cast.agents.has(a) || !cast.agents.has(b)) throw new Error("introductions require agents");
    cast.introduce(a, b);
  }
  const signed: Record<string, { jws: string; statement: JsonObject; evidence: EvidenceItem }> = {};
  for (const statement of scenario.statements) {
    const issuer = required(parties.get(statement.issuer));
    const key = cast.agents.has(issuer.id)
      ? cast.get(issuer.id).ownerKey
      : await testKey(`engine/${issuer.id}/issuer`);
    const issuerIdentity = issuer.actsFor
      ? required(parties.get(issuer.actsFor)).identity
      : issuer.identity;
    const payload: JsonObject = {
      ...(statement.value as JsonObject),
      id: `urn:scenario:${scenario.id}:${statement.id}`,
      issuer: issuerIdentity,
      subject: statement.subject,
      claimType: statement.kind,
      method: statement.method,
      asOf: statement.asOf,
      ...(statement.terms ? { terms: statement.terms as JsonObject } : {}),
    };
    const jws = await signClaim(key, payload);
    signed[statement.id] = {
      jws,
      statement: payload,
      evidence: { role: "credential", format: "jws-compact", value: jws },
    };
    for (const agent of agents) {
      // Local scenario setup is the reviewed pinning step, never a key supplied by a packet.
      if (!required(cast.trust.get(agent.id)).keys.some((k) => k.kid === key.kid))
        cast.pinIssuer(agent.id, issuerIdentity, key);
    }
  }
  for (const agent of agents)
    for (const rule of scenario.trust.sources[agent.id] ?? []) cast.rule(agent.id, rule);
  const runtimes = new Map<string, AgentRuntime>();
  const ledgers = new Map<string, { entries(): readonly never[] }>();
  const outputs: Record<string, unknown> = {};
  const queue: Array<{ from: string; out: OutboundMessage }> = [];
  const openings = new Map<string, unknown>();
  const responses = new Map<string, { reply?: unknown; agreementPlan?: unknown }>();
  const name = (iri: string | undefined) =>
    scenario.parties.find((p) => p.identity === iri || p.actor === iri)?.name ?? iri ?? "anonymous";
  const task = `urn:scenario:${scenario.id}:task`;
  const variables = (current?: HandlerContext) => ({
    steps: outputs,
    statements: signed,
    current,
    now: now().toISOString(),
  });
  for (const agent of agents) {
    const trust = await TrustStore.load(cast.trust.get(agent.id));
    const mandate = required(scenario.mandates.find((m) => m.agent === agent.id));
    const gate: GateContext = {
      configuration: BASELINE,
      sink: recorder.sink(agent.id),
      taskId: task,
      name,
      vocabulary: profile.vocabulary,
      identifiers: profile.identifiers,
      claimSources: Object.fromEntries(profile.claims.map((c) => [c.kind, c.sources])),
      purposes: Object.fromEntries(profile.purposes.map((p) => [p.id, p.claims])),
      reliance: {
        id: `urn:profile:${profile.id}`,
        rules: profile.claims.map((c) => ({
          id: `urn:profile:${profile.id}:${c.kind}`,
          claimType: c.kind,
          methods: c.methods,
          maxAgeDays: c.maxAgeDays,
          text: `Accept ${c.kind} from ${c.sources.join(", ")} by ${c.methods.join(", ")}, at most ${c.maxAgeDays} days old.`,
        })),
      },
      resolver: new TrustResolver({
        principal: name(cast.get(agent.id).identity.party),
        trust,
        ownList: scenario.trust.ownLists[agent.id],
        root: scenario.trust.root,
        name,
      }),
      ...(mandate.limits
        ? {
            principalLimits: {
              id: `urn:scenario:${scenario.id}:${agent.id}:limits`,
              ...mandate.limits,
            },
          }
        : {}),
    };
    const handlers: OperationHandler[] = profile.operations.map((op) => {
      const reply = (ctx: HandlerContext): HandlerReply =>
        resolveTemplate(
          responses.get(agent.id)?.reply ?? { type: "none" },
          variables(ctx),
        ) as HandlerReply;
      const intent = (ctx: HandlerContext, contents: JsonObject): ActionIntent => {
        const proposed = openings.get(agent.id);
        void contents;
        if (!proposed || typeof proposed !== "object" || Array.isArray(proposed))
          throw new Error("a scripted opening must carry its proposed intent");
        return {
          ...(resolveTemplate(proposed, variables(ctx)) as ActionIntent),
          conversation: ctx.conversation.id,
        };
      };
      return {
        description: { ...op, roles: ["initiator", "responder"], effects: [], outcomes: [] },
        requiresRepresentation: op.requiresRepresentation,
        agreementDelivery: op.agreementDelivery,
        requiredApproval: op.requiredApproval,
        intentForProposal: intent,
        intentForInvoke: intent,
        onProposal: reply,
        onInvoke: reply,
        onDeliver: reply,
        onReceipt: reply,
        onAgreement: (ctx) =>
          resolveTemplate(
            responses.get(agent.id)?.agreementPlan ?? { requiredOutcomes: [] },
            variables(ctx),
          ) as AgreementPlan,
      };
    });
    const created = await cast.runtime(
      agent.id,
      handlers,
      [
        {
          id: "urn:scenario:effect",
          execute: async (_key, params) => ({ conclusion: "completed", observed: params }),
          reconcile: async () => ({
            conclusion: "not-executed",
            reason: "no synthetic effect recorded",
          }),
        },
      ],
      [CONFIG_ED25519],
      {
        gates: gate,
        core: {
          id: "urn:agent-reference:scripted-core",
          version: digestOf(scenario),
          kind: "scripted",
        },
      },
    );
    runtimes.set(agent.id, created.runtime);
    ledgers.set(agent.id, created.ledger as never);
  }
  const enqueue = (from: string, result: StepResult) => {
    for (const out of result.outbound) queue.push({ from, out });
  };
  for (const [index, step] of scenario.script.entries()) {
    recorder.step(index + 1);
    const runtime = runtimes.get(step.agent);
    if (!runtime) throw new Error(`step ${step.id}: ${step.agent} does not run an agent`);
    const template = <T>(v: unknown) => resolveTemplate(v, variables()) as T;
    let result: unknown;
    switch (step.type) {
      case "instruct":
        runtime.instruct(step.text);
        break;
      case "admit":
        result = await runtime.admitStatements(
          step.statements.map((id) => required(signed[id])),
          { subject: step.subject, purpose: step.purpose, task: task, taskId: task },
        );
        break;
      case "start": {
        const peer = required(parties.get(step.peer));
        const operation = required(profile.operations.find((o) => o.id === step.operation));
        const base = {
          peer: {
            actor: required(peer.actor),
            party: required(parties.get(required(peer.actsFor))).identity,
          },
          operation: { id: operation.id, version: operation.version },
          models: operation.models,
          discover: step.discover,
          configuration: CONFIG_ED25519,
        };
        const contents = template<JsonObject>(step.contents);
        openings.set(step.agent, step.intent);
        result =
          step.kind === "propose"
            ? await runtime.startNegotiation({ ...base, terms: contents })
            : await runtime.startInvocation({
                ...base,
                input: contents,
                basis: { kind: "represented" },
                ...(step.purpose ? { purpose: step.purpose } : {}),
              });
        enqueue(step.agent, result as StepResult);
        break;
      }
      case "receive": {
        const position = queue.findIndex(
          (item) =>
            item.out.toActor === required(parties.get(step.agent)).actor &&
            (!step.from || item.from === step.from),
        );
        if (position < 0) throw new Error(`${step.id}: no queued message to ${step.agent}`);
        const item = required(queue.splice(position, 1)[0]);
        responses.set(step.agent, { reply: step.reply, agreementPlan: step.agreementPlan });
        let wire = structuredClone(item.out.wire);
        for (const injection of scenario.inject.filter((i) => i.step === step.id)) {
          const target = injection.target === "body" ? structuredClone(item.out.message) : wire;
          let at: Record<string, unknown> =
            injection.target === "body"
              ? ((target as { body: unknown }).body as Record<string, unknown>)
              : (target as unknown as Record<string, unknown>);
          for (const key of injection.path.slice(0, -1)) {
            if (
              ["__proto__", "constructor", "prototype"].includes(key) ||
              !at[key] ||
              typeof at[key] !== "object"
            )
              throw new Error("invalid injection path");
            at = at[key] as Record<string, unknown>;
          }
          const last = injection.path.at(-1);
          if (!last || ["__proto__", "constructor", "prototype"].includes(last))
            throw new Error("invalid injection path");
          at[last] = injection.value;
          if (injection.target === "body") {
            if (!injection.resign)
              throw new Error("body injection requires explicit hostile re-signing");
            wire = {
              format: "awp-jws-compact/0.1",
              jws: await signStatement(cast.get(item.from).actorKey, TYP.message, target),
            };
          } else wire = target as typeof wire;
        }
        result = await runtime.receive(wire, { binding: "direct-local/0.1" });
        enqueue(step.agent, result as StepResult);
        break;
      }
      case "approve": {
        const pending = runtime.pendingApprovals()[0];
        if (!pending) throw new Error(`${step.id}: no pending approval`);
        result = await runtime.submitApproval(
          await cast.approval(
            step.agent,
            pending.actionDigest,
            pending.conversation,
            step.decision,
            step.note,
          ),
          { evidence: step.evidence.map((id) => required(signed[id]).evidence) },
        );
        enqueue(step.agent, result as StepResult);
        break;
      }
      case "message":
        result = await runtime.sendMessage(template<Iri>(step.conversation), {
          kind: step.kind,
          body: template<JsonObject>(step.body),
          ...(step.intent ? { intent: template<ActionIntent>(step.intent) } : {}),
          evidence: step.evidence.map((id) => required(signed[id]).evidence),
        } as OutboundPlan);
        enqueue(step.agent, result as StepResult);
        break;
      case "effect":
        result = await runtime.runTask({
          taskId: `urn:scenario:${scenario.id}:${step.id}`,
          kind: "scripted-effect",
          plan: {
            adapter: "urn:scenario:effect",
            key: `urn:scenario:${scenario.id}:${step.id}`,
            intent: template<ActionIntent>(step.intent),
            params: template<JsonObject>(step.params),
            activityType: step.activityType,
          },
        });
        break;
      case "reading":
        result = await runtime.recordReading({
          task,
          originalDigest: template<string>(step.originalDigest),
          claimType: step.claimType,
          subject: step.subject,
          value: template<Json>(step.value),
        });
        break;
      case "record":
        result = runtime.checkRecord(required(ledgers.get(step.agent)).entries());
        break;
      case "advance":
        clock += step.milliseconds;
        break;
    }
    outputs[step.id] = result ?? null;
  }
  return {
    schema: TRACE_SCHEMA,
    scenario: {
      id: path === "main" ? scenario.id : `${scenario.id}--${path}`,
      title: scenario.title,
      steps: Object.fromEntries(scenario.script.map((step, i) => [String(i + 1), step.id])),
    },
    configuration: { id: BASELINE.id, layers: { ...BASELINE.layers } },
    agents: agents.map((p) => ({
      id: p.id,
      name: p.name,
      actsFor: required(p.actsFor),
      role: p.role,
    })),
    generated: { commit, core: "scripted" },
    events: recorder.events(),
  };
}
