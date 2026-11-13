// AUTHORED-BY Codex GPT-6
/** Data drives cores and the synthetic world. Only the real runtime/gates emit events. */
import type { OdrlRule } from "@jeswr/solid-odrl";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { isDeepStrictEqual } from "util";
import { digestBytes, digestContent, digestOf } from "../core/canonical.js";
import type { ActionIntent, EvidenceItem, Iri, Json, JsonObject } from "../core/types.js";
import { SyntheticPaymentRail, underwritingTermsFor } from "../domains/mortgage.js";
import {
  PURPOSE_STORE_RELEASE_CONDITION,
  PurposeBoundStore,
  purposeStoreReleaseCheck,
} from "../domains/purpose-store.js";
import type { GateContext } from "../gates/common.js";
import { LocalDocumentResolver } from "../mechanisms/organizations.js";
import { LocalResourceHolder, type ResourceReference } from "../mechanisms/references.js";
import {
  issueSelectiveCredential,
  presentSelective,
  unverifiedEvidenceClaim,
} from "../mechanisms/selective.js";
import { signStatement, TYP } from "../mechanisms/statements.js";
import { TrustStore } from "../mechanisms/trust.js";
import {
  CONFIG_CORROBORATION,
  CONFIG_ORGANIZATIONS,
  CONFIG_PAYMENT,
  CONFIG_PINNED_LIST,
  CONFIG_PLAIN_LANGUAGE,
  CONFIG_PUBLIC,
  CONFIG_REFERENCE_LOCAL,
  CONFIG_SELECTIVE_LOCAL,
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
import { MemoryLedger } from "../store/ledger.js";
import { BASELINE, baselineRegistry } from "../suites/baseline.js";
import { PUBLIC_READ, withPublicRead } from "../suites/public-read.js";
import { TraceRecorder } from "../trace/recorder.js";
import { type OutlineEntry, outlineOf, TRACE_SCHEMA, type TraceFile } from "../trace/types.js";
import { TrustResolver } from "../trust/resolver.js";
import { installHandler } from "./handlers.js";
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
      : scenario.assurance === "joint"
        ? "needs the joint computation"
        : "attested assurance is outside Brief 11";
  for (const [layer, suite] of Object.entries(scenario.suites))
    if (
      BASELINE.layers[layer as keyof typeof BASELINE.layers] !== suite &&
      (
        {
          commitments: "payment",
          reliance: "corroboration",
          trust: "pinned-list",
          meaning: "plain-language-upgrade",
          "data-access": "by-reference-local-holder",
          authority: "mandate-credential",
          identity: "organization-document-local",
          authenticity: "selective-disclosure",
        } as Record<string, string>
      )[layer] !== suite
    )
      return `suite ${layer}/${suite} is not implemented by this engine`;
  if (
    Object.keys(scenario.suites).filter(
      (layer) => BASELINE.layers[layer as keyof typeof BASELINE.layers] !== scenario.suites[layer],
    ).length > 1 &&
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
    const pathProfile = domainProfileSchema.parse(
      patch(profile, "profileChange" in path && path.profileChange ? path.profileChange : {}),
    );
    const blocker = path.blocked ?? unsupported(pathProfile, world, path.id);
    if (blocker) {
      results.push({ path: path.id, blocked: blocker });
      continue;
    }
    const trace = await runPath(pathProfile, world, path.id, options.commit ?? "unknown");
    if (path.expect) {
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
  const registry = withPublicRead(baselineRegistry());
  registry.register({
    layer: "commitments",
    id: "payment",
    name: "Local structured payments",
    agreement: "signed-offer-acceptance",
    summary:
      "The local extension releases a structured payment instruction under a signed mandate, reserves cumulative limits before release, and records a signed stand-in bank submission; no settlement claim.",
  });
  registry.register({
    layer: "reliance",
    id: "corroboration",
    name: "Exact-value corroboration",
    enforcedAtGate: true,
    summary:
      "Accepted issuers with separately configured controllers must agree on the exact subject, claim, value and period; authenticity alone never establishes truth.",
  });
  registry.register({
    layer: "trust",
    id: "pinned-list",
    name: "Scoped own-list pins",
    anchors: "pinned",
    summary:
      "Reviewed verification keys require a purpose-scoped, expiring own-list pin; unknown trust is held for a digest-bound principal decision.",
  });
  registry.register({
    layer: "meaning",
    vocabulary: "profile-declared types",
    id: "plain-language-upgrade",
    name: "Structured form from the source",
    summary:
      "Content remains unstructured data. Typed quarantined readings retain agent authorship and digest; unaccepted readings require source-signed claims.",
  });
  registry.register({
    layer: "data-access",
    id: "by-reference-local-holder",
    name: "Signed grants and local resource holder",
    mode: "by-reference",
    summary:
      "A separately keyed local holder verifies signed reader identity, item, purpose and expiry; this does not implement Solid access control.",
  });
  registry.register({
    layer: "identity",
    id: "organization-document-local",
    name: "Registrar-served current organization documents",
    resolution: "resolved",
    summary:
      "A local resolver serves registrar-signed current key and delegated-agent lists; no live DID method is claimed.",
  });
  registry.register({
    layer: "authority",
    id: "mandate-credential",
    name: "Organization mandate credentials",
    mandateFormat: "awp-organization-mandate+jws",
    approvalFormat: "exact-action",
    summary:
      "Organization-signed agent-key, entity, role and action scope, with issuer-signed status and bounded freshness.",
  });
  registry.register({
    layer: "authenticity",
    id: "selective-disclosure",
    name: "Salted claim digests inside signed credentials",
    mechanism: "JWS and salted SHA-256 claim commitments",
    algs: ["EdDSA"],
    summary:
      "Each revealed claim is checked against issuer-signed salted digests; no proof about hidden values or unlinkability is claimed.",
  });
  const local =
    scenario.suites.authenticity === "selective-disclosure"
      ? CONFIG_SELECTIVE_LOCAL
      : scenario.suites.authority === "mandate-credential"
        ? CONFIG_ORGANIZATIONS
        : scenario.suites["data-access"] === "by-reference-local-holder"
          ? CONFIG_REFERENCE_LOCAL
          : scenario.suites.meaning === "plain-language-upgrade"
            ? CONFIG_PLAIN_LANGUAGE
            : scenario.suites.commitments === "payment"
              ? CONFIG_PAYMENT
              : scenario.suites.reliance === "corroboration"
                ? CONFIG_CORROBORATION
                : scenario.suites.trust === "pinned-list"
                  ? CONFIG_PINNED_LIST
                  : undefined;
  const configuration = local
    ? {
        id: `${scenario.id}-local`,
        pilotConfiguration: local,
        layers: { ...BASELINE.layers, ...scenario.suites },
      }
    : BASELINE;
  if (local) registry.configure(configuration);
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
    const jws = await signClaim(key, payload);
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
  const ledgers = new Map<string, MemoryLedger>();
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
    grants,
    grantDigests: Object.fromEntries(
      Object.entries(grants).map(([id, reference]) => [id, digestBytes(reference.grant)]),
    ),
    current,
    now: now().toISOString(),
  });
  for (const agent of agents) {
    cast.trust.set(agent.id, {
      ...required(cast.trust.get(agent.id)),
      controllers: scenario.trust.controllers,
    });
    const trust = await TrustStore.load(cast.trust.get(agent.id));
    const mandate = required(scenario.mandates.find((m) => m.agent === agent.id));
    const gate: GateContext = {
      configuration: agent.configurations[0] === "public-read" ? PUBLIC_READ : configuration,
      configurations: { [CONFIG_PUBLIC]: PUBLIC_READ },
      ...(profile.organizations
        ? { organizations: { policy: profile.organizations, resolver } }
        : {}),
      sink: recorder.sink(agent.traceId ?? agent.id),
      taskId: task,
      name,
      vocabulary: profile.vocabulary,
      identifiers: profile.identifiers,
      sourceAliases: profile.sources,
      rules: profile.rules.filter((r) => "template" in r),
      assessments: profile.assessments,
      personDecisions: profile.personDecisions,
      readings: profile.readings,
      actionClaims: profile.actionClaims,
      requester: scenario.requester[agent.id],
      referenceAction: profile.referenceAction,
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
      purposes: Object.fromEntries(profile.purposes.map((p) => [p.id, p.claims])),
      reliance: {
        id: `urn:profile:${profile.id}`,
        rules: profile.claims.map((c) => ({
          id: `urn:profile:${profile.id}:${c.kind}`,
          claimType: c.kind,
          methods: c.methods,
          maxAgeDays: c.maxAgeDays,
          ...(c.corroboration ? { corroboration: c.corroboration } : {}),
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
    const handlers: OperationHandler[] = agent.handlers.length
      ? agent.handlers.map((id) =>
          installHandler(required(scenario.handlerImplementations[id]), signed, stores),
        )
      : profile.operations.map((op) => {
          const reply = (ctx: HandlerContext): HandlerReply =>
            resolveTemplate(
              responses.get(agent.id)?.reply ?? { type: "none" },
              variables(ctx),
            ) as HandlerReply;
          const intent = (ctx: HandlerContext, contents: JsonObject): ActionIntent => {
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
        new SyntheticPaymentRail(),
        {
          id: "urn:scenario:effect",
          execute: async (_key, params) => ({ conclusion: "completed", observed: params }),
          reconcile: async () => ({
            conclusion: "not-executed",
            reason: "no synthetic effect recorded",
          }),
        },
      ],
      agent.configurations.map((c) =>
        c === "public-read" ? CONFIG_PUBLIC : configuration.pilotConfiguration,
      ),
      {
        gates: gate,
        disclosureChecks: Object.fromEntries(
          scenario.stores.map((store) => [
            `${PURPOSE_STORE_RELEASE_CONDITION}/${store.id}`,
            purposeStoreReleaseCheck(required(stores.get(store.id))),
          ]),
        ),
        ...(organizationCredentials[agent.id]
          ? { organizationMandateJws: organizationCredentials[agent.id] }
          : {}),
        ...(profile.rules.some((r) => "template" in r && r.assurances.includes("by-source"))
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
  const enqueue = (from: string, result: StepResult) => {
    for (const out of result.outbound) queue.push({ from, out });
  };
  for (const [index, step] of scenario.script.entries()) {
    recorder.step(step.atStep ?? index + 1);
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
          configuration:
            step.configuration === "public-read" ? CONFIG_PUBLIC : configuration.pilotConfiguration,
          evidence: step.evidence.map((id) => required(signed[id]).evidence),
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
          at[last] = injection.value;
          if (injection.target !== "wire") {
            hostileMessage = target as typeof hostileMessage;
            if (!injection.resign)
              throw new Error("body injection requires explicit hostile re-signing");
            wire = {
              format: "awp-jws-compact/0.1",
              jws: await signStatement(cast.get(item.from).actorKey, TYP.message, target),
            };
          } else wire = target as typeof wire;
        }
        if (step.outboundAtStep)
          recorder.label((who, event, current) =>
            who === (required(parties.get(step.agent)).traceId ?? step.agent) &&
            (event.part === "core" || event.part === "outbound-gate")
              ? required(step.outboundAtStep)
              : current,
          );
        result = await runtime.receive(wire, { binding: "direct-local/0.1" });
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
        const annual = read.items?.find((i) => i.claimType === "income.gross.annual.derived")
          ?.data as JsonObject | undefined;
        const deposit = read.items?.find((i) => i.claimType === "deposit.balance")?.data as
          | JsonObject
          | undefined;
        if (
          !annual ||
          annual.rule !== plan.annualRule ||
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
        result = await runtime.readReference(
          reference,
          holders.get(reference.ref),
          step.purpose,
          step.item,
        );
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
    outputs[step.id] = result ?? null;
  }
  return {
    schema: TRACE_SCHEMA,
    scenario: {
      id: path === "main" ? scenario.id : `${scenario.id}--${path}`,
      title: scenario.title,
      steps:
        scenario.traceSteps ??
        Object.fromEntries(
          scenario.script.map((step, i) => [String(step.atStep ?? i + 1), step.id]),
        ),
    },
    configuration: { id: configuration.id, layers: { ...configuration.layers } },
    agents: agents.map((p) => ({
      id: p.traceId ?? p.id,
      name: p.name,
      actsFor: required(p.actsFor),
      role: p.role,
    })),
    generated: { commit, core: "scripted" },
    standIns: [...profile.standIns, ...scenario.standIns],
    events: recorder.events(),
  };
}
