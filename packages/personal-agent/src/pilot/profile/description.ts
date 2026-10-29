/**
 * Implementation descriptions and configuration selection (framework A3, A9, D).
 *
 * A description separates (a) vocabularies the agent can interpret, (b) configurations it
 * implements, (c) configurations it ACCEPTS for interaction, and (d) conformance claims
 * with the evidence level behind them. A peer's description is untrusted input: only
 * the fields needed for selection are read, and nothing in it (keys, endpoints, links)
 * is ever added to local trust — descriptions advertise, they do not authorise.
 */
import { z } from "zod";
import type { Iri, JsonObject } from "../core/types.js";
import { configurationById, isExecutable } from "./configurations.js";
import { PILOT_PROFILE, PILOT_PROFILE_VERSION, TERM_REGISTER } from "./vocabulary.js";

export interface OperationDescription {
  readonly id: Iri;
  readonly version: string;
  readonly label: string;
  /** `negotiate` = propose/accept then perform; `invoke` = invoke/deliver. */
  readonly pattern: "negotiate" | "invoke";
  /** `public` operations accept anonymous requests under the public configuration. */
  readonly access: "public" | "represented";
  /** Which side this agent plays for the operation. */
  readonly roles: readonly ("initiator" | "responder")[];
  /** Domain schema/model versions accepted for terms/inputs/outputs. */
  readonly models: readonly { readonly id: Iri; readonly version: string }[];
  readonly purposes?: readonly Iri[];
  readonly effects: readonly string[];
  readonly outcomes: readonly string[];
  readonly limitations?: readonly string[];
}

export interface ConformanceClaim {
  readonly claim: string;
  readonly level:
    | "representation-test"
    | "self-test-real-crypto"
    | "integration-fixture"
    | "live-local-service"
    | "live-provider-round-trip"
    | "independent-interop";
  readonly evidence: string;
}

export interface ImplementationDescription {
  readonly type: "ImplementationDescription";
  readonly describes: Iri;
  readonly onBehalfOf?: Iri;
  readonly operator?: Iri;
  readonly profile: { readonly id: string; readonly version: string };
  readonly acceptedProfiles: readonly { readonly id: string; readonly versions: string }[];
  readonly vocabularies: readonly { readonly iri: string; readonly relation: string }[];
  readonly configurations: {
    readonly implemented: readonly string[];
    /** In preference order. A subset of `implemented`. */
    readonly accepted: readonly string[];
  };
  readonly operations: readonly OperationDescription[];
  readonly bindings: readonly { readonly id: string; readonly endpoint?: string }[];
  /**
   * The policy module actually selected by this agent: which policy profile it evaluates,
   * which evaluator implements it (name/version/interface — never a local path or digest) and
   * whether it is currently available. Informative: peers do not select on it.
   */
  readonly policyModule?: DescribedPolicyModule;
  readonly conformance: readonly ConformanceClaim[];
  readonly notice: string;
  readonly extensions?: JsonObject;
}

export interface DescribedPolicyModule {
  readonly policyProfile: string;
  readonly evaluator: {
    readonly name: string;
    readonly version: string;
    readonly interface: string;
  };
  readonly status: "ready" | "unavailable";
}

export const DESCRIPTION_NOTICE =
  "This description advertises supported and accepted behaviour. It grants no authority, " +
  "carries no trusted verification material, and is not evidence of conformance beyond the " +
  "listed claims at their stated evidence level.";

export function buildDescription(input: {
  actor: Iri;
  party?: Iri;
  operator?: Iri;
  implemented: readonly string[];
  accepted: readonly string[];
  operations: readonly OperationDescription[];
  bindings: readonly { id: string; endpoint?: string }[];
  policyModule?: DescribedPolicyModule;
  conformance?: readonly ConformanceClaim[];
  extensions?: JsonObject;
}): ImplementationDescription {
  for (const id of input.accepted) {
    if (!input.implemented.includes(id)) {
      throw new Error(`accepted configuration ${id} is not implemented`);
    }
  }
  return {
    type: "ImplementationDescription",
    describes: input.actor,
    ...(input.party ? { onBehalfOf: input.party } : {}),
    ...(input.operator ? { operator: input.operator } : {}),
    profile: { id: PILOT_PROFILE, version: PILOT_PROFILE_VERSION },
    acceptedProfiles: [{ id: PILOT_PROFILE, versions: "0.1.x" }],
    vocabularies: TERM_REGISTER.filter((t) => t.relation !== "minted").map((t) => ({
      iri: t.iri,
      relation: t.relation,
    })),
    configurations: { implemented: [...input.implemented], accepted: [...input.accepted] },
    operations: input.operations,
    bindings: input.bindings,
    ...(input.policyModule ? { policyModule: input.policyModule } : {}),
    conformance: input.conformance ?? [],
    notice: DESCRIPTION_NOTICE,
    ...(input.extensions ? { extensions: input.extensions } : {}),
  };
}

/** Accept `0.1.x` style version ranges only (exact major.minor, any patch). */
export function versionAccepted(range: string, version: string): boolean {
  const m = /^(\d+)\.(\d+)\.x$/.exec(range);
  if (!m) return range === version;
  return version === `${m[1]}.${m[2]}` || version.startsWith(`${m[1]}.${m[2]}.`);
}

const peerDescriptionSchema = z.object({
  type: z.literal("ImplementationDescription"),
  describes: z.string().max(512),
  profile: z.object({ id: z.string().max(512), version: z.string().max(32) }),
  configurations: z.object({
    implemented: z.array(z.string().max(512)).max(32),
    accepted: z.array(z.string().max(512)).max(32),
  }),
  operations: z
    .array(
      z.object({
        id: z.string().max(512),
        version: z.string().max(32),
        pattern: z.enum(["negotiate", "invoke"]),
        access: z.enum(["public", "represented"]),
        roles: z.array(z.enum(["initiator", "responder"])).max(2),
        models: z.array(z.object({ id: z.string().max(512), version: z.string().max(32) })).max(16),
        purposes: z.array(z.string().max(512)).max(32).optional(),
      }),
    )
    .max(64),
});

export type PeerDescription = z.infer<typeof peerDescriptionSchema>;

/** Read the selection-relevant subset of an untrusted peer description. */
export function readPeerDescription(value: unknown): PeerDescription | undefined {
  const parsed = peerDescriptionSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export type SelectionResult =
  | {
      readonly ok: true;
      readonly configuration: string;
      readonly operation: PeerDescription["operations"][number];
      readonly model: { readonly id: string; readonly version: string };
    }
  | {
      readonly ok: false;
      readonly reason:
        | "unsupported-profile"
        | "unsupported-configuration"
        | "unsupported-operation"
        | "unsupported-term";
      readonly detail: string;
    };

/**
 * Select ONE configuration + operation + model version acceptable to both sides.
 * Local preference order wins; only executable configurations the local side itself
 * accepts are candidates, so a peer cannot steer selection to something weaker than
 * local policy allows (downgrade resistance).
 */
export function selectConfiguration(input: {
  localAccepted: readonly string[];
  peer: PeerDescription;
  operation: { id: Iri; version: string };
  acceptedModels: readonly { id: string; version: string }[];
}): SelectionResult {
  const { peer } = input;
  if (peer.profile.id !== PILOT_PROFILE || !versionAccepted("0.1.x", peer.profile.version)) {
    return {
      ok: false,
      reason: "unsupported-profile",
      detail: `peer profile ${peer.profile.id}@${peer.profile.version}`,
    };
  }
  const configuration = input.localAccepted.find(
    (id) => isExecutable(id) && peer.configurations.accepted.includes(id),
  );
  if (!configuration) {
    return {
      ok: false,
      reason: "unsupported-configuration",
      detail: `no common executable configuration (local ${input.localAccepted.join(", ")}; peer ${peer.configurations.accepted.join(", ")})`,
    };
  }
  const operation = peer.operations.find(
    (op) =>
      op.id === input.operation.id &&
      op.version === input.operation.version &&
      op.roles.includes("responder"),
  );
  if (!operation) {
    return {
      ok: false,
      reason: "unsupported-operation",
      detail: `peer does not offer ${input.operation.id}@${input.operation.version} as responder`,
    };
  }
  const model = input.acceptedModels.find((m) =>
    operation.models.some((pm) => pm.id === m.id && pm.version === m.version),
  );
  if (!model) {
    return {
      ok: false,
      reason: "unsupported-term",
      detail: `no common domain model version for ${operation.id}`,
    };
  }
  if (configurationById(configuration)?.status !== "executable") {
    return { ok: false, reason: "unsupported-configuration", detail: "not executable" };
  }
  return { ok: true, configuration, operation, model };
}
