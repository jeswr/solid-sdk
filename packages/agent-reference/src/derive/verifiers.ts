// AUTHORED-BY Codex GPT-6
/** Host-installed verification capabilities. A method name alone establishes nothing. */
import type { Iri, Json, JsonObject } from "../core/types.js";
/** Opt-in bounds for ~584 KB native presentations plus their signed wrappers. */
export const DERIVATION_LIMITS = {
  maxEnvelopeBytes: 4 * 1024 * 1024,
  maxStringLength: 2 * 1024 * 1024,
  maxJsonDepth: 32,
  maxJsonNodes: 50_000,
  // The delivered result presentation carries its 14,656 proof bytes as an array.
  maxArrayLength: 16_384,
};

export type JsonValue = Json;
export type ProofBinds = "rule" | "issuers" | "subject" | "fresh" | "complete";
export interface ProofSystem {
  readonly method: string;
  readonly kind: "real" | "test-double";
  readonly binds: readonly ProofBinds[];
  issue(input: {
    issuerKey: JsonObject;
    subject: Iri;
    claims: JsonObject;
    status?: JsonObject;
  }): Promise<JsonObject>;
  issuerKeygen(seed: Uint8Array): Promise<{ publicKey: JsonObject; secretKey: JsonObject }>;
  prove(input: {
    query: string;
    credentials: readonly JsonObject[];
    policy: JsonObject;
    nonce: string;
  }): Promise<{ presentation: JsonObject; result: JsonValue }>;
  verify(input: {
    expectedQuery: string;
    presentation: JsonObject;
    policy: JsonObject;
    nonce: string;
    /** Receiver-owned synchronous view of its persistent single-use nonce store. */
    seenNonces?: { has(key: string): boolean; add(key: string): unknown };
  }): Promise<
    | {
        ok: true;
        released: JsonValue;
        binds: readonly ProofBinds[];
        issuerKeys: readonly JsonObject[];
      }
    | { ok: false; reason: string }
  >;
}
export interface SessionParams {
  sessionId: string;
  statistic: "count" | "sum" | "count-and-sum";
  minimumGroup: number;
  minimumContributors: number;
  threshold?: { statistic: "count" | "sum"; operator: ">=" | "<="; value: number };
  roster: readonly {
    party: string;
    publicKeys: JsonObject;
    computeOnly?: boolean;
    keyBinding?: string;
  }[];
}
/** Refusal variants deliberately have no numeric total. Evidence is adapter-owned JSON. */
export type JointOutcome =
  | { type: "release"; count?: number; sum?: number; evidence: JsonObject }
  | { type: "threshold-verdict"; verdict: boolean; evidence: JsonObject }
  | { type: "below-minimum-group"; evidence: JsonObject }
  | { type: "too-few-contributors"; evidence: JsonObject };
export interface JointProtocol {
  readonly method: string;
  readonly kind: "real" | "test-double";
  readonly assumption: string;
  generateKeys(seed: Uint8Array): Promise<{ publicKeys: JsonObject; secretKeys: JsonObject }>;
  newSession(params: SessionParams): Promise<{ session: JsonObject; ruleDigest: string }>;
  contribute(input: {
    session: JsonObject;
    party: string;
    secretKeys: JsonObject;
    count: number;
    sum: number;
  }): Promise<{
    contribution: JsonObject;
    shares: Record<string, JsonObject>;
    local?: JsonObject;
    auditOpening?: JsonObject;
  }>;
  receiveAndPartial(input: {
    session: JsonObject;
    party: string;
    secretKeys: JsonObject;
    contributions: readonly JsonObject[];
    shares: readonly JsonObject[];
    local?: JsonObject;
  }): Promise<
    | { ok: true; partial: JsonObject; local?: JsonObject }
    | { ok: false; reason: string; partyAtFault?: string; check?: string; index?: number | null }
  >;
  finish(input: {
    session: JsonObject;
    contributions: readonly JsonObject[];
    partials: readonly JsonObject[];
    party?: string;
    secretKeys?: JsonObject;
    local?: JsonObject;
  }): Promise<JointOutcome>;
  verifyOutcome(input: {
    session: JsonObject;
    outcome: JointOutcome;
    contributions: readonly JsonObject[];
  }): Promise<
    | { ok: true; contributors: readonly string[] }
    | { ok: false; reason: string; partyAtFault?: string; check?: string; index?: number | null }
  >;
}
export interface VerifierRegistry {
  readonly proofSystems: ReadonlyMap<string, ProofSystem>;
  readonly jointProtocols: ReadonlyMap<string, JointProtocol>;
}
export type Adapter = ProofSystem | JointProtocol;
export function verifierRegistry(adapters: readonly Adapter[] = []): VerifierRegistry {
  const proofSystems = new Map<string, ProofSystem>(),
    jointProtocols = new Map<string, JointProtocol>();
  for (const adapter of adapters) {
    if (proofSystems.has(adapter.method) || jointProtocols.has(adapter.method))
      throw new Error(`Duplicate verifier: ${adapter.method}`);
    if ("verify" in adapter) proofSystems.set(adapter.method, adapter);
    else jointProtocols.set(adapter.method, adapter);
  }
  return { proofSystems, jointProtocols };
}
/** Tracks actual capability use, including a method a scenario forgot to declare. */
export function registryForRun(registry: VerifierRegistry, testOnly = false) {
  let usedTestDouble = false;
  const wrap = <T extends Adapter>(adapter: T): T =>
    new Proxy(adapter, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (target.kind === "test-double") {
            usedTestDouble = true;
            if (!testOnly)
              throw new Error(
                "The engine refuses test-double verifiers outside an explicit in-memory test run; no runs row or trace may be written.",
              );
          }
          return value.apply(target, args);
        };
      },
    });
  return {
    registry: {
      proofSystems: new Map([...registry.proofSystems].map(([m, a]) => [m, wrap(a)])),
      jointProtocols: new Map([...registry.jointProtocols].map(([m, a]) => [m, wrap(a)])),
    },
    usedTestDouble: () => usedTestDouble,
  };
}
export interface DerivedRequest {
  rule: string;
  ruleDigest: string;
  subject: string;
  purpose: string;
  assurances: readonly ("proved" | "attested" | "joint" | "recomputed" | "by-source")[];
  nonce: string;
  query: string;
  policy: JsonObject;
  consumed: boolean;
}
export interface FixedJointSession {
  consumed?: boolean;
  outcomeConsumed?: boolean;
  method: string;
  session: JsonObject;
  ruleDigest: string;
  rule: string;
  purpose: string;
  assurances: readonly string[];
}
