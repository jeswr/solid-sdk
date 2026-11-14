import { decodeCompactPayload } from "../wire/inspect.js";
// AUTHORED-BY Codex GPT-6
/** Data drives cores and the synthetic world. Only the real runtime/gates emit events. */

import type { OdrlRule } from "@jeswr/solid-odrl";
import { Store } from "n3";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { isDeepStrictEqual } from "util";
import { ScriptedMailbox } from "../bindings/email.js";
import { digestBytes, digestContent, digestOf } from "../core/canonical.js";
import { DEFAULT_LIMITS } from "../core/limits.js";
import type { ActionIntent, EvidenceItem, Iri, Json, JsonObject } from "../core/types.js";
import { availableAdapters } from "../derive/adapters/index.js";
import { SPARQ_AGGREGATE } from "../derive/adapters/sparq-aggregate.js";
import type { ProofCache } from "../derive/cache.js";
import type { DerivedRequest, FixedJointSession, VerifierRegistry } from "../derive/verifiers.js";
import { DERIVATION_LIMITS, registryForRun } from "../derive/verifiers.js";
import { SyntheticPaymentRail, underwritingTermsFor } from "../domains/mortgage.js";
import {
  PURPOSE_STORE_RELEASE_CONDITION,
  PurposeBoundStore,
  purposeStoreReleaseCheck,
} from "../domains/purpose-store.js";
import type { GateContext } from "../gates/common.js";
import { FictionalAgentRegistry } from "../mechanisms/agent-registry.js";
import {
  type AgreementCredential,
  LocalAgreementCoordinator,
  verifyAgreementCredential,
} from "../mechanisms/agreements.js";
import { FictionalAuthorizationServer } from "../mechanisms/authorization-server.js";
import { issueMappingAttestation } from "../mechanisms/code-mapping.js";
import { LocalDatasetHolder } from "../mechanisms/dataset-query.js";
import { LocalForum, RECORD_LIMITS } from "../mechanisms/forum.js";
import { JOINT_OPERATIONS, JointParty } from "../mechanisms/joint.js";
import type { SigningKey } from "../mechanisms/jws.js";
import { mandateSchema, type OwnerMandate, signMandate } from "../mechanisms/mandate.js";
import { MandateStatusLists } from "../mechanisms/mandate-status.js";
import { LocalDocumentResolver } from "../mechanisms/organizations.js";
import { LocalResourceHolder, type ResourceReference } from "../mechanisms/references.js";
import {
  issueSelectiveCredential,
  presentSelective,
  unverifiedEvidenceClaim,
} from "../mechanisms/selective.js";
import { LocalSingleUseRegister, type SingleUseItem } from "../mechanisms/single-use.js";
import {
  representationSchema,
  signStatement,
  TYP,
  verifyStatement,
} from "../mechanisms/statements.js";
import { TrustStore } from "../mechanisms/trust.js";
import { EmbeddedCredentialNode } from "../model/evidence-item.js";
import { LabelIndex } from "../model/labels.js";
import { MessageNode } from "../model/message-nodes.js";
import { PaymentFacts } from "../model/payment.js";
import {
  alternativeWireId,
  CONFIG_AGREEMENT,
  CONFIG_CORROBORATION,
  CONFIG_EMAIL,
  CONFIG_FORUM,
  CONFIG_MAPPING,
  CONFIG_ORGANIZATIONS,
  CONFIG_PAYMENT,
  CONFIG_PINNED_LIST,
  CONFIG_PLAIN_LANGUAGE,
  CONFIG_PUBLIC,
  CONFIG_QUERY,
  CONFIG_REFERENCE_LOCAL,
  CONFIG_SELECTIVE_LOCAL,
  configurationById,
} from "../profile/configurations.js";
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
import { HTTP_STAND_IN } from "../settlement/adapter.js";
import { carry } from "../settlement/carried.js";
import { selectedSettlement } from "../settlement/configurations.js";
import { Ledger as PaymentLedger } from "../settlement/ledger.js";
import { FictionalDeliberationPlatform } from "../standins/deliberation.js";
import { FictionalDidDirectory, renameIdentities } from "../standins/did.js";
import { presentFederation } from "../standins/federation.js";
import { FictionalOriginDirectory } from "../standins/origin-hosted.js";
import { PodRecordMirror } from "../standins/pod-mirror.js";
import { issueAgentRating } from "../standins/reputation.js";
import { FictionalSolidStorage } from "../standins/storage.js";
import { buildIndexLog, withIndexReceipts } from "../standins/trusted-index.js";
import { FixedUsageModel } from "../standins/usage-model.js";
import { FictionalWebIdDirectory } from "../standins/webid.js";
import { MemoryLedger } from "../store/ledger.js";
import { MemoryStateStore } from "../store/state.js";
import { OriginHostedVerifier } from "../suites/authenticity-origin.js";
import { BASELINE } from "../suites/baseline.js";
import { withNegotiatedRequirement } from "../suites/meaning-negotiated.js";
import { withEmploymentRequirement, withMappingVocabulary } from "../suites/meaning-registry.js";
import { PUBLIC_READ } from "../suites/public-read.js";
import { scenarioRegistry } from "../suites/scenario.js";
import { PresentedFederationResolver } from "../suites/trust-federation.js";
import { ReputationResolver } from "../suites/trust-reputation.js";
import { TraceRecorder } from "../trace/recorder.js";
import { type OutlineEntry, outlineOf, TRACE_SCHEMA, type TraceFile } from "../trace/types.js";
import { TrustResolver } from "../trust/resolver.js";
import { AgreementCredentialProtocol } from "../wire/agreement-credential.js";
import { alterDocumentForTest, changeSelectiveSalt } from "../wire/document-faults.js";
import { writeMessagePacket } from "../wire/message-packet.js";
import { paymentObjects, paymentTrace } from "../wire/payment.js";
import { ScenarioCarriage } from "./carriage.js";
import { decisionsOf, firstBranchDivergence } from "./compare.js";
import { installHandler } from "./handlers.js";
import { validateReferences } from "./load.js";
import {
  advertisedConfigurations,
  matrixConfiguration,
  matrixPrerequisite,
  matrixSink,
  matrixWorld,
  preferredConfiguration,
} from "./matrix.js";
import {
  type DomainProfile,
  domainProfileSchema,
  type Scenario,
  scenarioSchema,
} from "./schema.js";
import { withScriptedReplies } from "./scripted-replies.js";
import { liveSettlement, PROCESSOR, settlementWorld } from "./settlement.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("a validated scenario reference is missing");
  return value;
}

export interface PathResult {
  readonly usedTestDouble?: boolean;
  readonly path: string;
  readonly configuration?: string;
  readonly what?: string;
  readonly trace?: TraceFile;
  readonly blocked?: string;
  readonly actual?: { outcome: string; reason: string; check?: string };
  readonly expected?: { outcome: string; reason: string };
  readonly consequences?: readonly {
    seq: number;
    agent: string;
    outcome: string;
    reason?: string;
  }[];
  readonly disagrees?: boolean;
  readonly note?: string;
  readonly matches?: boolean;
  readonly difference?: { index: number; expected?: OutlineEntry; actual?: OutlineEntry };
}

/** A literal deep patch; arrays replace, objects merge. No code is evaluated. */
export function patch<T>(original: T, change: unknown, listKey = "id"): T {
  if (!change || typeof change !== "object" || Array.isArray(change))
    return structuredClone(change) as T;
  // A map over an existing id-keyed list upserts entries by id. Literal arrays still replace.
  // This extends the branch patch syntax without changing any existing branch arrays.
  if (Array.isArray(original)) {
    const result = structuredClone(original) as Array<Record<string, unknown>>;
    for (const [id, value] of Object.entries(change)) {
      if (
        ["__proto__", "prototype", "constructor"].includes(id) ||
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
      )
        throw new Error("unsafe keyed-list patch");
      if (listKey in value && (value as Record<string, unknown>)[listKey] !== id)
        throw new Error("keyed-list identity mismatch");
      const index = result.findIndex((entry) => entry[listKey] === id);
      if (index < 0) result.push({ [listKey]: id, ...structuredClone(value) });
      else result[index] = patch(required(result[index]), value);
    }
    return result as T;
  }
  const out: Record<string, unknown> =
    original && typeof original === "object" && !Array.isArray(original)
      ? (structuredClone(original) as Record<string, unknown>)
      : {};
  for (const [key, value] of Object.entries(change)) {
    if (["__proto__", "prototype", "constructor"].includes(key))
      throw new Error("unsafe patch key");
    out[key] = patch(out[key], value, key === "mandates" ? "agent" : "id");
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

function unsupported(
  profile: DomainProfile,
  scenario: Scenario,
  path: string,
  verifiers: VerifierRegistry,
): string | undefined {
  for (const method of scenario.requiredMethods) {
    if (method === "sparq-noir-closed-world/0" && !verifiers.proofSystems.has(method))
      return "Blocked: needs a Noir circuit for absence and totals, not yet delivered.";
    if (!verifiers.proofSystems.has(method) && !verifiers.jointProtocols.has(method))
      return `${method === "sparq-aggregate/1" ? "needs joint computation" : "needs a proof system"}: needs the ${method} package, which is not installed`;
  }
  const named = scenario.blocked.find((b) => b.path === path || b.path === "*");
  if (named) return named.reason;
  if (
    scenario.assurance &&
    !scenario.requiredMethods.length &&
    !(
      scenario.assurance === "attested" &&
      (profile.rules.some((r) => r.assurances.includes("attested")) ||
        profile.codeMappings?.assurance === "attested")
    )
  )
    return scenario.assurance === "proved"
      ? "needs a proof system"
      : scenario.assurance === "joint"
        ? "needs joint computation"
        : "needs attestation";
  if (scenario.requiredMethods.length) return undefined;
  for (const [layer, suite] of Object.entries(scenario.suites))
    if (
      BASELINE.layers[layer as keyof typeof BASELINE.layers] !== suite &&
      (
        {
          accountability: "regulator-claim",
          commitments: "agreement-credential",
          reliance: "corroboration",
          trust: "pinned-list",
          meaning: "plain-language-upgrade",
          "data-access": "by-reference-local-holder",
          authority: "mandate-credential",
          identity: "organization-document-local",
          authenticity: "selective-disclosure",
          transport: "email",
          "usage-control": "human-approval",
        } as Record<string, string>
      )[layer] !== suite &&
      !(
        (
          {
            commitments: ["agreement-credential"],
            "data-access": ["by-query", "by-reference-local-holder"],
            identity: ["organization-document-local", "email-endpoint"],
            meaning: ["plain-language-upgrade", "registry-lookup"],
          } as Record<string, string[]>
        )[layer] ?? []
      ).includes(suite) &&
      !(layer === "usage-control" && suite === "odrl-model-tighten")
    )
      return `suite ${layer}/${suite} is not implemented by this engine`;
  if (
    Object.keys(scenario.suites).filter(
      (layer) => BASELINE.layers[layer as keyof typeof BASELINE.layers] !== scenario.suites[layer],
    ).length > 1 &&
    !(
      scenario.suites.transport === "email" &&
      scenario.suites.identity === "email-endpoint" &&
      scenario.suites.meaning === "plain-language-upgrade" &&
      scenario.suites["usage-control"] === "human-approval" &&
      scenario.suites.trust === "pinned-list" &&
      Object.keys(scenario.suites).length === 5
    ) &&
    !(
      scenario.suites.authority === "mandate-credential" &&
      scenario.suites.identity === "organization-document-local" &&
      Object.keys(scenario.suites).length === 2
    )
  )
    return "combined local capability configurations are not implemented";
  // These are declared for inspection, never silently interpreted as a weaker baseline rule.
  if (profile.rules.some((r) => !("template" in r)))
    return "legacy DER declaration needs an executable template";

  return undefined;
}

/** Run every path independently, including branches whose world changes affect setup. */
export async function runScenario(
  profileInput: unknown,
  scenarioInput: unknown,
  options: {
    configuration?: string;
    commit?: string;
    compare?: boolean;
    registry?: VerifierRegistry;
    testOnly?: boolean;
    proofCache?: ProofCache;
    generateProofs?: boolean;
  } = {},
): Promise<PathResult[]> {
  const profile = domainProfileSchema.parse(profileInput);
  const scenario = scenarioSchema.parse(scenarioInput);
  const verifiers = options.registry ?? (await availableAdapters());
  if (profile.id !== scenario.profile) throw new Error("profile/scenario id mismatch");
  validateReferences(profile, scenario);
  if (options.configuration === "all") {
    const results = await runScenario(profile, scenario, { ...options, configuration: undefined });
    for (const entry of scenario.configurations)
      results.push(
        ...(await runScenario(profile, scenario, { ...options, configuration: entry.id })),
      );
    return results;
  }
  const alternative = options.configuration
    ? scenario.configurations.find((c) => c.id === options.configuration)
    : undefined;
  if (options.configuration && !alternative) throw new Error("unknown scenario configuration");
  const configured = alternative
    ? scenarioSchema.parse(matrixWorld(scenario, alternative))
    : scenario;
  const paths = [
    {
      id: "main",
      change: {},
      outline: scenario.expect,
      blocked: undefined as string | undefined,
      expect: scenario.result,
      catalogueExpected: scenario.catalogueExpected,
    },
    ...configured.branches.filter((b) => !b.onlyUnder || b.onlyUnder === alternative?.id),
  ];
  const results: PathResult[] = [];
  const exercisedStress = new Set<Scenario["stress"][number]>();
  for (const path of paths) {
    const world = scenarioSchema.parse(patch(configured, path.change));
    if (profile.id !== world.profile) throw new Error("branch profile mismatch");
    validateReferences(profile, world);
    const pathProfile = domainProfileSchema.parse(
      patch(profile, "profileChange" in path && path.profileChange ? path.profileChange : {}),
    );
    if (alternative?.change.settlement)
      settlementWorld(world, pathProfile, alternative.change.settlement);
    if (alternative?.change.identity === "did") {
      Object.assign(pathProfile, renameIdentities(pathProfile, world.identityNames));
      Object.assign(world, renameIdentities(world, world.identityNames));
    }
    validateReferences(pathProfile, world);
    const combinationProblems = alternative
      ? scenarioRegistry().check({
          layers: {
            ...BASELINE.layers,
            ...matrixPrerequisite(scenario, alternative)?.change,
            ...alternative.change,
          },
        })
      : [];
    const blocker =
      path.blocked ??
      (combinationProblems.length
        ? `A registered suite constraint excludes this single-layer combination: ${combinationProblems.map((problem) => ("detail" in problem ? problem.detail : problem.problem)).join("; ")}`
        : undefined) ??
      (alternative &&
      "transport" in alternative.change &&
      !world.carriage &&
      world.parties.filter((party) => party.runs === "agent").length !== 2
        ? "This transport needs an explicit pair of agents in its world carriage scope."
        : undefined) ??
      (alternative?.change.transport === "mcp" &&
      !world.parties.some(
        (party) => party.id === "channel-authority" && party.runs === "issuer-only",
      )
        ? "The MCP channel needs a separately keyed fictional authorization-server party in its world."
        : undefined) ??
      (alternative && configurationById(alternativeWireId(alternative.id))?.status !== "executable"
        ? `The selected suite has no executable runtime configuration installed. ${configurationById(alternativeWireId(alternative.id))?.unresolved.join(" ") ?? "The wire implementation alone is insufficient."}`
        : unsupported(pathProfile, world, path.id, verifiers));
    if (blocker) {
      results.push({
        path: path.id,
        ...("what" in path ? { what: path.what } : {}),
        ...(alternative ? { configuration: alternative.id } : {}),
        blocked: blocker,
      });
      continue;
    }
    const usedTestDouble = world.requiredMethods.some(
      (method) =>
        (verifiers.proofSystems.get(method) ?? verifiers.jointProtocols.get(method))?.kind ===
        "test-double",
    );
    if (usedTestDouble && !options.testOnly)
      throw new Error(
        "The engine refuses test-double verifiers outside an explicit in-memory test run; no runs row or trace may be written.",
      );
    for (const check of world.stress) exercisedStress.add(check);
    const tracked = registryForRun(verifiers, options.testOnly);
    const trace = await runPath(
      pathProfile,
      world,
      path.id,
      options.commit ?? "unknown",
      tracked.registry,
      { ...options, alternative },
    );
    if (tracked.usedTestDouble() && !options.testOnly)
      throw new Error(
        "The engine refuses a test-double verification attempt, including one caught as a verifier failure; no artifact may be written.",
      );
    if (path.expect && !world.requiredMethods.length) {
      const witness = trace.events.findIndex(
        (e) => e.check === required(path.expect).check && e.reason === required(path.expect).reason,
      );
      const checkEvent = trace.events[witness];
      const decision = trace.events
        .slice(witness + 1)
        .find(
          (e) =>
            e.kind === "decision" &&
            e.agent === checkEvent?.agent &&
            (!["go", "stop"].includes(path.expect?.outcome ?? "") ||
              e.outcome === path.expect?.outcome),
        );
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
                e.agent === decision?.agent &&
                (e.kind === "store" ||
                  (e.kind === "message-out" &&
                    !(
                      path.expect?.outcome === "refuse" &&
                      ["refuse", "challenge", "unsupported", "indeterminate"].includes(
                        e.packet?.kind ?? "",
                      )
                    ))),
            )
        )
          throw new Error(`${scenario.id}/${path.id}: an effect followed a stop`);
      }
    }
    const diff = difference(path.outline, outlineOf(trace));
    if (diff && options.compare !== false && !alternative)
      throw new Error(
        `${scenario.id}/${path.id}: outline differs at ${diff.index}: ${JSON.stringify(diff)}`,
      );
    const decisions = decisionsOf(trace.events);
    const mainTrace = results.find((r) => r.path === "main")?.trace;
    const firstFailure =
      path.id !== "main" && mainTrace
        ? firstBranchDivergence(decisionsOf(mainTrace.events), decisions)
        : decisions.find((e) => !["pass", "admit", "go"].includes(e.outcome ?? ""));
    const noDivergence = path.id !== "main" && !!mainTrace && !firstFailure;
    const judged = firstFailure ?? decisions.at(-1);
    const judgedReason =
      judged?.reason ??
      (world.requiredMethods.length && judged
        ? trace.events
            .slice(0, judged.seq - 1)
            .findLast((e) => e.agent === judged.agent && e.kind === "check" && e.reason)?.reason
        : undefined);
    const check =
      judged &&
      trace.events
        .slice(0, judged.seq - 1)
        .findLast(
          (e) => e.agent === judged.agent && e.kind === "check" && e.reason === judgedReason,
        )?.check;
    const actual =
      !firstFailure && path.expect && !world.requiredMethods.length
        ? { outcome: path.expect.outcome, reason: path.expect.reason, check: path.expect.check }
        : judged?.outcome && judgedReason
          ? {
              outcome: judged.outcome,
              reason: judgedReason,
              ...(check ? { check } : {}),
            }
          : undefined;
    const consequences = firstFailure
      ? decisions
          .filter((e) => e.seq > firstFailure.seq)
          .map((e) => ({
            seq: e.seq,
            agent: e.agent,
            outcome: e.outcome as string,
            ...(e.reason ? { reason: e.reason } : {}),
          }))
      : [];
    const expected =
      path.catalogueExpected ??
      (path.id !== "main" && path.expect
        ? { outcome: path.expect.outcome, reason: path.expect.reason }
        : undefined);
    results.push({
      path: path.id,
      ...("what" in path ? { what: path.what } : {}),
      ...(alternative ? { configuration: alternative.id } : {}),
      ...(tracked.usedTestDouble() ? { usedTestDouble: true } : {}),
      trace,
      actual,
      expected,
      consequences,
      ...(noDivergence ? { note: "branch does not diverge from the main path" } : {}),
      disagrees:
        (noDivergence && !("onlyUnder" in path && path.onlyUnder)) ||
        (!!expected &&
          ((actual?.outcome === "refuse" ? "stop" : actual?.outcome) !==
            (expected.outcome === "refuse" ? "stop" : expected.outcome) ||
            actual?.reason !== expected.reason)),
      matches: !diff,
      ...(diff ? { difference: diff } : {}),
    });
  }
  const events = results.flatMap((result) => result.trace?.events ?? []);
  if (events.length)
    for (const check of exercisedStress) {
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
  verifiers: VerifierRegistry,
  options: {
    proofCache?: ProofCache;
    generateProofs?: boolean;
    alternative?: Scenario["configurations"][number];
  },
): Promise<TraceFile> {
  const registry = scenarioRegistry();
  const local =
    scenario.suites.meaning === "registry-lookup"
      ? CONFIG_MAPPING
      : scenario.suites.transport === "email"
        ? CONFIG_EMAIL
        : scenario.suites["data-access"] === "by-query"
          ? CONFIG_QUERY
          : scenario.suites.commitments === "agreement-credential"
            ? CONFIG_AGREEMENT
            : scenario.suites.accountability === "regulator-claim"
              ? CONFIG_FORUM
              : scenario.suites.authenticity === "selective-disclosure"
                ? CONFIG_SELECTIVE_LOCAL
                : scenario.suites.authority === "mandate-credential"
                  ? CONFIG_ORGANIZATIONS
                  : scenario.suites["data-access"] === "by-reference-local-holder"
                    ? CONFIG_REFERENCE_LOCAL
                    : scenario.suites.meaning === "plain-language-upgrade"
                      ? CONFIG_PLAIN_LANGUAGE
                      : scenario.suites.settlement === "rdf-order"
                        ? CONFIG_PAYMENT
                        : scenario.suites.reliance === "corroboration"
                          ? CONFIG_CORROBORATION
                          : scenario.suites.trust === "pinned-list"
                            ? CONFIG_PINNED_LIST
                            : undefined;
  const configuration = options.alternative
    ? matrixConfiguration(
        options.alternative,
        registry,
        matrixPrerequisite(scenario, options.alternative),
      )
    : local
      ? {
          id: `${scenario.id}-local`,
          pilotConfiguration: local,
          layers: { ...BASELINE.layers, ...scenario.suites },
        }
      : BASELINE;
  if (local && !options.alternative) registry.configure(configuration);
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
      {
        name: party.id,
        actor: required(party.actor),
        party: principal.identity,
        ...(party.operator ? { operator: party.operator } : {}),
      },
      mandateOf(
        scenario.id,
        mandate.autonomous as unknown as OdrlRule[],
        mandate.withApproval as unknown as OdrlRule[],
        mandate.prohibitions as unknown as OdrlRule[],
        mandate.standingRules as unknown as import("../mechanisms/mandate.js").StandingRule[],
        mandate.duties ?? [],
      ),
      party.representationOperations ?? profile.operations.map((o) => o.id),
      {
        ownerKey: [...cast.agents.values()].find((a) => a.identity.party === principal.identity)
          ?.ownerKey,
      },
    );
  }
  for (const [a, b] of scenario.trust.introductions) {
    if (!cast.agents.has(a) || !cast.agents.has(b)) throw new Error("introductions require agents");
    cast.introduce(a, b);
  }
  for (const [a, b] of scenario.trust.pins) cast.pin(a, b);
  const sourceKeys = new Map<string, Awaited<ReturnType<typeof testKey>>>();
  for (const party of scenario.parties.filter((p) => p.runs === "issuer-only")) {
    const representative = agents.find((a) => a.actsFor === party.id);
    const key = representative
      ? cast.get(representative.id).ownerKey
      : await testKey(`engine/${party.id}/issuer`);
    sourceKeys.set(party.id, key);
    for (const agent of agents)
      if (!required(cast.trust.get(agent.id)).keys.some((k) => k.kid === key.kid))
        cast.pinIssuer(agent.id, party.identity, key);
  }
  let mandateLists: MandateStatusLists | undefined;
  let agreementStatus: MandateStatusLists | undefined;
  if (configuration.id === "commitments-agreement-credential") {
    const valuer = cast.get("valuer-agent");
    agreementStatus = new MandateStatusLists(valuer.identity.party, valuer.ownerKey, () =>
      now().toISOString(),
    );
    await agreementStatus.setup();
  }
  if (configuration.id === "authority-mandate-credential") {
    const sam = cast.get("sam-agent");
    mandateLists = new MandateStatusLists(sam.identity.party, sam.ownerKey, () =>
      now().toISOString(),
    );
    await mandateLists.setup();
    const payload = mandateSchema.parse(decodeCompactPayload(sam.mandateJws)) as OwnerMandate;
    const mandateJws = await signMandate(sam.ownerKey, {
      ...payload,
      actorKid: sam.actorKey.kid,
      credentialStatus: mandateLists.entries,
    });
    const rep = representationSchema.parse(decodeCompactPayload(sam.representationJws));
    cast.agents.set("sam-agent", {
      ...sam,
      mandateJws,
      representationJws: await signStatement(sam.ownerKey, TYP.representation, {
        ...rep,
        mandate: mandateJws,
      }),
    });
  }
  let authorizationServer: FictionalAuthorizationServer | undefined;
  let authorizationGrant: string | undefined;
  if (configuration.id === "authority-authorization-server") {
    const server = required(parties.get("authorization-server")),
      sam = cast.get("sam-agent");
    authorizationServer = new FictionalAuthorizationServer(
      server.identity,
      required(sourceKeys.get(server.id)),
      () => now().toISOString(),
    );
    const m = mandateSchema.parse(decodeCompactPayload(sam.mandateJws)) as OwnerMandate;
    const consent = await signStatement(sam.ownerKey, "awp-grant-consent+jws", {
      issuer: sam.identity.party,
      actor: sam.identity.actor,
      kid: sam.actorKey.kid,
      mandateDigest: digestOf(m),
      validUntil: m.validUntil,
    });
    const approvalTrust = await TrustStore.load(required(cast.trust.get("sam-agent")));
    const audiences = [
      ...new Set([sam.identity.actor, ...[...cast.agents.values()].map((p) => p.identity.party)]),
    ];
    authorizationGrant = await authorizationServer.issue(
      m,
      sam.actorKey.kid,
      audiences,
      consent,
      approvalTrust,
    );
    const presented =
      scenario.authorityFault === "token-as-the-person"
        ? await authorizationServer.issue(
            m,
            sam.actorKey.kid,
            audiences,
            consent,
            approvalTrust,
            true,
          )
        : authorizationGrant;
    const rep = representationSchema.parse(decodeCompactPayload(sam.representationJws));
    cast.agents.set("sam-agent", {
      ...sam,
      representationJws: await signStatement(sam.ownerKey, TYP.representation, {
        ...rep,
        authorityGrant: presented,
      }),
    });
  }
  let agentRegistry: FictionalAgentRegistry | undefined;
  if (configuration.id === "authority-agent-registry") {
    const service = required(parties.get("agent-registry")),
      sam = cast.get("sam-agent");
    agentRegistry = new FictionalAgentRegistry(
      service.identity,
      required(sourceKeys.get(service.id)),
      () => now().toISOString(),
    );
    const m = mandateSchema.parse(decodeCompactPayload(sam.mandateJws));
    const operations = [
      ...new Set(
        [...(m.autonomous.permissions ?? []), ...(m.withApproval.permissions ?? [])].flatMap((r) =>
          r.target && profile.operations.some((op) => op.id === r.target) ? [r.target] : [],
        ),
      ),
    ];
    agentRegistry.register({
      actor: sam.identity.actor,
      principal: sam.identity.party,
      actorKid: sam.actorKey.kid,
      status: "active",
      operations:
        scenario.authorityFault === "registered-for-something-else"
          ? ["https://w3id.org/jeswr/awp#op/mortgage-product-search"]
          : operations,
    });
  }
  const signed: Record<
    string,
    {
      jws: string;
      format?: string;
      wireDigest: string;
      statement: JsonObject;
      evidence: EvidenceItem;
    }
  > = {};
  const negotiated =
    configuration.layers.meaning === "negotiated" ? scenario.negotiatedMeaning : undefined;
  const publicPart = (key: SigningKey) => ({
    kid: key.kid,
    alg: key.alg,
    publicJwk: key.publicJwk,
  });
  const deliberation = negotiated
    ? new FictionalDeliberationPlatform(
        required(parties.get(negotiated.platform)).identity,
        required(sourceKeys.get(negotiated.platform)),
        {
          identity: cast.get(negotiated.proposer).identity.actor,
          key: publicPart(cast.get(negotiated.proposer).actorKey),
        },
        Object.fromEntries(
          [negotiated.proposer, negotiated.peer].map((id) => [
            cast.get(id).identity.party!,
            publicPart(cast.get(id).ownerKey),
          ]),
        ),
        {
          identity: cast.get(negotiated.peer).identity.actor,
          key: publicPart(cast.get(negotiated.peer).actorKey),
        },
        negotiated,
        recorder.sink(negotiated.platform),
      )
    : undefined;
  for (const statement of scenario.statements) {
    const issuer = required(parties.get(statement.issuer));
    const key = cast.agents.has(issuer.id)
      ? cast.get(issuer.id).ownerKey
      : required(sourceKeys.get(issuer.id));
    const issuerIdentity = issuer.actsFor
      ? required(parties.get(issuer.actsFor)).identity
      : issuer.identity;
    const payload: JsonObject = {
      ...(statement.value as JsonObject),
      ...(typeof statement.value.subjectKeyOf === "string"
        ? { subjectKey: required(sourceKeys.get(statement.value.subjectKeyOf)).kid }
        : {}),
      id: statement.identifier ?? `urn:scenario:${scenario.id}:${statement.id}`,
      issuer: issuerIdentity,
      ...(statement.subject ? { subject: statement.subject } : {}),
      claimType: statement.kind,
      method: statement.method,
      ...(statement.asOf ? { asOf: statement.asOf } : {}),
      ...(statement.terms ? { terms: statement.terms as JsonObject } : {}),
    };
    if (typeof statement.value.actorKeyOf === "string")
      payload.subjectKey = cast.get(statement.value.actorKeyOf).actorKey.kid;
    delete payload.actorKeyOf;
    delete payload.subjectKeyOf;
    const isOrigin =
      configuration.id === "authenticity-origin-hosted" &&
      scenario.originHosted?.records.some((record) => record.statement === statement.id);
    const jws = isOrigin ? "" : await signClaim(key, payload);
    signed[statement.id] = {
      jws,
      wireDigest: digestBytes(jws),
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
  const proofIssuerKeys: NonNullable<GateContext["proofIssuerKeys"]>[number][] = [];
  const proofCredentials: NonNullable<GateContext["proofCredentials"]>[number][] = [];
  for (const spec of scenario.proofCredentials) {
    const system = verifiers.proofSystems.get(spec.method);
    if (!system || !scenario.requiredMethods.includes(spec.method)) continue;
    const issuer = required(parties.get(spec.issuer));
    const keys = await system.issuerKeygen(
      new TextEncoder().encode(`engine/${issuer.identity}/${spec.method}`),
    );
    const statements = spec.statements.map((id) => required(signed[id]).statement);
    const credential = await system.issue({
      issuerKey: keys.secretKey,
      subject: spec.subject,
      claims: { statements },
      ...(spec.status ? { status: spec.status } : {}),
    });
    const knownKey = proofIssuerKeys.find(
      (k) => k.issuer === issuer.identity && digestOf(k.key) === digestOf(keys.publicKey),
    );
    if (knownKey)
      knownKey.claimTypes = [
        ...new Set([...knownKey.claimTypes, ...statements.map((s) => String(s.claimType))]),
      ];
    else
      proofIssuerKeys.push({
        issuer: issuer.identity,
        key: keys.publicKey,
        claimTypes: statements.map((s) => String(s.claimType)),
      });
    for (const statement of statements)
      proofCredentials.push({
        credential,
        statement: String(statement.id),
        digest: digestOf(statement),
      });
  }
  const proofDatasets = profile.acceptedProofs
    .filter((a) => a.binds.includes("complete"))
    .map((a) => {
      const credentialDigests = [
        ...new Set(proofCredentials.map((c) => digestOf(c.credential))),
      ].sort();
      return {
        format: "engine-credential-digests/1" as const,
        rule: a.rule,
        credentialDigests,
        commitment: digestOf({ rule: a.rule, credentialDigests }),
      };
    });
  const proofStatusPolicy: JsonObject = {
    snapshots: scenario.proofCredentials
      .filter((c) => c.status)
      .map((c) => ({
        issuer: required(parties.get(c.issuer)).identity,
        status: c.status as JsonObject,
      })),
  };
  for (const credential of scenario.selectiveCredentials) {
    const issuer = required(parties.get(credential.issuer));
    const first = required(signed[required(credential.statements[0])]).statement;
    const statements = credential.statements.map((id) => required(signed[id]).statement);
    const issued = await issueSelectiveCredential(
      required(sourceKeys.get(issuer.id)),
      {
        id: `urn:selective:${scenario.id}:${credential.id}`,
        issuer: issuer.identity,
        subject: credential.subject,
        method: String(first.method),
        asOf: String(first.asOf),
      },
      statements.map((s) => ({
        id: String(s.id),
        claimType: String(s.claimType),
        value: required(s.value),
        ...(s.terms ? { terms: s.terms } : {}),
      })),
      statements.map((s) => digestOf({ fixtureSalt: scenario.id, claim: s.id })),
    );
    for (const id of credential.statements) {
      const evidence = required(
        presentSelective(issued, [String(required(signed[id]).statement.id)])[0],
      );
      signed[id] = {
        jws: evidence.value,
        format: evidence.format,
        wireDigest: digestBytes(evidence.value),
        statement: unverifiedEvidenceClaim(evidence),
        evidence,
      };
    }
  }
  const indexSettings =
    configuration.layers.trust === "trusted-index" ? scenario.trustedIndex : undefined;
  const indexLog = indexSettings
    ? await buildIndexLog({
        key: required(sourceKeys.get(indexSettings.index)),
        source: required(parties.get(indexSettings.index)).identity,
        records: indexSettings.records.map((id) => required(signed[id]).jws),
        sources: indexSettings.records.map((id) => String(required(signed[id]).statement.issuer)),
        register: indexSettings.register,
        at: now().toISOString(),
        fork: indexSettings.fork,
      })
    : undefined;
  const federationSettings =
    configuration.layers.trust === "federation" ? scenario.federation : undefined;
  const federationPresentation = federationSettings
    ? await presentFederation({
        anchor: {
          id: required(parties.get(federationSettings.anchor)).identity,
          key: required(sourceKeys.get(federationSettings.anchor)),
        },
        superior: {
          id: required(parties.get(federationSettings.superior)).identity,
          key: required(sourceKeys.get(federationSettings.superior)),
        },
        subject: {
          id: required(parties.get(federationSettings.subject)).identity,
          key: required(sourceKeys.get(federationSettings.subject)),
          actorKey: cast.get(
            required(agents.find((a) => a.actsFor === federationSettings.subject)).id,
          ).actorKey,
        },
        purpose: federationSettings.purpose,
        claimTypes: federationSettings.claimTypes,
        at: now().toISOString(),
        expired: federationSettings.expired,
        businessOnly: federationSettings.businessOnly,
      })
    : undefined;
  const reputationSettings =
    configuration.layers.trust === "reputation" ? scenario.reputation : undefined;
  const ratingEvidence = reputationSettings
    ? await Promise.all(
        reputationSettings.ratings.map((rating) =>
          issueAgentRating(required(sourceKeys.get(reputationSettings.service)), {
            service: required(parties.get(reputationSettings.service)).identity,
            party: required(parties.get(rating.party)).identity,
            actor: cast.get(rating.agent).identity.actor,
            kid: cast.get(rating.agent).actorKey.kid,
            score: rating.score,
            at: now().toISOString(),
          }),
        ),
      )
    : [];
  const originSettings =
    configuration.id === "authenticity-origin-hosted" ? scenario.originHosted : undefined;
  const originDirectory = originSettings
    ? new FictionalOriginDirectory(
        {
          identity: required(parties.get(originSettings.register)).identity,
          key: required(sourceKeys.get(originSettings.register)),
        },
        now().toISOString(),
      )
    : undefined;
  if (originSettings && originDirectory)
    for (const entry of originSettings.records) {
      const record = required(signed[entry.statement]);
      await originDirectory.publish(entry.address, record.statement);
      const locator = originDirectory.locator(
        String(record.statement.id),
        originSettings.pointerFault,
      );
      signed[entry.statement] = {
        ...record,
        jws: locator,
        format: "origin-hosted",
        wireDigest: digestBytes(locator),
        evidence: { role: "credential", format: "origin-hosted", value: locator },
      };
    }
  const documents: Record<string, string> = {};
  const documentPayload = (value: JsonObject): JsonObject => {
    const keys = Array.isArray(value.keys)
      ? value.keys.map((entry) => {
          const key = entry as JsonObject;
          const agent = typeof key.agent === "string" ? cast.get(key.agent) : undefined;
          const issuer = typeof key.issuer === "string" ? sourceKeys.get(key.issuer) : undefined;
          const signer = agent
            ? key.role === "actor"
              ? agent.actorKey
              : agent.ownerKey
            : required(issuer);
          return { kid: signer.kid, subject: required(key.subject), role: required(key.role) };
        })
      : undefined;
    return { ...value, ...(keys ? { keys } : {}) };
  };
  for (const doc of scenario.documents)
    documents[doc.id] = await signStatement(
      required(sourceKeys.get(doc.issuer)),
      doc.typ,
      documentPayload(doc.value),
    );
  for (const mapping of scenario.mappingTables) {
    let jws = await signStatement(
      required(sourceKeys.get(mapping.issuer)),
      "awp-code-mapping-table+jws",
      mapping.value,
    );
    if (mapping.tamper) jws = `${jws.slice(0, -4)}AAAA`;
    documents[mapping.value.id] = jws;
  }
  const resolver = new LocalDocumentResolver(documents);
  const organizationCredentials: Record<string, string> = {};
  for (const credential of scenario.organizationCredentials) {
    const agent = cast.get(credential.agent);
    const payload = {
      type: "OrganizationMandate",
      id: `urn:credential:${scenario.id}:${credential.agent}`,
      issuer: required(parties.get(credential.issuer)).identity,
      actor: agent.identity.actor,
      subjectKey: agent.actorKey.kid,
      entity: credential.entity,
      roles: credential.roles,
      actions: credential.actions,
      validFrom: credential.validFrom,
      validUntil: credential.validUntil,
      status: credential.status,
    };
    organizationCredentials[credential.agent] = await signStatement(
      required(sourceKeys.get(credential.issuer)),
      "awp-organization-mandate+jws",
      payload,
    );
  }
  const authorityLinks: Record<string, string> = {};
  for (const link of scenario.authorityLinks) {
    const subject = required(parties.get(link.subject));
    const agent = cast.agents.get(link.subject);
    const issuer = cast.agents.get(link.issuer);
    const key = issuer ? issuer.ownerKey : required(sourceKeys.get(link.issuer));
    authorityLinks[link.id] = await signStatement(key, "awp-mandate-link+jws", {
      ...link,
      type: "MandateLink",
      issuer: required(parties.get(link.issuer)).identity,
      subject: agent ? agent.identity.actor : subject.identity,
      subjectKey: agent ? agent.actorKey.kid : required(sourceKeys.get(link.subject)).kid,
    });
  }
  const capabilityTrust = async (identity: string) =>
    TrustStore.load({
      version: 1,
      owner: identity,
      keys: [
        ...agents.map((a) => {
          const k = cast.get(a.id).actorKey;
          return {
            kid: k.kid,
            alg: k.alg,
            publicJwk: k.publicJwk,
            role: "actor" as const,
            subject: required(a.actor),
            party: required(parties.get(required(a.actsFor))).identity,
          };
        }),
        ...[...sourceKeys].map(([id, k]) => ({
          kid: k.kid,
          alg: k.alg,
          publicJwk: k.publicJwk,
          role: agents.some((a) => a.actsFor === id) ? ("party" as const) : ("issuer" as const),
          subject: required(parties.get(id)).identity,
        })),
      ],
      sourceAuthority: profile.claims.flatMap((c) =>
        c.sources.map((source) => ({
          id: `urn:authority:${scenario.id}:${digestOf({ source, kind: c.kind }).slice(8)}`,
          version: "1",
          source,
          claimTypes: [c.kind],
          subjects: "any" as const,
        })),
      ),
    });
  if (profile.codeMappings?.assurance === "attested") {
    for (const mapping of scenario.mappingTables)
      for (const original of Object.values(signed)) {
        if (original.statement.codeList !== mapping.value.fromList) continue;
        const identity = required(parties.get(mapping.issuer)).identity;
        const issued = await issueMappingAttestation(original.jws, {
          identity,
          key: required(sourceKeys.get(mapping.issuer)),
          policy: profile.codeMappings,
          trust: await capabilityTrust(identity),
          resolver,
          at: now().toISOString(),
          verifier: identity,
          record: () => {},
        });
        if (issued) documents[issued.ref] = issued.jws;
      }
  }
  const agreementServices = new Map<string, LocalAgreementCoordinator>();
  const capabilityAnswers: Record<string, unknown> = {};
  for (const declaration of scenario.agreements) {
    const identity = required(parties.get(declaration.service)).identity;
    agreementServices.set(
      declaration.service,
      new LocalAgreementCoordinator({
        identity,
        key: required(sourceKeys.get(declaration.service)),
        trust: await capabilityTrust(identity),
        store: new MemoryStateStore(),
        ledger: new MemoryLedger(),
        now: () => now().toISOString(),
        definition: declaration.definition,
        mandateActive: (actor) => {
          const a = agents.find((a) => a.actor === actor);
          const status = a ? runtimes.get(a.id)?.mandateStatus() : undefined;
          return !!status?.loaded && !status.revoked;
        },
        sink: (e) => recorder.sink(declaration.service).emit(e),
      }),
    );
  }
  const mailboxes = new Map(
    scenario.mailboxes.map((m) => [
      m.party,
      new ScriptedMailbox(m.address, new MemoryStateStore(), m.replies),
    ]),
  );
  const datasets = new Map<string, LocalDatasetHolder>();
  for (const d of scenario.datasets) {
    const identity = required(parties.get(d.holder)).identity;
    datasets.set(
      d.holder,
      new LocalDatasetHolder({
        identity,
        key: required(sourceKeys.get(d.holder)),
        trust: await capabilityTrust(identity),
        store: new MemoryStateStore(),
        ledger: new MemoryLedger(),
        dataset: d.id,
        rows: d.rows,
        nonce: `fictional-public-fixture:${scenario.id}`,
        now: () => now().toISOString(),
        sink: (e) => recorder.sink(d.holder).emit(e),
      }),
    );
  }
  const queryGrants: Record<string, string> = {};
  for (const grant of scenario.queryGrants) {
    const reader = cast.get(grant.value.reader);
    queryGrants[grant.id] = await signStatement(
      required(sourceKeys.get(grant.holder)),
      "awp-query-grant+jws",
      {
        ...grant.value,
        type: "QueryGrant",
        issuer: required(parties.get(grant.holder)).identity,
        reader: { actor: reader.identity.actor, party: reader.identity.party },
      },
    );
  }
  const singleUseRegisters: Record<string, LocalSingleUseRegister> = {};
  const escrowAcceptances: string[] = [];
  for (const declaration of scenario.singleUseRegisters) {
    const identity = required(parties.get(declaration.party)).identity;
    const acceptanceParties = new Set(declaration.acceptances.map((a) => a.party));
    const registerTrust = await TrustStore.load({
      version: 1,
      owner: identity,
      sourceAuthority: [],
      keys: [
        ...agents.map((a) => {
          const key = cast.get(a.id).actorKey;
          return {
            kid: key.kid,
            alg: key.alg,
            publicJwk: key.publicJwk,
            role: "actor",
            subject: a.actor,
            party: required(parties.get(required(a.actsFor))).identity,
          };
        }),
        ...[...sourceKeys].map(([id, key]) => ({
          kid: key.kid,
          alg: key.alg,
          publicJwk: key.publicJwk,
          role: acceptanceParties.has(id) ? "party" : "issuer",
          subject: required(parties.get(id)).identity,
        })),
      ],
    });
    const items: SingleUseItem[] = declaration.items.map((i) => ({
      id: i.id,
      issuer: required(parties.get(i.issuer)).identity,
      state: i.state,
      redeemers: i.redeemers,
      purposes: i.purposes,
      ...(i.roleStatement
        ? {
            role: {
              jws: required(signed[i.roleStatement]).jws,
              source: required(i.roleSource),
              claimType: required(i.roleClaim),
            },
          }
        : {}),
      ...(i.escrow ? { escrow: i.escrow } : {}),
    }));
    singleUseRegisters[identity] = new LocalSingleUseRegister({
      identity,
      key: required(sourceKeys.get(declaration.party)),
      trust: registerTrust,
      store: new MemoryStateStore(),
      ledger: new MemoryLedger(),
      items,
      now: () => now().toISOString(),
      maxAgeSeconds: declaration.maxAgeSeconds,
      resolver,
      sink: (event) => recorder.sink(declaration.party).emit(event),
    });
    for (const acceptance of declaration.acceptances)
      escrowAcceptances.push(
        await signStatement(
          required(sourceKeys.get(acceptance.party)),
          "awp-escrow-acceptance+jws",
          {
            type: "EscrowAcceptance",
            issuer: required(parties.get(acceptance.party)).identity,
            item: acceptance.item,
            termsDigest: acceptance.termsDigest,
            issuedAt: now().toISOString(),
            validUntil: "2026-12-01T00:00:00.000Z",
          },
        ),
      );
  }
  let forum: LocalForum | undefined;
  if (profile.forum) {
    const declaration = profile.forum;
    const identity = required(parties.get(declaration.party)).identity;
    const trust = await TrustStore.load({
      version: 1,
      owner: identity,
      sourceAuthority: [],
      keys: [
        ...agents.map((a) => {
          const key = cast.get(a.id).actorKey;
          return {
            kid: key.kid,
            alg: key.alg,
            publicJwk: key.publicJwk,
            role: "actor",
            subject: a.actor,
            party: required(parties.get(required(a.actsFor))).identity,
          };
        }),
        ...[...sourceKeys].map(([id, key]) => ({
          kid: key.kid,
          alg: key.alg,
          publicJwk: key.publicJwk,
          role: "issuer",
          subject: required(parties.get(id)).identity,
        })),
      ],
    });
    forum = new LocalForum({
      identity,
      key: required(sourceKeys.get(declaration.party)),
      trust,
      store: new MemoryStateStore(),
      ledger: new MemoryLedger(),
      now: () => now().toISOString(),
      responseSeconds: declaration.responseSeconds,
      observers: declaration.observers,
      sink: (e) => recorder.sink(declaration.party).emit(e),
    });
  }
  const grants: Record<string, ResourceReference> = {};
  const holders = new Map<string, LocalResourceHolder>();
  for (const resource of scenario.resources) {
    const holder = required(parties.get(resource.holder));
    const key = required(sourceKeys.get(holder.id));
    const readerKeys = agents.map((a) => ({
      kid: cast.get(a.id).actorKey.kid,
      alg: cast.get(a.id).actorKey.alg,
      publicJwk: cast.get(a.id).actorKey.publicJwk,
      role: "actor" as const,
      subject: required(a.actor),
      party: required(parties.get(required(a.actsFor))).identity,
    }));
    const trust = await TrustStore.load({
      version: 1,
      owner: holder.identity,
      keys: [
        {
          kid: key.kid,
          alg: key.alg,
          publicJwk: key.publicJwk,
          role: "issuer",
          subject: holder.identity,
        },
        ...readerKeys,
      ],
      sourceAuthority: [],
    });
    const ledger = new MemoryLedger();
    const resources = Object.fromEntries(
      scenario.resources
        .filter((r) => r.holder === holder.id)
        .map((r) => [r.ref, r.statements.map((id) => required(signed[id]).statement)]),
    );
    holders.set(
      resource.ref,
      new LocalResourceHolder({
        identity: holder.identity,
        key,
        trust,
        resources,
        ...(resource.originals
          ? {
              originals: Object.fromEntries(
                resource.statements.map((id) => [
                  String(required(signed[id]).statement.id),
                  required(signed[id]).jws,
                ]),
              ),
            }
          : {}),
        ledger,
        now: () => now().toISOString(),
      }),
    );
  }
  for (const grant of scenario.grants) {
    const holder = required(parties.get(grant.holder));
    const reader = required(parties.get(grant.reader));
    const payload = {
      type: "ResourceGrant",
      id: `urn:grant:${scenario.id}:${grant.id}`,
      issuer: holder.identity,
      ref: grant.ref,
      reader: {
        actor: required(reader.actor),
        party: required(parties.get(required(reader.actsFor))).identity,
      },
      items: grant.statements.map((id) => ({
        id: String(required(signed[id]).statement.id),
        claimType: String(required(signed[id]).statement.claimType),
      })),
      purpose: grant.purpose,
      validUntil: grant.validUntil,
    };
    grants[grant.id] = {
      ref: grant.ref,
      claimTypes: [...new Set(payload.items.map((i) => i.claimType))],
      grant: await signStatement(
        required(sourceKeys.get(holder.id)),
        "awp-resource-grant+jws",
        payload,
      ),
    };
  }
  const stores = new Map(
    scenario.stores.map((s) => [s.id, new PurposeBoundStore(s.organization, s.roles, now)]),
  );
  const runtimes = new Map<string, AgentRuntime>();
  const jointParties = new Map<string, JointParty>();
  const jointKeys = new Map<
    string,
    Awaited<ReturnType<import("../derive/verifiers.js").JointProtocol["generateKeys"]>>
  >();
  let jointFixed: FixedJointSession | undefined;
  let jointParams: import("../derive/verifiers.js").SessionParams | undefined;
  if (scenario.jointSession && scenario.requiredMethods.includes(scenario.jointSession.method)) {
    const spec = scenario.jointSession,
      protocol = required(verifiers.jointProtocols.get(spec.method));
    for (const id of [...spec.contributors, ...spec.computeOnly])
      jointKeys.set(
        id,
        await protocol.generateKeys(new TextEncoder().encode(`engine/${scenario.id}/${id}`)),
      );
    jointParams = {
      sessionId: `urn:session:${scenario.id}:${path}`,
      statistic: spec.statistic,
      minimumGroup: spec.minimumGroup,
      minimumContributors: spec.minimumContributors,
      ...(spec.threshold ? { threshold: spec.threshold } : {}),
      roster: await Promise.all(
        [...spec.contributors, ...spec.computeOnly].map(async (id) => ({
          party: cast.get(id).identity.party ?? cast.get(id).identity.actor,
          publicKeys: required(jointKeys.get(id)).publicKeys,
          ...(spec.computeOnly.includes(id) ? { computeOnly: true } : {}),
          ...(protocol.kind === "real"
            ? {
                keyBinding: await signClaim(cast.get(id).ownerKey, {
                  id: `urn:binding:${scenario.id}:${id}`,
                  issuer: cast.get(id).identity.party,
                  subject: cast.get(id).identity.party,
                  claimType: "joint.keys",
                  method: "recorded-by-authority",
                  asOf: now().toISOString(),
                  value: {
                    publicKeys: required(jointKeys.get(id)).publicKeys,
                    computeOnly: spec.computeOnly.includes(id),
                  },
                }),
              }
            : {}),
        })),
      ),
    };
  }
  const ledgers = new Map<string, MemoryLedger>();
  let solidStep = "";
  let mirrorFault = false;
  let webIdDirectory: FictionalWebIdDirectory | FictionalDidDirectory | undefined;
  if (configuration.layers.identity === "did") {
    const provider = required(parties.get("did-resolver")),
      register = required(parties.get("did-register"));
    webIdDirectory = new FictionalDidDirectory(
      { identity: provider.identity, key: required(sourceKeys.get(provider.id)) },
      { identity: register.identity, key: required(sourceKeys.get(register.id)) },
      [...cast.agents.values()].map((p) => ({
        actor: p.identity.actor,
        party: p.identity.party,
        actorKey: p.actorKey,
        partyKey: p.ownerKey,
      })),
      () => now().toISOString(),
      { from: now().toISOString(), until: new Date(clock + 60 * 86400000).toISOString() },
    );
    await webIdDirectory.setup();
  }
  if (configuration.layers.identity === "webid") {
    const provider = required(parties.get("solid-provider")),
      register = required(parties.get("webid-register"));
    webIdDirectory = new FictionalWebIdDirectory(
      { identity: provider.identity, key: required(sourceKeys.get(provider.id)) },
      { identity: register.identity, key: required(sourceKeys.get(register.id)) },
      ["sam-agent", "north-agent"].map((id) => {
        const party = cast.get(id);
        return {
          actor: party.identity.actor,
          party: required(party.identity.party),
          actorKey: party.actorKey,
          partyKey: party.ownerKey,
        };
      }),
      () => now().toISOString(),
      { from: now().toISOString(), until: new Date(clock + 60 * 86400000).toISOString() },
    );
    await webIdDirectory.setup();
  }
  let recordMirror: PodRecordMirror | undefined;
  if (configuration.layers.accountability === "pod-mirror") {
    const provider = required(parties.get("solid-provider"));
    const owner = cast.get("sam-agent");
    recordMirror = new PodRecordMirror(
      new FictionalSolidStorage(
        new URL(provider.identity).origin,
        provider.identity,
        required(sourceKeys.get(provider.id)),
        () => now().toISOString(),
      ),
      owner.identity.actor,
      required(owner.identity.party),
      owner.actorKey,
      owner.ownerKey,
      () => required(ledgers.get("sam-agent")),
    );
    await recordMirror.setup();
  }
  const outputs: Record<string, unknown> = {};
  const queue: Array<{ from: string; out: OutboundMessage }> = [];
  const openings = new Map<string, unknown>();
  const responses = new Map<string, { reply?: unknown; agreementPlan?: unknown }>();
  const partyName = (party: Scenario["parties"][number]) => profile.parties[party.id] ?? party.name;
  const labels = new LabelIndex();
  for (const [iri, label] of Object.entries(profile.labels)) labels.add(iri, label);
  for (const operation of profile.operations) labels.add(operation.id, operation.label);
  for (const party of scenario.parties) {
    labels.add(party.identity, partyName(party));
    if (party.actor) labels.add(party.actor, partyName(party));
  }
  labels.add(`urn:scenario:${scenario.id}:task`, scenario.title);
  recorder.labels(labels, configuration.layers.meaning);
  const name = (iri: string | undefined) => {
    const party = scenario.parties.find((p) => p.identity === iri || p.actor === iri);
    return party ? partyName(party) : labels.name(iri);
  };
  const carriage = new ScenarioCarriage(
    scenario,
    configuration.layers.transport,
    (party) =>
      cast.agents.has(party) ? cast.get(party).actorKey : required(sourceKeys.get(party)),
    name,
    () => now().toISOString(),
    (party) => recorder.sink(parties.get(party)?.traceId ?? party),
  );
  const task = `urn:scenario:${scenario.id}:task`;
  const variables = (current?: HandlerContext) => ({
    steps: outputs,
    statements: Object.fromEntries(
      Object.entries(signed).map(([id, value]) => [
        id,
        { ...value, claimDigest: digestOf(value.statement) },
      ]),
    ),
    representations: Object.fromEntries(
      [...cast.agents].map(([id, agent]) => [id, agent.representationJws]),
    ),
    grants,
    grantDigests: Object.fromEntries(
      Object.entries(grants).map(([id, reference]) => [id, digestBytes(reference.grant)]),
    ),
    current,
    now: now().toISOString(),
  });
  const paymentLedgers = new Map(
    scenario.paymentProviders.map((provider) => {
      const ledger = new PaymentLedger();
      for (const account of provider.accounts) ledger.createAccount(account.id, account.balances);
      return [provider.agent, ledger] as const;
    }),
  );
  const settlement =
    configuration.layers.settlement === "rdf-order"
      ? selectedSettlement("rdf-order")
      : await liveSettlement({
          suite: configuration.layers.settlement,
          fault: scenario.settlementFault,
          cast,
          runtimes,
          ledger: required(paymentLedgers.get("payment-provider-agent")),
          now: () => now().toISOString(),
          recorder,
          configuration: configuration.pilotConfiguration,
        });
  recorder.settlement(settlement);
  for (const agent of agents) {
    cast.trust.set(agent.id, {
      ...required(cast.trust.get(agent.id)),
      controllers: scenario.trust.controllers,
    });
    const trust = await TrustStore.load(cast.trust.get(agent.id));
    const mandate = required(scenario.mandates.find((m) => m.agent === agent.id));
    const emailPins = profile.email
      ? await Promise.all(
          profile.email.pins.map((pin) =>
            signStatement(cast.get(agent.id).ownerKey, "awp-email-endpoint-pin+jws", {
              type: "EmailEndpointPin",
              issuer: cast.get(agent.id).identity.party,
              ...pin,
            }),
          ),
        )
      : [];
    const gate: GateContext = {
      ...(agentRegistry
        ? {
            agentRegistry: {
              check: async (actor, principal, kid, operation) => {
                if (actor !== cast.get("sam-agent").identity.actor) return undefined;
                const accepted = gate.resolver?.resolveSource({
                  evaluator: cast.get(agent.id).identity.actor,
                  source: agentRegistry.identity,
                  claimType: "authority.registration",
                  subject: principal,
                  at: now().toISOString(),
                });
                const checked = await agentRegistry.check({
                  actor,
                  principal,
                  kid,
                  operation,
                  trust,
                  accepted: accepted?.outcome === "accepted",
                });
                recorder.sink(agent.traceId ?? agent.id).emit({
                  part: "inbound-gate",
                  kind: "record",
                  caption: checked.ok
                    ? "The accepted registry's current signed entry names Sam as principal, binds the agent key and covers this operation."
                    : "The current registry entry does not establish authority for this operation.",
                  ...(accepted
                    ? {
                        resolution: {
                          question: accepted.question,
                          path: accepted.path.map((p) => ({ ...p })),
                          answer: accepted.answer,
                        },
                      }
                    : {}),
                  ...(checked.ok
                    ? {
                        fact: {
                          id: checked.entry.id,
                          label: "Current signed agent registration",
                          source: agentRegistry.identity,
                          subject: principal,
                          claimType: "authority.registration",
                          value: {
                            entry: checked.entry,
                            credential: checked.credential,
                            digest: checked.digest,
                          },
                        },
                      }
                    : {}),
                });
                return checked.ok ? undefined : checked.reason;
              },
            },
          }
        : {}),
      ...(authorizationServer && authorizationGrant
        ? {
            authorizationGrant: {
              outbound: () =>
                agent.id === "sam-agent" ? authorizationServer.current() : undefined,
              ...(agent.id === "sam-agent"
                ? {
                    load: async (source: string) => {
                      const checked = await authorizationServer.verify(authorizationGrant, {
                        trust,
                        actor: cast.get(agent.id).identity.actor,
                        party: cast.get(agent.id).identity.party,
                        kid: cast.get(agent.id).actorKey.kid,
                        audience: cast.get(agent.id).identity.actor,
                        accepted:
                          source === cast.get(agent.id).mandateJws &&
                          gate.resolver?.resolveSource({
                            evaluator: cast.get(agent.id).identity.actor,
                            source: authorizationServer.identity,
                            claimType: "authority.grant",
                            subject: cast.get(agent.id).identity.party,
                            at: now().toISOString(),
                          }).outcome === "accepted",
                      });
                      if (checked.ok)
                        recorder.sink(agent.traceId ?? agent.id).emit({
                          part: "record",
                          kind: "record",
                          caption:
                            "Sam approved at the fictional bank authorization server. Its signed authorization details are lifted into the autonomous and with-approval ODRL policies read by the gate.",
                          fact: {
                            id: checked.loaded.mandate.id,
                            label: "ODRL mandate lifted from the server grant",
                            claimType: "authority.grant-lift",
                            subject: cast.get(agent.id).identity.party,
                            source: authorizationServer.identity,
                            value: {
                              grantDigest: digestOf(authorizationGrant),
                              autonomous: checked.loaded.mandate.autonomous,
                              withApproval: checked.loaded.mandate.withApproval,
                            },
                          },
                        });
                      return checked;
                    },
                  }
                : {}),
              check: async (jws, actor, party, kid, operation) => {
                if (actor !== cast.get("sam-agent").identity.actor) return undefined;
                if (!jws) return "representation-invalid" as const;
                const accepted = gate.resolver?.resolveSource({
                  evaluator: cast.get(agent.id).identity.actor,
                  source: authorizationServer.identity,
                  claimType: "authority.grant",
                  subject: party,
                  at: now().toISOString(),
                });
                const checked = await authorizationServer.verify(jws, {
                  trust,
                  actor,
                  party,
                  kid,
                  audience: cast.get(agent.id).identity.party,
                  accepted: accepted?.outcome === "accepted",
                });
                recorder.sink(agent.traceId ?? agent.id).emit({
                  part: "inbound-gate",
                  kind: "record",
                  caption: checked.ok
                    ? "The accepted authorization server binds the principal, the explicit actor and the actor key to the lifted permissions."
                    : "The authorization grant does not establish the required principal, actor and key binding.",
                  ...(accepted
                    ? {
                        resolution: {
                          question: accepted.question,
                          path: accepted.path.map((p) => ({ ...p })),
                          answer: accepted.answer,
                        },
                      }
                    : {}),
                });
                if (!checked.ok) return checked.reason;
                return [
                  checked.loaded.mandate.autonomous,
                  checked.loaded.mandate.withApproval,
                ].some((p) => p.permissions?.some((r) => r.target === operation))
                  ? undefined
                  : ("representation-invalid" as const);
              },
            },
          }
        : {}),
      ...(mandateLists
        ? {
            mandateCredential: {
              outbound: () => (agent.id === "sam-agent" ? mandateLists.current() : undefined),
              check: async (jws, actor, party, kid) => {
                if (actor !== cast.get("sam-agent").identity.actor) return undefined;
                if (!jws) return "representation-invalid";
                const checked = await verifyStatement(jws, {
                  trust,
                  typ: TYP.mandate,
                  role: "party",
                  schema: mandateSchema,
                  limits: DEFAULT_LIMITS,
                  verifier: agent.actor ?? agent.identity,
                  at: now().toISOString(),
                });
                const m = checked.payload
                  ? (EmbeddedCredentialNode.fromJws(jws, "urn:awp:checked-mandate", new Store())
                      .payload as unknown as OwnerMandate)
                  : undefined;
                if (
                  !m ||
                  checked.verification.outcome !== "valid" ||
                  checked.signer?.subject !== party ||
                  m.issuer !== party ||
                  m.subject !== actor ||
                  m.actorKid !== kid ||
                  !m.credentialStatus ||
                  Date.parse(m.validFrom) > clock ||
                  Date.parse(m.validUntil) <= clock
                )
                  return "representation-invalid";
                const failure = await mandateLists.check(m.credentialStatus);
                recorder.sink(agent.traceId ?? agent.id).emit({
                  part: "inbound-gate",
                  kind: "record",
                  caption: failure
                    ? "The principal-signed mandate status list does not authorize this action."
                    : "Both principal-signed mandate status lists are current and clear before this action takes effect.",
                });
                return failure;
              },
            },
          }
        : {}),
      ...(webIdDirectory ? { webId: webIdDirectory } : {}),
      ...(agent.id === "sam-agent" && recordMirror
        ? {
            recordMirror: {
              flush: async () => {
                if (
                  scenario.solid?.fault === "mirror-unreachable" &&
                  solidStep === scenario.solid.at &&
                  !mirrorFault
                ) {
                  recordMirror.storage.available = false;
                  mirrorFault = true;
                }
                return recordMirror.flush();
              },
              ...(scenario.solid?.fault === "mirror-unreachable"
                ? {
                    recover: async () => {
                      recordMirror.storage.available = true;
                      recorder.sink(agent.traceId ?? agent.id).emit({
                        part: "transport",
                        kind: "record",
                        caption:
                          "The fictional independent storage provider returns; the waiting action retries its record write before release.",
                      });
                    },
                  }
                : {}),
            },
          }
        : {}),
      ...(indexLog && agent.id === indexSettings?.reader ? { trustedIndex: indexLog.policy } : {}),
      ...(configuration.id === "authenticity-selective-disclosure"
        ? { selectiveAnnual: true }
        : {}),
      ...(originDirectory
        ? {
            originHosted: new OriginHostedVerifier(
              originDirectory.register.identity,
              originDirectory.fetch,
              recorder.sink(agent.traceId ?? agent.id),
            ),
          }
        : {}),
      ...verifiers,
      acceptedProofs: profile.acceptedProofs,
      acceptedJoint: profile.acceptedJoint,
      proofIssuerKeys,
      proofCredentials,
      proofDatasets,
      proofStatusPolicy,
      proofCache: options.proofCache,
      generateProofs: options.generateProofs,
      ...(profile.codeMappings?.receivers.includes(agent.actor ?? "")
        ? { codeMappings: { policy: profile.codeMappings, resolver } }
        : {}),
      ...(configuration.layers.meaning === "registry-lookup" &&
      scenario.registryMeaning?.policy.receivers.includes(agent.actor ?? "")
        ? { registryMeaning: { settings: scenario.registryMeaning, resolver } }
        : {}),
      ...(profile.email
        ? {
            email: {
              from: profile.email.from,
              structuredReply: profile.email.structuredReply,
              pins: emailPins,
            },
          }
        : {}),
      configuration: agent.configurations[0] === "public-read" ? PUBLIC_READ : configuration,
      ...(agreementStatus
        ? {
            agreementCredential: new AgreementCredentialProtocol(
              agreementStatus,
              scenario.agreementCredentialFault === "one-proof-missing",
            ),
          }
        : {}),
      ...(configuration.layers["usage-control"] === "odrl-model-tighten"
        ? { usageModel: new FixedUsageModel() }
        : {}),
      configurations: {
        [CONFIG_PUBLIC]: PUBLIC_READ,
        [BASELINE.pilotConfiguration]: BASELINE,
        [configuration.pilotConfiguration]: configuration,
      },
      ...(profile.authorityChains
        ? { authorityChains: { policy: profile.authorityChains, resolver } }
        : {}),
      ...(profile.singleUse.length
        ? {
            singleUse: {
              actions: profile.singleUse,
              registers: singleUseRegisters,
              evidence: Object.values(signed).map((s) => s.jws),
              acceptances: escrowAcceptances,
            },
          }
        : {}),
      ...(profile.organizations
        ? { organizations: { policy: profile.organizations, resolver } }
        : {}),
      sink: matrixSink(recorder.sink(agent.traceId ?? agent.id), configuration, name),
      taskId: task,
      name,
      taskLabel: (operation) =>
        profile.operations.find((op) => op.id === operation)?.label ?? labels.name(operation),
      vocabulary:
        configuration.id === "authenticity-selective-disclosure"
          ? {
              ...Object.fromEntries(
                Object.entries(profile.vocabulary).map(([key, value]) => [
                  key,
                  value.values?.includes("income.gross.monthly-series")
                    ? {
                        ...value,
                        values: [
                          ...value.values,
                          "income.gross.annual",
                          "income.national-insurance",
                        ],
                      }
                    : value,
                ]),
              ),
              "terms.evidenceRequest.*.optional": { type: "code", values: [true] },
            }
          : profile.vocabulary,
      identifiers: profile.identifiers,
      sourceAliases: profile.sources,
      attestedDerivers: profile.attestedDerivers,
      rules: profile.rules.filter((r) => "template" in r),
      assessments: profile.assessments,
      personDecisions: profile.personDecisions,
      readings: profile.readings,
      actionClaims: profile.actionClaims,
      termsAcceptance: profile.termsAcceptance[agent.actor ?? ""],
      personMayRelyOn: profile.personMayRelyOn,
      requester: scenario.requester[agent.id],
      referenceAction: profile.referenceAction,
      agreementDeadlineSeconds: profile.agreementDeadlineSeconds,
      notificationRecipients: profile.notificationRecipients,
      trust: profile.trust,
      pins: (scenario.trust.ownLists[agent.id] ?? [])
        .filter((entry) => !entry.block)
        .flatMap((entry) => {
          const peer = agents.find((p) => parties.get(p.actsFor ?? "")?.identity === entry.party);
          if (!peer) return [];
          return (entry.purposes ?? []).map((purpose) => ({
            party: entry.party,
            purpose,
            kid: cast.get(peer.id).actorKey.kid,
            expiresAt: entry.expiresAt ?? "1970-01-01T00:00:00Z",
          }));
        }),
      claimSources: Object.fromEntries(profile.claims.map((c) => [c.kind, c.sources])),
      ...(negotiated && deliberation && agent.id === negotiated.proposer
        ? {
            negotiatedMeaning: {
              operation: negotiated.operation,
              term: negotiated.term,
              approved: (
                exchange: string,
                principal: string | undefined,
                peer: string | undefined,
                at: string,
              ) =>
                deliberation.approved(
                  exchange,
                  principal,
                  peer,
                  at,
                  trust,
                  cast.get(agent.id).identity.actor,
                ),
            },
          }
        : {}),
      ...(configuration.layers.reliance === "quality-certificate" &&
      scenario.qualityCertificate?.references[agent.actor ?? ""]
        ? {
            qualityCertificate: {
              policy: scenario.qualityCertificate,
              reference: scenario.qualityCertificate.references[agent.actor ?? ""]!,
              resolver,
            },
          }
        : {}),
      ...(configuration.layers.reliance === "stated-confidence" &&
      scenario.statedConfidence?.receivers.includes(agent.actor ?? "")
        ? { statedConfidence: scenario.statedConfidence }
        : {}),
      ...(configuration.layers.reliance === "corroboration" &&
      scenario.relianceCorroboration?.receivers.includes(agent.actor ?? "")
        ? { incomeCorroboration: scenario.relianceCorroboration }
        : {}),
      purposes: Object.fromEntries(
        profile.purposes.map((p) => [
          p.id,
          configuration.id === "authenticity-selective-disclosure" &&
          p.claims.includes("income.gross.monthly-series")
            ? [
                ...p.claims.filter((kind) => kind !== "income.gross.monthly-series"),
                "income.gross.annual",
              ]
            : p.claims,
        ]),
      ),
      reliance: {
        id: `urn:profile:${profile.id}`,
        rules: profile.claims.map((c) => ({
          id: `urn:profile:${profile.id}:${c.kind}`,
          claimType: c.kind,
          methods: c.methods,
          maxAgeDays: c.maxAgeDays,
          ...(c.precedence ? { precedence: c.precedence } : {}),
          ...(c.corroboration ? { corroboration: c.corroboration } : {}),
          ...(c.completeness ? { completeness: c.completeness } : {}),
          text: `Accept ${c.kind} from ${c.sources.join(", ")} by ${c.methods.join(", ")}, at most ${c.maxAgeDays} days old.`,
        })),
      },
      resolver: new TrustResolver({
        principal: name(cast.get(agent.id).identity.party),
        trust,
        ownList: scenario.trust.ownLists[agent.id],
        root: scenario.trust.root,
        ownListOnly: configuration.id === "trust-pinned-list",
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
    if (federationSettings && federationPresentation) {
      if (agent.actsFor === federationSettings.subject || agent.id === federationSettings.index)
        Object.assign(gate, { supplementaryEvidence: federationPresentation });
      if (agent.id === federationSettings.reader) {
        const anchor = required(sourceKeys.get(federationSettings.anchor));
        const federationResolver = new PresentedFederationResolver(
          {
            principal: name(cast.get(agent.id).identity.party),
            trust,
            ownList: scenario.trust.ownLists[agent.id],
            root: scenario.trust.root,
            name,
          },
          {
            anchor: required(parties.get(federationSettings.anchor)).identity,
            keys: [publicPart(anchor)],
            subject: required(parties.get(federationSettings.subject)).identity,
            purpose: federationSettings.purpose,
            claimTypes: federationSettings.claimTypes,
            expectedSubjectKey: required(sourceKeys.get(federationSettings.subject)).kid,
          },
        );
        Object.assign(gate, { federation: federationResolver, resolver: federationResolver });
      }
    }
    if (reputationSettings) {
      if (
        agent.id === reputationSettings.index ||
        reputationSettings.ratings.some((rating) => rating.agent === agent.id)
      )
        Object.assign(gate, { supplementaryEvidence: ratingEvidence });
      if (agent.id === reputationSettings.reader) {
        const reputationResolver = new ReputationResolver(
          {
            principal: name(cast.get(agent.id).identity.party),
            trust,
            ownList: scenario.trust.ownLists[agent.id],
            root: scenario.trust.root,
            name,
          },
          {
            service: required(parties.get(reputationSettings.service)).identity,
            minimum: reputationSettings.minimum,
            targets: reputationSettings.ratings.map((rating) => ({
              party: required(parties.get(rating.party)).identity,
              actor: cast.get(rating.agent).identity.actor,
              kid: cast.get(rating.agent).actorKey.kid,
            })),
          },
          trust,
          cast.get(agent.id).identity.actor,
        );
        Object.assign(gate, { reputation: reputationResolver, resolver: reputationResolver });
      }
    }
    const specialised: OperationHandler[] = agent.handlers.length
      ? agent.handlers.map((id) => {
          const handler = withNegotiatedRequirement(
            withEmploymentRequirement(
              indexLog && agent.actsFor === indexSettings?.index
                ? withIndexReceipts(
                    installHandler(required(scenario.handlerImplementations[id]), signed, stores),
                    indexLog.receipts,
                  )
                : installHandler(required(scenario.handlerImplementations[id]), signed, stores),
              configuration.layers.meaning === "registry-lookup" && agent.id === "north-agent"
                ? scenario.registryMeaning
                : undefined,
            ),
            agent.id === negotiated?.peer ? negotiated : undefined,
          );
          return options.alternative
            ? withScriptedReplies(handler, (context) => {
                const proposal = responses.get(agent.id)?.reply;
                return proposal
                  ? (resolveTemplate(proposal, variables(context)) as HandlerReply)
                  : undefined;
              })
            : handler;
        })
      : [];
    const handlers: OperationHandler[] = [
      ...specialised,
      ...profile.operations
        .filter(
          (op) =>
            !specialised.some(
              (h) => h.description.id === op.id && h.description.version === op.version,
            ),
        )
        .map<OperationHandler>((op) => {
          const reply = (ctx: HandlerContext): HandlerReply =>
            resolveTemplate(
              responses.get(agent.id)?.reply ?? { type: "none" },
              variables(ctx),
            ) as HandlerReply;
          const intent = (ctx: HandlerContext, contents: JsonObject): ActionIntent => {
            if (["urn:op:erasure-request", "urn:op:general-notice"].includes(op.id))
              return {
                action: "use",
                operation: op.id,
                target: op.id,
                recipient: ctx.peer.party,
                purpose: "urn:purpose:duties",
                parameters: contents,
                conversation: ctx.conversation.id,
              };
            if (op.id === "urn:op:duty-notification")
              return {
                action: "use",
                operation: op.id,
                target: op.id,
                recipient: ctx.peer.party,
                purpose: "urn:purpose:emergency-notification",
                parameters: contents,
                conversation: ctx.conversation.id,
              };
            if (op.id === "urn:op:payment-request")
              return {
                action: "use",
                operation: op.id,
                target: op.id,
                recipient: ctx.peer.party,
                purpose: typeof contents.purpose === "string" ? contents.purpose : op.purposes[0],
                conversation: ctx.conversation.id,
                parameters: contents,
              };
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
            onInvoke: async (ctx, _body, evidence) => {
              if (JOINT_OPERATIONS.includes(op.id) && jointParties.has(agent.id)) {
                const envelope = evidence
                  .map(unverifiedEvidenceClaim)
                  .find((c) => c.claimType === "joint.message");
                if (!envelope || envelope.issuer !== ctx.peer.party)
                  return { type: "refuse", reason: "derivation-not-verified" };
                const accepted = await required(jointParties.get(agent.id)).receive(
                  ctx,
                  op.id,
                  envelope.value as JsonObject,
                );
                return accepted.ok
                  ? { type: "none" }
                  : {
                      type: "refuse",
                      reason: (accepted.reason ??
                        "derivation-not-verified") as import("../core/types.js").ReasonCode,
                    };
              }
              return reply(ctx);
            },
            onDeliver: reply,
            onReceipt: reply,
            onAgreement: (ctx, agreement) =>
              resolveTemplate(responses.get(agent.id)?.agreementPlan ?? { requiredOutcomes: [] }, {
                ...variables(ctx),
                agreement,
              }) as AgreementPlan,
          };
        }),
    ];
    const created = await cast.runtime(
      agent.id,
      handlers.map((handler) =>
        withMappingVocabulary(
          handler,
          configuration.layers.meaning === "registry-lookup" &&
            scenario.registryMeaning?.policy.receivers.includes(agent.actor ?? "")
            ? scenario.registryMeaning
            : undefined,
        ),
      ),
      [
        new SyntheticPaymentRail(),
        ...(scenario.paymentProviders.some((p) => p.agent === agent.id)
          ? [
              {
                id: "urn:adapter:rdf-order",
                bindsParameters: true,
                execute: async (_key: string, params: JsonObject) => {
                  const provider = required(
                    scenario.paymentProviders.find((p) => p.agent === agent.id),
                  );
                  const admitted = await required(runtimes.get(agent.id)).receivedPaymentOrder(
                    String(params.message),
                  );
                  const account = required(
                    provider.accounts.find((a) => a.party === admitted.payer),
                  );
                  const suite = selectedSettlement(configuration.layers.settlement, settlement);
                  const settled = await suite.settle(admitted.objects, {
                    party: cast.get(agent.id).identity.party ?? "",
                    payerAccount: account.id,
                    ledger: required(paymentLedgers.get(agent.id)),
                    now: now().toISOString(),
                  });
                  const receipt = suite.lift(settled);
                  const trace = suite.trace
                    ? await suite.trace(settled)
                    : await paymentTrace(receipt);
                  recorder.sink(agent.traceId ?? agent.id).emit({
                    part: "record",
                    kind: "record",
                    caption: "The fictional provider records the ledger transfer and its receipt.",
                    settlement: trace,
                  });
                  return {
                    conclusion: "completed" as const,
                    observed: {
                      payment: suite.id === "rdf-order" ? trace.facts : carry(settled),
                      reference: receipt.ledgerReference ?? "",
                      status: "settled",
                    } as JsonObject,
                  };
                },
                reconcile: async () => ({
                  conclusion: "not-executed" as const,
                  reason: "No provider order was attempted.",
                }),
              },
            ]
          : []),
        {
          id: "urn:scenario:email",
          plainTextEmail: true,
          bindsParameters: true,
          execute: async (key: string, params: JsonObject) => {
            const mailbox = required([...mailboxes.values()].find((m) => m.address === params.to));
            return { conclusion: "completed" as const, observed: mailbox.deliver(key, params) };
          },
          reconcile: async (key: string) => {
            const message = [...mailboxes.values()]
              .flatMap((m) => m.inbox())
              .find((m) => m.id === key);
            return message
              ? { conclusion: "completed" as const, observed: { digest: digestOf(message) } }
              : {
                  conclusion: "not-executed" as const,
                  reason: "the local mailbox has no such message",
                };
          },
        },
        {
          id: "urn:scenario:dataset",
          bindsParameters: true,
          execute: async (_key: string, params: JsonObject) => {
            const answer = await required(datasets.get(String(params.holder))).query(
              String(params.request),
            );
            capabilityAnswers[String(params.request)] = answer;
            return {
              conclusion: "completed" as const,
              observed: JSON.parse(JSON.stringify(answer)) as JsonObject,
            };
          },
          reconcile: async () => ({
            conclusion: "uncertain" as const,
            reason: "a saved query counter is never rolled back",
          }),
        },
        {
          id: "urn:scenario:agreement-presentation",
          bindsParameters: true,
          execute: async (_key: string, params: JsonObject) => {
            const service = required(agreementServices.get(String(params.service))),
              receiver = String(params.receiver),
              receiverActor = cast.get(receiver).identity.actor;
            const answer = await verifyAgreementCredential(
              params.credential as unknown as AgreementCredential,
              {
                identity: receiverActor,
                trust: await capabilityTrust(receiverActor),
                ledger: required(ledgers.get(receiver)),
                now: () => now().toISOString(),
                sink: (e) => recorder.sink(receiver).emit(e),
                presenter: String(params.presenter),
                presentation: String(params.presentation),
                request: params.request as { asset: string; purpose: string; at: string },
                resolve: async (ref) =>
                  ref === service.options.identity ? service.status() : undefined,
              },
            );
            capabilityAnswers[String(params.presentation)] = answer;
            return {
              conclusion: "completed" as const,
              observed: JSON.parse(JSON.stringify(answer)) as JsonObject,
            };
          },
          reconcile: async () => ({
            conclusion: "uncertain" as const,
            reason: "verify credential status again",
          }),
        },
        {
          id: "urn:scenario:agreement",
          bindsParameters: true,
          execute: async (_key: string, params: JsonObject) => {
            const service = required(agreementServices.get(String(params.service)));
            const answer = await service.request(String(params.request));
            capabilityAnswers[String(params.request)] = answer;
            return {
              conclusion: "completed" as const,
              observed: JSON.parse(JSON.stringify(answer)) as JsonObject,
            };
          },
          reconcile: async () => ({
            conclusion: "uncertain" as const,
            reason: "consult agreement state",
          }),
        },
        ...(forum
          ? [
              {
                id: "urn:scenario:forum",
                releasesRecord: true,
                execute: async (_key: string, params: JsonObject) => {
                  const result =
                    params.operation === "submit"
                      ? await required(forum).submit(String(params.request))
                      : await required(forum).answer(String(params.request));
                  return {
                    conclusion: "completed" as const,
                    observed: JSON.parse(JSON.stringify(result)) as JsonObject,
                  };
                },
                reconcile: async () => ({
                  conclusion: "uncertain" as const,
                  reason: "consult the durable forum case before another submission",
                }),
              },
            ]
          : []),
        {
          id: "urn:scenario:effect",
          execute: async (_key, params) => ({ conclusion: "completed", observed: params }),
          reconcile: async () => ({
            conclusion: "not-executed",
            reason: "no synthetic effect recorded",
          }),
        },
      ],
      advertisedConfigurations(agent.configurations, configuration),
      {
        gates: gate,
        settlement,
        ...(settlement.id !== "rdf-order"
          ? {
              settlementReceiptSource:
                settlement.id === "ap2"
                  ? PROCESSOR
                  : cast.get("payment-provider-agent").identity.party,
            }
          : {}),
        ...(options.alternative && "transport" in options.alternative.change
          ? { bindings: carriage.advertisements(agent.id) }
          : {}),
        ...(profile.forum ? { limits: RECORD_LIMITS } : {}),
        ...(scenario.requiredMethods.length ? { limits: DERIVATION_LIMITS } : {}),
        disclosureChecks: Object.fromEntries(
          scenario.stores.map((store) => [
            `${PURPOSE_STORE_RELEASE_CONDITION}/${store.id}`,
            purposeStoreReleaseCheck(required(stores.get(store.id))),
          ]),
        ),
        ...(scenario.authorityChains[agent.id]
          ? {
              authorityChainJws: JSON.stringify(
                required(scenario.authorityChains[agent.id]).map((chain) =>
                  chain.map((id) => required(authorityLinks[id])),
                ),
              ),
            }
          : {}),
        ...(organizationCredentials[agent.id]
          ? { organizationMandateJws: organizationCredentials[agent.id] }
          : {}),
        ...(profile.rules.some(
          (r) =>
            "template" in r &&
            (r.assurances.includes("by-source") ||
              r.assurances.includes("attested") ||
              r.assurances.includes("joint")),
        )
          ? { sourceKey: cast.get(agent.id).ownerKey }
          : {}),
        core: {
          id: "urn:agent-reference:scripted-core",
          version: digestOf(scenario),
          kind: "scripted",
        },
      },
    );
    runtimes.set(agent.id, created.runtime);
    ledgers.set(agent.id, created.ledger);
  }
  if (jointParams && scenario.jointSession) {
    const spec = scenario.jointSession,
      protocol = required(verifiers.jointProtocols.get(spec.method));
    const { sessionId, ...params } = jointParams;
    const made =
      protocol.kind === "real"
        ? await required(runtimes.get(spec.requester)).newJointSession(spec.method, params)
        : await protocol.newSession({ ...params, sessionId });
    jointFixed = {
      method: spec.method,
      rule: spec.rule,
      session: made.session,
      ruleDigest: made.ruleDigest,
      purpose: spec.purpose,
      assurances: ["joint"],
    };
    for (const agent of agents) {
      if (!(await required(runtimes.get(agent.id)).acceptJointSession(jointFixed)))
        throw new Error("source-not-accepted: aggregate roster key binding");
      const spec = scenario.jointSession;
      jointParties.set(
        agent.id,
        new JointParty({
          party: cast.get(agent.id).identity.party ?? "",
          requester: cast.get(spec.requester).identity.party ?? "",
          protocol: required(verifiers.jointProtocols.get(spec.method)),
          secretKeys: jointKeys.get(agent.id)?.secretKeys ?? {},
          fixed: jointFixed,
          runtime: () => required(runtimes.get(agent.id)),
          store: new MemoryStateStore(),
          inputs: (spec.inputs[agent.id] ?? []).map((id) =>
            String(required(signed[id]).statement.id),
          ),
          purpose: spec.purpose,
          recipient: cast.get(spec.requester).identity.party ?? "",
        }),
      );
    }
  }
  const outsideSystems = new Map<string, Map<string, JsonObject>>();
  const enqueue = (from: string, result: StepResult) => {
    for (const out of result.outbound) queue.push({ from, out });
  };
  for (const [index, step] of scenario.script.entries()) {
    if (agreementStatus) await agreementStatus.refresh();
    solidStep = step.id;
    if (authorizationServer) await authorizationServer.refreshStatus();
    if (mandateLists) {
      if (scenario.mandateStatusFault?.at === step.id) {
        await mandateLists.set(scenario.mandateStatusFault.purpose, true);
        recorder.sink(parties.get("sam-agent")?.traceId ?? "sam-agent").emit({
          part: "principal",
          kind: "record",
          caption:
            "Sam suspends the mandate. The principal signs and republishes the status list before the next action.",
        });
        if (scenario.mandateStatusFault.attempt) {
          const attempted = resolveTemplate(
            scenario.mandateStatusFault.attempt,
            variables(),
          ) as ActionIntent;
          await required(runtimes.get("sam-agent")).runTask({
            taskId: `urn:scenario:${scenario.id}:suspended-action`,
            kind: "application",
            plan: {
              adapter: "urn:scenario:effect",
              key: `urn:scenario:${scenario.id}:suspended-action`,
              activityType: "urn:activity:application",
              intent: attempted,
              params: {},
            },
          });
        }
      }
      await mandateLists.refresh();
    }
    if (
      webIdDirectory &&
      scenario.solid?.fault === "profile-key-swapped" &&
      step.id === scenario.solid.at
    ) {
      if (!(webIdDirectory instanceof FictionalWebIdDirectory))
        throw new Error("Wrong profile resolver");
      await webIdDirectory.swapProfile(
        cast.get("north-agent").identity.actor,
        await testKey("fictional-profile-takeover"),
      );
      recorder.sink(parties.get(step.agent)?.traceId ?? step.agent).emit({
        part: "transport",
        kind: "record",
        caption:
          "The fictional profile host was taken over and now publishes a different lender key. The register commitment remains unchanged.",
      });
    }
    recorder.step(step.atStep ?? index + 1);
    if (step.segment === "added") {
      // Brief 31: only a configuration's own patch opens an added segment.
      if (!options.alternative)
        throw new Error(`step ${step.id}: an added segment needs a configuration`);
      recorder.segment("added", options.alternative.id);
    } else if (step.segment) recorder.segment("payment");
    const runtime = runtimes.get(step.agent);
    if (!runtime) throw new Error(`step ${step.id}: ${step.agent} does not run an agent`);
    const template = <T>(v: unknown) => resolveTemplate(v, variables()) as T;
    let result: unknown;
    switch (step.type) {
      case "term-deliberation": {
        if (!negotiated || !deliberation || step.agent !== negotiated.proposer)
          throw new Error("No negotiated meaning platform is installed for this proposer.");
        const exchange = template<string>(step.exchange);
        const proposer = cast.get(negotiated.proposer),
          peer = cast.get(negotiated.peer);
        const proposal = {
          type: "TermProposal",
          issuer: proposer.identity.actor,
          term: negotiated.term,
          definition: negotiated.definition,
          version: negotiated.version,
          exchange,
          principals: [proposer.identity.party!, peer.identity.party!],
        };
        const proposalJws = await signStatement(
          proposer.actorKey,
          "awp-term-proposal+jws",
          proposal,
        );
        const acceptanceJws = await signStatement(peer.actorKey, "awp-term-agent-acceptance+jws", {
          type: "TermAgentAcceptance",
          issuer: peer.identity.actor,
          proposalDigest: digestOf(proposal),
          exchange,
        });
        const approvals =
          step.decision === "approve"
            ? await Promise.all(
                [proposer, peer].map((party) =>
                  signStatement(party.ownerKey, "awp-term-approval+jws", {
                    type: "TermApproval",
                    issuer: party.identity.party!,
                    proposalDigest: digestOf(proposal),
                    exchange,
                    term: negotiated.term,
                    decision: "approve",
                    validUntil: step.validUntil,
                  }),
                ),
              )
            : [];
        result = {
          receipt: await deliberation.record(proposalJws, acceptanceJws, approvals),
          proposalDigest: digestOf(proposal),
        };
        break;
      }
      case "payment-invoice": {
        const digest = template<string>(step.agreement);
        const agreement = required(runtime.heldPaymentAgreement(digest));
        const suite = selectedSettlement(configuration.layers.settlement, settlement);
        const invoiceId = await runtime.mintIdentifier();
        let objects = await suite.request(
          {
            agreement,
            invoice: invoiceId,
            account: step.account,
            dueDate: step.dueDate,
            ...(suite.id !== "rdf-order" && step.amount ? { amount: step.amount } : {}),
          },
          { party: cast.get(step.agent).identity.party ?? "" },
        );
        let facts = suite.lift(objects);
        if (suite.id === "rdf-order" && (step.amount || step.payee)) {
          facts = PaymentFacts.invoiceFor({
            id: invoiceId,
            agreement: digest,
            account: step.account,
            amount: step.amount ?? required(facts.amount),
            currency: required(facts.currency),
            payee: step.payee ?? required(facts.payee),
            dueDate: step.dueDate,
          });
          objects = await paymentObjects(facts, "Invoice");
        }
        const trace = suite.trace ? await suite.trace(objects) : await paymentTrace(facts);
        recorder.sink(parties.get(step.agent)?.traceId ?? step.agent).emit({
          part: "core",
          kind: "propose",
          caption: "The payee proposes the invoice under the accepted agreement.",
          settlement: trace,
        });
        result = {
          document: suite.id === "rdf-order" ? objects.objects[0]?.shown : carry(objects),
          agreement: digest,
          amount: facts.amount,
          currency: facts.currency,
          payee: facts.payee,
          account: facts.account,
          reference: facts.id,
        };
        break;
      }
      case "answer-price":
        result = await runtime.reportPrice(step.statement);
        break;
      case "facts":
        result = runtime.admittedStatements();
        break;
      case "email-send":
        result = await runtime.sendEmail({
          taskId: `urn:scenario:${scenario.id}:${step.id}`,
          adapter: "urn:scenario:email",
          to: required(mailboxes.get(step.mailbox)).address,
          text: step.text,
          purpose: step.purpose,
        });
        break;
      case "email-receive": {
        const reply = required(mailboxes.get(step.mailbox)).reply(step.index);
        result = await runtime.receiveEmail({
          ...reply,
          ...(step.from ? { from: step.from } : {}),
          purpose: step.purpose,
        });
        break;
      }
      case "email-inbox":
        result = required(mailboxes.get(step.mailbox)).inbox();
        break;
      case "dataset-query": {
        const actor = cast.get(step.agent),
          holder = required(datasets.get(step.holder));
        const request = await signStatement(actor.actorKey, "awp-dataset-query+jws", {
          type: "DatasetQuery",
          id: `urn:query:${scenario.id}:${step.id}`,
          actor: actor.identity.actor,
          party: actor.identity.party,
          representation: actor.representationJws,
          at: now().toISOString(),
          grant: required(queryGrants[step.grant]),
          purpose: step.purpose,
          protocol: step.protocol,
        });
        const params = { holder: step.holder, request };
        await runtime.runTask({
          taskId: `urn:scenario:${scenario.id}:${step.id}`,
          kind: "dataset-query",
          plan: {
            adapter: "urn:scenario:dataset",
            key: `urn:scenario:${scenario.id}:${step.id}`,
            params,
            activityType: "urn:activity:dataset-query",
            intent: {
              action: "use",
              target: "urn:op:dataset-query",
              operation: "urn:op:dataset-query",
              recipient: holder.options.identity,
              purpose: step.purpose,
              conversation: `urn:scenario:${scenario.id}:${step.id}`,
              parameters: params,
            },
          },
        });
        result = capabilityAnswers[request] ?? null;
        break;
      }
      case "proof-request":
        {
          const request = runtime.issueDerivationRequest(step);
          result = {
            request,
            ...(await runtime.protocolStatement(
              "derivation.request",
              request as unknown as JsonObject,
              step.purpose,
            )),
          };
        }
        break;
      case "prove":
        result = await runtime.proveDerived({
          ...step,
          request: template<DerivedRequest>(step.request),
          inputs: step.inputs.map((id) => String(required(signed[id]).statement.id)),
        });
        break;
      case "joint-action": {
        const party = required(jointParties.get(step.agent));
        if (step.action === "contribute") {
          const made = await party.contribute();
          if (made.ok && step.attack === "unsigned") {
            if (party.options.protocol.kind === "real")
              made.contribution.signature = Buffer.alloc(64, 0xa5).toString("base64url");
            else delete made.contribution.signature;
          }
          if (made.ok && step.attack === "off-roster") made.contribution.signature = "off-roster";
          result = made;
        } else if (step.action === "partial") result = await party.partial();
        else {
          const finished = await party.finish();
          result = finished;
          if (finished.ok && scenario.jointSession && jointFixed) {
            const record = {
              method: scenario.jointSession.method,
              session: jointFixed.session,
              outcome: finished.outcome,
              contributions: finished.contributions,
              parties: (jointFixed.session.roster as JsonObject[]).map((p) => p.party),
              assumption: party.options.protocol.assumption,
            } as unknown as JsonObject;
            result = {
              ...finished,
              ...(await runtime.jointResult(scenario.jointSession.rule, record)),
            };
          }
        }
        break;
      }
      case "joint-send": {
        const peer = required(parties.get(step.peer)),
          operation = `urn:op:joint:${step.operation}`,
          spec = required(scenario.jointSession);
        let payload = template<JsonObject>(step.payload);
        if (step.operation === "partial" && jointFixed?.session.wire) {
          const p = payload.partial as JsonObject;
          const recipient = (jointFixed.session.roster as JsonObject[]).findIndex(
            (r) => r.party === cast.get(step.peer).identity.party,
          );
          const message = (p.messages as JsonObject[] | undefined)?.find(
            (m) => m.recipient === recipient,
          );
          if (recipient < 0 || !message)
            throw new Error("source-not-accepted: private partial recipient");
          payload = { ...payload, partial: { party: String(p.party), message } };
        }
        const input: JsonObject = {
          sessionId: required(jointFixed).session.sessionId as string,
          ...(step.operation === "open"
            ? { session: required(jointFixed).session, ruleDigest: required(jointFixed).ruleDigest }
            : {}),
          ...payload,
        };
        const envelope = await runtime.protocolStatement("joint.message", input, spec.purpose);
        openings.set(step.agent, {
          action: "use",
          target: operation,
          operation,
          recipient: cast.get(step.peer).identity.party,
          purpose: spec.purpose,
          parameters: {},
          conversation: "urn:pending",
        });
        result = await runtime.startInvocation({
          peer: { actor: required(peer.actor), party: cast.get(step.peer).identity.party },
          operation: { id: operation, version: "0.1" },
          input: { items: [String(envelope.statement.id)] },
          evidence: [
            { role: "credential", format: "derivation+jws", value: envelope.jws },
            ...step.derivedEvidence.map((jws) => ({
              role: "credential" as const,
              format: "derivation+jws",
              value: template<string>(jws),
            })),
          ],
          purpose: spec.purpose,
          basis: { kind: "represented" },
          models: [],
          discover: false,
          configuration: configuration.pilotConfiguration,
        });
        enqueue(step.agent, result as StepResult);
        break;
      }
      case "admit-derived":
        result = await runtime.admitStatements([{ jws: template<string>(step.jws) }], {
          task,
          taskId: task,
          purpose: step.purpose,
          operation: step.operation,
        });
        break;
      case "agreement-request": {
        const service = required(agreementServices.get(step.service)),
          actor = cast.get(step.agent);
        const request = await signStatement(actor.actorKey, "awp-agreement-request+jws", {
          type: "AgreementRequest",
          id: `urn:request:${scenario.id}:${step.id}`,
          agreement: service.definition.id,
          actor: actor.identity.actor,
          party: actor.identity.party,
          representation: actor.representationJws,
          at: now().toISOString(),
          operation: step.operation,
          termsDigest: step.termsDigest ?? digestOf(service.definition),
          evidence: step.evidence.map((id) => required(signed[id]).jws),
        });
        const params = { service: step.service, request };
        const run = await runtime.runTask({
          taskId: `urn:scenario:${scenario.id}:${step.id}`,
          kind: "agreement",
          plan: {
            adapter: "urn:scenario:agreement",
            key: `urn:scenario:${scenario.id}:${step.id}`,
            params,
            activityType: "urn:activity:agreement",
            intent: {
              action: "use",
              target: "urn:op:agreement",
              operation: "urn:op:agreement",
              recipient: service.options.identity,
              purpose: service.definition.terms.purpose,
              conversation: `urn:scenario:${scenario.id}:${step.id}`,
              parameters: params,
            },
          },
        });
        result = { run, service: capabilityAnswers[request] ?? null };
        break;
      }
      case "agreement-present": {
        const service = required(agreementServices.get(step.service));
        const credential = template<AgreementCredential>(step.credential);
        const presenter = required(
          agents.find((a) => parties.get(a.actsFor ?? "")?.identity === step.presenter),
        );
        const sender = cast.get(presenter.id);
        const presentation = await signStatement(
          sender.actorKey,
          "awp-agreement-presentation+jws",
          {
            type: "AgreementPresentation",
            actor: sender.identity.actor,
            party: sender.identity.party,
            at: now().toISOString(),
            representation: sender.representationJws,
            credentialDigest: digestOf(credential),
            audience: cast.get(step.agent).identity.actor,
            request: step.request,
          },
        );
        const params = {
          service: step.service,
          receiver: step.agent,
          credential: credential as unknown as JsonObject,
          presenter: step.presenter,
          presentation,
          request: step.request,
        };
        await required(runtimes.get(presenter.id)).runTask({
          taskId: `urn:scenario:${scenario.id}:${step.id}`,
          kind: "agreement-presentation",
          plan: {
            adapter: "urn:scenario:agreement-presentation",
            key: `urn:scenario:${scenario.id}:${step.id}`,
            params,
            activityType: "urn:activity:agreement-presentation",
            intent: {
              action: "distribute",
              target: "urn:op:agreement",
              operation: "urn:op:agreement",
              recipient: cast.get(step.agent).identity.party,
              purpose: service.definition.terms.purpose,
              conversation: `urn:scenario:${scenario.id}:${step.id}`,
              parameters: params,
            },
          },
        });
        result = capabilityAnswers[presentation] ?? null;
        break;
      }
      case "record-segment": {
        const segment = await runtime.exportRecord(template<string>(step.conversation));
        if (step.attack) {
          const payload = decodeCompactPayload(segment.jws) as unknown as {
            entries: { entry: { record: { type: string } } }[];
          };
          if (step.attack === "gap") payload.entries.splice(1, 1);
          else required(payload.entries[1]).entry.record.type = "tampered";
          segment.jws = await signStatement(
            cast.get(step.agent).actorKey,
            "awp-record-segment+jws",
            payload,
          );
        }
        result = segment;
        break;
      }
      case "offgate-copy": {
        const original = required(signed[step.statement]);
        // This host fixture is the dishonest receiver's system outside its outbound gate.
        const system = outsideSystems.get(step.recipient) ?? new Map<string, JsonObject>();
        system.set(String(original.statement.id), structuredClone(original.statement));
        outsideSystems.set(step.recipient, system);
        const externalCopy = required(system.get(String(original.statement.id)));
        const observer = required(parties.get(step.observer));
        const statement = {
          id: `urn:observation:${scenario.id}:${step.id}`,
          issuer: observer.identity,
          claimType: "onward.observation",
          subject: step.recipient,
          method: "recorded-by-authority",
          asOf: now().toISOString(),
          receiver: cast.get(step.agent).identity.party,
          dataDigest: digestOf(externalCopy),
        };
        result = {
          jws: await signClaim(required(sourceKeys.get(step.observer)), statement),
          digest: digestOf(externalCopy),
        };
        break;
      }
      case "forum-claim":
      case "forum-answer": {
        const service = required(forum);
        const actor = cast.get(step.agent);
        const source = required(parties.get(required(parties.get(step.agent)?.actsFor))).identity;
        const request =
          step.type === "forum-claim"
            ? {
                type: "ForumClaim",
                id: step.case,
                actor: actor.identity.actor,
                party: source,
                respondent: required(parties.get(step.respondent)).identity,
                conversation: template<string>(step.conversation),
                segment: template<string>(step.segment),
                allegation: step.allegation,
                ...(step.observation ? { observation: template<string>(step.observation) } : {}),
                at: now().toISOString(),
              }
            : {
                type: "ForumAnswer",
                case: step.case,
                actor: actor.identity.actor,
                party: source,
                request: required(service.requestFor(step.case)),
                segment: template<string>(step.segment),
                at: now().toISOString(),
              };
        const params = {
          evidence: runtime.recordDisclosures(),
          operation: step.type === "forum-claim" ? "submit" : "answer",
          request: await signStatement(
            actor.actorKey,
            step.type === "forum-claim" ? "awp-forum-claim+jws" : "awp-forum-answer+jws",
            request,
          ),
        };
        const operation =
          step.type === "forum-claim" ? "urn:op:forum-claim" : "urn:op:forum-answer";
        result = await runtime.runTask({
          taskId: `urn:scenario:${scenario.id}:${step.id}`,
          kind: "record-release",
          plan: {
            adapter: "urn:scenario:forum",
            key: `urn:scenario:${scenario.id}:${step.id}`,
            params,
            activityType: "urn:activity:record-release",
            intent: {
              action: "distribute",
              operation,
              target: operation,
              recipient: service.identity,
              purpose: "urn:purpose:redress",
              conversation: `urn:scenario:${scenario.id}:${step.id}`,
              parameters: params,
            },
          },
        });
        break;
      }
      case "forum-audit":
        result = await required(forum).audit();
        break;
      case "forum-decision":
        result = await runtime.admitStatements(
          [{ jws: required(required(forum).decisionFor(step.case)) }],
          { task, taskId: task, purpose: "urn:purpose:redress" },
        );
        break;
      case "general-duties":
        if (step.event) runtime.triggerDuties(step.event);
        if (step.discharge) {
          result = await runtime.dischargeDuties();
          enqueue(step.agent, result as StepResult);
        } else result = runtime.auditDuties();
        break;
      case "instruct":
        runtime.instruct(step.text);
        break;
      case "revoke-mandate":
        result = await runtime.revokeMandate();
        break;
      case "admit":
        result = await runtime.admitStatements(
          step.statements.map((id) => required(signed[id])),
          {
            subject: step.subject,
            purpose: step.purpose,
            task: task,
            taskId: task,
            operation: step.operation,
          },
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
          models: step.models ?? operation.models,
          discover: step.discover,
          configuration:
            step.configuration === "public-read"
              ? CONFIG_PUBLIC
              : preferredConfiguration(required(parties.get(step.agent)), peer, configuration),
          evidence: [
            ...step.evidence.map((id) => required(signed[id]).evidence),
            ...step.derivedEvidence.map((jws) => ({
              role: "credential" as const,
              format: scenario.requiredMethods.length ? "derivation+jws" : "jws-compact",
              value: template<string>(jws),
            })),
          ],
          content: step.content.map((part) => ({ ...part, digest: digestContent(part.bytes) })),
        };
        const contents = template<JsonObject>(step.contents);
        openings.set(step.agent, step.intent);
        result =
          step.kind === "propose"
            ? await runtime.startNegotiation({ ...base, terms: contents })
            : await runtime.startInvocation({
                ...base,
                input: contents,
                basis: step.basis ?? { kind: "represented" },
                ...(step.purpose ? { purpose: step.purpose } : {}),
              });
        enqueue(step.agent, result as StepResult);
        break;
      }
      case "receive": {
        const position = queue.findIndex(
          (item) =>
            (item.out.toActor === required(parties.get(step.agent)).actor ||
              (!item.out.toActor && !!step.from && item.from === step.from)) &&
            (!step.from || item.from === step.from),
        );
        if (position < 0)
          throw new Error(
            `${step.id}: no queued message to ${step.agent}; last decision ${recorder.events().findLast((e) => e.kind === "decision")?.reason ?? "none"}`,
          );
        const item = required(queue.splice(position, 1)[0]);
        const disclosure = required(runtimes.get(item.from)).disclosureHold(item.out.id);
        if (disclosure.protected && !disclosure.holds)
          throw new Error(`local transmission refused: ${disclosure.reason}`);
        responses.set(step.agent, { reply: step.reply, agreementPlan: step.agreementPlan });
        let wire = structuredClone(item.out.wire);
        let hostileMessage = structuredClone(item.out.message);
        for (const injection of scenario.inject.filter((i) => i.step === step.id)) {
          const target = injection.target !== "wire" ? structuredClone(hostileMessage) : wire;
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
          at[last] = template<Json>(injection.value);
          if (injection.target !== "wire") {
            hostileMessage = target as typeof hostileMessage;
            if (!injection.resign)
              throw new Error("body injection requires explicit hostile re-signing");
            const config = configurationById(hostileMessage.configuration);
            const key = cast.get(item.from).actorKey;
            wire = await writeMessagePacket(MessageNode.toNode(hostileMessage), {
              suite:
                config?.integrity.status === "selected" &&
                config.integrity.mechanism === "data-integrity"
                  ? "data-integrity"
                  : "jws",
              key,
              verificationMethod: "urn:awp:key:" + key.kid,
              created: hostileMessage.createdAt,
            });
          } else wire = target as typeof wire;
        }
        for (const fault of scenario.documentFaults.filter((fault) => fault.step === step.id))
          wire = alterDocumentForTest(wire, fault.kind);
        if (scenario.evidenceFaults.some((fault) => fault.step === step.id)) {
          hostileMessage = {
            ...hostileMessage,
            evidence: (hostileMessage.evidence ?? []).map((e) =>
              e.format === "selective-disclosure+jws"
                ? { ...e, value: changeSelectiveSalt(e.value) }
                : e,
            ),
          };
          const key = cast.get(item.from).actorKey;
          wire = await writeMessagePacket(MessageNode.toNode(hostileMessage), {
            suite: "jws",
            key,
            verificationMethod: "urn:awp:key:" + key.kid,
            created: hostileMessage.createdAt,
          });
        }
        if (step.stripSignature)
          wire = await writeMessagePacket(MessageNode.toNode(hostileMessage), { unsigned: true });
        if (step.outboundAtStep)
          recorder.label((who, event, current) =>
            who === (required(parties.get(step.agent)).traceId ?? step.agent) &&
            (event.part === "core" || event.part === "outbound-gate")
              ? required(step.outboundAtStep)
              : current,
          );
        const carried = options.alternative
          ? await carriage.carry(item.out, wire, item.from, step.agent, step.id)
          : { input: wire, binding: "direct-local/0.1" };
        result = await runtime.receive(carried.input, { binding: carried.binding });
        recorder.label(undefined);
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
            runtime.paymentApprovalBinding(pending.actionDigest),
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
          taskId: step.taskId ?? `urn:scenario:${scenario.id}:${step.id}`,
          kind: "scripted-effect",
          ...(step.origin
            ? { origin: template<import("../gates/outbound.js").ProposalOrigin>(step.origin) }
            : {}),
          plan: {
            adapter: step.adapter ?? "urn:scenario:effect",
            key: `urn:scenario:${scenario.id}:${step.id}`,
            intent: template<ActionIntent>(step.intent),
            params: template<JsonObject>(step.params),
            activityType: step.activityType,
          },
        });
        break;
      case "request-structured": {
        const request = runtime.structuredRequest(step.claimType);
        const source = required(
          agents.find((a) => parties.get(a.actsFor ?? "")?.identity === request.source),
        );
        const operation = required(
          profile.operations.find((o) => o.id === "urn:op:structured-form"),
        );
        openings.set(step.agent, {
          action: "use",
          operation: operation.id,
          target: operation.id,
          recipient: request.source,
          purpose: operation.purposes[0],
          parameters: { claimType: request.claimType },
        });
        result = await runtime.startInvocation({
          peer: { actor: required(source.actor), party: request.source },
          operation,
          input: { claimType: request.claimType },
          basis: { kind: "represented" },
          purpose: operation.purposes[0],
          models: [],
          configuration: configuration.pilotConfiguration,
        });
        enqueue(step.agent, result as StepResult);
        break;
      }
      case "read-content":
        result = await runtime.readContent(step.part, step.subject, (part) => {
          void part;
          return structuredClone(step.output);
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
      case "derive":
        result = await runtime.derive(step);
        break;
      case "assess":
        result = await runtime.assess({ ...step, agreement: template<Iri>(step.agreement) });
        break;
      case "organisation-approve": {
        const pending = required(runtime.pendingApprovals()[0]);
        const signer = required(parties.get(step.signer));
        const payload = {
          type: "OrganisationApproval",
          id: ids("approval")(),
          signer: signer.identity,
          actor: required(parties.get(step.agent)?.actor),
          actionDigest: pending.actionDigest,
          conversation: pending.conversation,
          issuedAt: now().toISOString(),
          validUntil: new Date(clock + 60_000).toISOString(),
        };
        result = await runtime.submitOrganisationApproval(
          await signStatement(
            required(sourceKeys.get(step.signer)),
            "awp-organisation-approval+jws",
            payload,
          ),
        );
        enqueue(step.agent, result as StepResult);
        break;
      }
      case "trust-decision": {
        const [id, pending] = required(Object.entries(runtime.pendingTrustRequests())[0]);
        const approval = await cast.approval(
          step.agent,
          pending.digest,
          pending.message.conversation,
          step.decision,
        );
        result = await runtime.submitTrustDecision(id, approval);
        enqueue(step.agent, result as StepResult);
        break;
      }
      case "assert": {
        const actual = template(step.actual);
        const expected = template(step.expected);
        if (
          !(step.operator === "includes"
            ? Array.isArray(actual) && actual.some((value) => isDeepStrictEqual(value, expected))
            : isDeepStrictEqual(actual, expected))
        )
          throw new Error(
            `${step.id}: assertion differs: ${JSON.stringify(template(step.actual))}`,
          );
        result = true;
        break;
      }
      case "show-mandate":
        runtime.showMandate();
        break;
      case "mint":
        result = await runtime.mintIdentifier();
        break;
      case "pending":
        result = required(runtime.pendingApprovals()[0]);
        break;
      case "conversation":
        result = required(runtime.conversation(template<string>(step.conversation)));
        break;
      case "retry-challenge":
        result = await runtime.retryChallenge(template<string>(step.conversation));
        enqueue(step.agent, result as StepResult);
        break;
      case "invoke-agreement": {
        const operation = required(profile.operations.find((o) => o.id === step.operation));
        result = await runtime.invokeUnderAgreement({
          conversation: template<string>(step.conversation),
          operation: { id: operation.id, version: operation.version },
          input: template<JsonObject>(step.input),
          purpose: step.purpose,
          evidence: step.evidence.map((id) => required(signed[id]).evidence),
        });
        enqueue(step.agent, result as StepResult);
        break;
      }
      case "receipt":
        result = await runtime.sendReceipt(template<string>(step.conversation), {
          activity: template<string>(step.activity),
          outcome: step.outcome,
          observed: template<JsonObject>(step.observed),
          final: step.final,
        });
        enqueue(step.agent, result as StepResult);
        break;
      case "issue": {
        const issuer = required(parties.get(step.issuer));
        const value = template<JsonObject>(step.value);
        const identity = issuer.actsFor
          ? required(parties.get(issuer.actsFor)).identity
          : issuer.identity;
        if (value.issuer !== identity)
          throw new Error("issuer-only source cannot sign for another organization");
        const key = cast.agents.has(issuer.id)
          ? cast.get(issuer.id).ownerKey
          : required(sourceKeys.get(issuer.id));
        const jws = await signClaim(key, value);
        const item = {
          jws,
          wireDigest: digestBytes(jws),
          statement: value,
          evidence: { role: "credential" as const, format: "jws-compact", value: jws },
        };
        signed[step.id] = item;
        if (settlement.id === "ap2" && step.id === "provider-receipt-statement")
          await runtime.admitStatements([item], {
            task,
            taskId: task,
            purpose: "urn:purpose:valuation",
          });
        result = item;
        break;
      }
      case "underwriting-handover": {
        const store = required(stores.get(step.store));
        const peer = required(parties.get(step.peer));
        const peerParty = required(parties.get(required(peer.actsFor))).identity;
        const conversation = required(runtime.conversation(template<string>(step.conversation)));
        const agreement = required(
          runtime.agreements().find((a) => a.id === conversation.agreement),
        );
        const request = {
          agent: required(parties.get(step.agent)).actor as string,
          action: "distribute" as const,
          items: step.items,
          purpose: step.purpose,
          recipient: peerParty,
        };
        const read = store.request(request);
        const annual = read.items?.find((i) => i.claimType === "income.gross.annual.derived");
        const deposit = read.items?.find((i) => i.claimType === "deposit.balance");
        const onward = (agreement.terms.onward as JsonObject[] | undefined)?.find(
          (o) => o.recipient === peerParty && o.purpose === step.purpose,
        );
        if (
          read.decision !== "permit" ||
          !annual ||
          !deposit ||
          read.items?.length !== 2 ||
          !onward ||
          !(onward.fields as Json[]).includes("annualGrossIncome") ||
          !(onward.fields as Json[]).includes("depositBalance") ||
          read.items.some((i) => i.grant.id !== `${agreement.id}#grant`)
        ) {
          result = {
            permitted: false,
            reason: read.decision === "permit" ? "excessive-scope" : "not-authorised",
          };
          break;
        }
        const application = agreement.terms.application as JsonObject;
        const rule = annual.grant.policy.permissions?.find(
          (p) =>
            p.action === "distribute" &&
            p.constraints?.some(
              (c) =>
                c.leftOperand === "recipient" &&
                (Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand]).includes(
                  peerParty,
                ),
            ),
        );
        if (!rule?.id) throw new Error("onward grant has no rule identity");
        if (!conversation.operation) throw new Error("source conversation has no operation");
        const sourceOperation = `${conversation.operation.id}@${conversation.operation.version}`;
        runtime.domainState(`${sourceOperation}:stored:${conversation.id}`);
        runtime.domainState(`${sourceOperation}:grant:${conversation.id}`);
        const terms = underwritingTermsFor({
          applicationRef: String(agreement.terms.applicationId),
          annualGrossIncome: Number((annual.data as JsonObject).value),
          derivedFrom: [annual.id],
          depositBalance: Number((deposit.data as JsonObject).balance),
          loanAmount: Number(application.loanAmount),
          propertyPrice: Number(application.propertyPrice),
          consumerAgreement: agreement.id,
          onwardRule: rule.id,
          lender: required(parties.get(required(parties.get(step.agent)?.actsFor))).identity,
        });
        const operation = required(profile.operations.find((o) => o.id === step.operation));
        const sent = await runtime.startNegotiation({
          peer: { actor: required(peer.actor), party: peerParty },
          operation: { id: operation.id, version: operation.version },
          models: operation.models,
          terms: terms as unknown as JsonObject,
          conditions: [
            {
              kind: `${PURPOSE_STORE_RELEASE_CONDITION}/${step.store}`,
              ref: {
                ...request,
                revisions: Object.fromEntries(read.items.map((i) => [i.id, i.revision ?? ""])),
              },
            },
          ],
        });
        result = { ...sent, permitted: true, consumerAgreement: agreement.id, onwardRule: rule.id };
        enqueue(step.agent, sent);
        break;
      }
      case "store-request":
        result = required(stores.get(step.store)).request(
          template<import("../domains/purpose-store.js").AccessRequest>(step.request),
        );
        break;
      case "store-assess": {
        const store = required(stores.get(step.store));
        const plan = required(profile.storeAssessments.find((p) => p.id === step.assessment));
        if (plan.purpose !== step.purpose)
          throw new Error("assessment purpose differs from profile");
        const conversation = required(runtime.conversation(template<string>(step.conversation)));
        const agreement = required(
          runtime.agreements().find((a) => a.id === conversation.agreement),
        );
        const application = agreement.terms.application as JsonObject;
        if (
          agreement.terms.purpose !== plan.purpose ||
          store.organisation !== runtime.identity.party
        )
          throw new Error("assessment is outside the actual agreement or store owner");
        const read = store.request({
          agent: step.assessor,
          action: "read",
          items: step.items,
          purpose: step.purpose,
        });
        if (read.decision !== "permit") throw new Error(`assessment store denied: ${read.reason}`);
        if (
          read.items?.length !== 2 ||
          read.items.some(
            (i) => i.grant.id !== `${agreement.id}#grant` || i.subject !== application.applicant,
          )
        )
          throw new Error("assessment inputs do not belong to this consumer agreement");
        const sourceAnnual =
          configuration.id === "authenticity-selective-disclosure"
            ? (read.items?.find(
                (i) =>
                  i.claimType === "income.gross.annual" &&
                  scenario.selectiveCredentials.some(
                    (credential) => required(parties.get(credential.issuer)).identity === i.source,
                  ),
              )?.data as JsonObject | undefined)
            : undefined;
        const annual =
          sourceAnnual && typeof sourceAnnual.annualGrossIncome === "number"
            ? { ...sourceAnnual, value: sourceAnnual.annualGrossIncome, assurance: "by-source" }
            : (read.items?.find((i) => i.claimType === "income.gross.annual.derived")?.data as
                | JsonObject
                | undefined);
        const deposit = read.items?.find((i) => i.claimType === "deposit.balance")?.data as
          | JsonObject
          | undefined;
        if (
          !annual ||
          (!(sourceAnnual && annual.assurance === "by-source") &&
            annual.rule !== plan.annualRule) ||
          !deposit ||
          typeof annual.value !== "number" ||
          typeof deposit.balance !== "number" ||
          typeof application.loanAmount !== "number" ||
          typeof application.propertyPrice !== "number"
        )
          throw new Error("incomplete assessment inputs");
        const eligible =
          application.loanAmount / annual.value <= plan.maxLoanIncomeRatio &&
          deposit.balance >= application.propertyPrice - application.loanAmount;
        const output = {
          eligible,
          status: eligible ? "indicatively-eligible" : "not-eligible",
          amount: eligible ? application.loanAmount : 0,
        };
        const receipt = {
          assessment: plan.id,
          ruleDigest: digestOf(plan),
          agreement: agreement.id,
          purpose: plan.purpose,
          inputDigests: read.items.map((i) => ({ id: i.id, digest: digestOf(i.data) })),
          outputDigest: digestOf(output),
          kept: ["output"],
          discardedAssessmentInputs: true,
          at: now().toISOString(),
        };
        required(ledgers.get(step.agent)).append(
          { type: "assessment-receipt", ...receipt },
          now().toISOString(),
        );
        result = { ...output, receipt };
        break;
      }
      case "record":
        result = runtime.checkRecord(required(ledgers.get(step.agent)).entries());
        break;
      case "read-reference": {
        const reference = template<ResourceReference>(step.reference);
        const holder = holders.get(reference.ref);
        const malicious =
          step.alterOriginal && holder
            ? {
                read: async (ref: ResourceReference, request: string) => {
                  const answer = await holder.read(ref, request);
                  if (!answer.ok || !answer.originals) return answer;
                  const envelope = decodeCompactPayload(answer.jws);
                  const original = decodeCompactPayload((envelope.statements as string[])[0] ?? "");
                  original.allergy = "altered-by-holder";
                  const declaration = required(
                    scenario.resources.find((r) => r.ref === reference.ref),
                  );
                  const key = required(sourceKeys.get(declaration.holder));
                  envelope.statements = [await signStatement(key, TYP.statement, original)];
                  envelope.statementDigest = digestOf(original);
                  return {
                    ...answer,
                    jws: await signStatement(key, "awp-original-statements+jws", envelope),
                  };
                },
              }
            : holder;
        result = await runtime.readReference(reference, malicious, step.purpose, step.item);
        break;
      }
      case "notifications":
        result = await runtime.dischargeNotifications();
        enqueue(step.agent, result as StepResult);
        break;
      case "duties":
        result = runtime.notificationDuties();
        break;
      case "advance":
        clock += step.milliseconds;
        for (const runtime of runtimes.values()) runtime.notificationDuties();
        break;
    }
    if (recordMirror && !(await recordMirror.flush()))
      throw new Error("The principal record mirror is unavailable after a completed step");
    outputs[step.id] = result ?? null;
    if (step.segmentEnd) recorder.segmentEnd(step.segmentEnd);
    if (scenario.stopAfter === step.id) {
      recorder.segmentEnd("payment");
      break;
    }
  }
  if (recordMirror && !(await recordMirror.flush()))
    throw new Error("The final principal record could not be mirrored");
  await recorder.complete();
  return {
    schema: TRACE_SCHEMA,
    useCase: scenario.useCase ?? scenario.id,
    path:
      path === "main"
        ? (scenario.cataloguePath ?? "main")
        : {
            index: scenario.branches.findIndex((b) => b.id === path) + 1,
            what: required(scenario.branches.find((b) => b.id === path)).what,
          },
    parties: scenario.parties.map((p) => ({ id: p.id, name: partyName(p) })),
    scenario: {
      id: path === "main" ? scenario.id : `${scenario.id}--${path}`,
      title:
        path === "main"
          ? scenario.title
          : `${scenario.title}: ${required(scenario.branches.find((b) => b.id === path)).what}`,
      steps: Object.fromEntries(
        Object.entries(
          scenario.traceSteps ??
            Object.fromEntries(
              scenario.script.map((step, i) => [String(step.atStep ?? i + 1), step.id]),
            ),
        ).map(([id, caption]) => [id, /[.!?]$/.test(caption) ? caption : `${caption}.`]),
      ),
    },
    configuration: {
      id: configuration.id,
      layers: {
        ...configuration.layers,
        ...(["cohort-count", "platform-income", "salary-benchmark"].includes(scenario.id) &&
        scenario.jointSession?.method === SPARQ_AGGREGATE.method &&
        verifiers.jointProtocols.get(SPARQ_AGGREGATE.method)?.kind === "real"
          ? { "data-access": "aggregate-mpc" }
          : {}),
      },
    },
    agents: [
      ...agents,
      ...scenario.parties.filter(
        (p) =>
          scenario.singleUseRegisters.some((r) => r.party === p.id) ||
          profile.forum?.party === p.id ||
          scenario.agreements.some((a) => a.service === p.id) ||
          scenario.datasets.some((d) => d.holder === p.id) ||
          scenario.negotiatedMeaning?.platform === p.id,
      ),
    ].map((p) => ({
      id: p.traceId ?? p.id,
      name: partyName(p),
      actsFor: p.actsFor ?? p.id,
      role: p.role,
    })),
    generated: {
      commit,
      core: "scripted",
      ...(scenario.jointSession?.method === SPARQ_AGGREGATE.method &&
      verifiers.jointProtocols.get(SPARQ_AGGREGATE.method)?.kind === "real"
        ? {
            method: SPARQ_AGGREGATE.method,
            package: SPARQ_AGGREGATE.package,
            packageCommit: SPARQ_AGGREGATE.commit,
            sha256: SPARQ_AGGREGATE.sha256,
            notice: SPARQ_AGGREGATE.notice,
          }
        : {}),
    },
    standIns: [
      ...profile.standIns,
      ...scenario.standIns,
      ...(settlement.id === "rdf-order"
        ? []
        : [{ what: "Protocol HTTP and payment execution", replacedBy: HTTP_STAND_IN }]),
    ],
    ...(scenario.jointSession &&
    verifiers.jointProtocols.get(scenario.jointSession.method)?.kind === "real"
      ? {
          assurance: {
            kind: "joint" as const,
            assumption: required(verifiers.jointProtocols.get(scenario.jointSession.method))
              .assumption,
          },
        }
      : {}),
    events: recorder.events(),
  };
}
