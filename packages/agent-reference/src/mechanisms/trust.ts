/**
 * The local trust store: PINNED verification material plus SCOPED source-authority rules.
 *
 * Every key the runtime will ever verify against is here, placed by a local, reviewed
 * setup step (an "introduction" whose thumbprints a human compares out of band). Nothing
 * received over a binding — a description, a message header, an evidence item — can add
 * or replace an entry. Each key has exactly ONE role (actor, party, issuer, service);
 * a party key cannot sign messages as an actor and an actor key cannot sign a mandate.
 *
 * Source authority (A7) is a separate question from key attribution: a rule accepts a
 * source for listed claim types about listed subjects, for a period, under an identified
 * rule version. A valid signature from a source outside its rules is `not-accepted`.
 */
import { z } from "zod";
import { isIsoInstant } from "../core/schema.js";
import type { Iri, SourceAuthorityAssessment } from "../core/types.js";
import { checkPinnedRecord, type KeyAlg, type PublicKeyRecord } from "./jws.js";

export type KeyRole = "actor" | "party" | "issuer";

export interface PinnedKey extends PublicKeyRecord {
  readonly role: KeyRole;
  /** The identifier this key is bound to (actor IRI, party IRI or issuer IRI). */
  readonly subject: Iri;
  /** For actor keys: the party the actor is expected to represent (a local expectation). */
  readonly party?: Iri;
  /** Communication endpoints associated with this actor (e.g. `mailto:`), with provenance. */
  readonly endpoints?: readonly string[];
  readonly note?: string;
}

export interface SourceAuthorityRule {
  readonly id: Iri;
  readonly version: string;
  readonly source: Iri;
  /** Exact claim types, or a prefix ending in `.*`. */
  readonly claimTypes: readonly string[];
  /** `any` or an explicit subject list. */
  readonly subjects: "any" | readonly Iri[];
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly framework?: string;
}

export interface TrustStoreData {
  readonly version: 1;
  /** The local owner's party key (verifies own mandate and approvals). */
  readonly owner: Iri;
  readonly keys: readonly PinnedKey[];
  readonly sourceAuthority: readonly SourceAuthorityRule[];
}

const jwk = z
  .object({
    kty: z.string(),
    crv: z.string().optional(),
    x: z.string().optional(),
    y: z.string().optional(),
  })
  .strict();

const pinnedKeySchema = z
  .object({
    role: z.enum(["actor", "party", "issuer"]),
    subject: z.string().min(3).max(512),
    party: z.string().max(512).optional(),
    endpoints: z.array(z.string().max(512)).max(8).optional(),
    note: z.string().max(512).optional(),
    kid: z.string().min(16).max(128),
    alg: z.enum(["EdDSA", "ES256"]),
    publicJwk: jwk,
  })
  .strict();

const instant = z.string().max(64).refine(isIsoInstant, "expected an ISO-8601 instant with offset");
const ruleSchema = z
  .object({
    id: z.string().min(3).max(512),
    version: z.string().max(32),
    source: z.string().min(3).max(512),
    claimTypes: z.array(z.string().max(256)).min(1).max(64),
    subjects: z.union([z.literal("any"), z.array(z.string().max(512)).max(256)]),
    validFrom: instant.optional(),
    validUntil: instant.optional(),
    framework: z.string().max(512).optional(),
  })
  .strict()
  .refine(
    (r) => !r.validFrom || !r.validUntil || Date.parse(r.validFrom) < Date.parse(r.validUntil),
    {
      message: "validFrom must be before validUntil",
    },
  );

const storeSchema = z
  .object({
    version: z.literal(1),
    owner: z.string().min(3).max(512),
    keys: z.array(pinnedKeySchema).max(1024),
    sourceAuthority: z.array(ruleSchema).max(1024),
  })
  .strict();

export class TrustStore {
  private readonly byKid = new Map<string, PinnedKey>();

  private constructor(readonly data: TrustStoreData) {
    for (const key of data.keys) this.byKid.set(key.kid, key);
  }

  /**
   * Validate and load. Refuses: a key whose thumbprint does not match its JWK, a private
   * key component, a kid pinned twice, or the same subject pinned in two roles.
   */
  static async load(value: unknown): Promise<TrustStore> {
    const data = storeSchema.parse(value) as TrustStoreData;
    const seen = new Set<string>();
    const roleOf = new Map<string, KeyRole>();
    for (const key of data.keys) {
      if (seen.has(key.kid)) throw new Error(`kid pinned twice: ${key.kid}`);
      seen.add(key.kid);
      if (!(await checkPinnedRecord(key))) {
        throw new Error(`pinned key ${key.kid} does not match its JWK (or is private)`);
      }
      const prior = roleOf.get(key.subject);
      if (prior && prior !== key.role) {
        throw new Error(`${key.subject} pinned with two roles (${prior}, ${key.role})`);
      }
      roleOf.set(key.subject, key.role);
    }
    return new TrustStore(data);
  }

  static empty(owner: Iri): TrustStore {
    return new TrustStore({ version: 1, owner, keys: [], sourceAuthority: [] });
  }

  /** A resolver restricted to one role — the only way verification obtains keys. */
  resolver(role: KeyRole, algs?: readonly KeyAlg[]): (kid: string) => PinnedKey | undefined {
    return (kid) => {
      const key = this.byKid.get(kid);
      if (!key || key.role !== role) return undefined;
      if (algs && !algs.includes(key.alg)) return undefined;
      return key;
    };
  }

  keysFor(subject: Iri, role: KeyRole): PinnedKey[] {
    return this.data.keys.filter((k) => k.subject === subject && k.role === role);
  }

  actorEndpoints(actor: Iri): readonly string[] {
    return this.keysFor(actor, "actor").flatMap((k) => k.endpoints ?? []);
  }

  /** Assess whether `source` is accepted for `claimType` about `subject` at `at` (A7). */
  assessSource(input: {
    evaluator: Iri;
    source: Iri;
    claimType: string;
    subject?: Iri;
    at: string;
  }): SourceAuthorityAssessment {
    const at = Date.parse(input.at);
    const candidates = this.data.sourceAuthority.filter((r) => r.source === input.source);
    const base = {
      type: "source-authority" as const,
      evaluator: input.evaluator,
      source: input.source,
      claimType: input.claimType,
      ...(input.subject ? { subject: input.subject } : {}),
      at: input.at,
    };
    if (!isIsoInstant(input.at) || !Number.isFinite(at)) {
      return { ...base, outcome: "unresolved", reason: "evaluation time is not a valid instant" };
    }
    if (candidates.length === 0) {
      return { ...base, outcome: "not-accepted", reason: "no rule recognises this source" };
    }
    for (const rule of candidates) {
      const typeOk = rule.claimTypes.some((t) =>
        t.endsWith(".*") ? input.claimType.startsWith(t.slice(0, -1)) : t === input.claimType,
      );
      if (!typeOk) continue;
      if (rule.subjects !== "any") {
        if (!input.subject) {
          return {
            ...base,
            rule: { id: rule.id, version: rule.version },
            outcome: "unresolved",
            reason: "rule is subject-scoped but the claim names no subject",
          };
        }
        if (!rule.subjects.includes(input.subject)) continue;
      }
      // Fail closed on any date that does not parse (load() already rejects these; this
      // guards stores built another way). validFrom is inclusive, validUntil exclusive.
      const from =
        rule.validFrom === undefined ? Number.NEGATIVE_INFINITY : Date.parse(rule.validFrom);
      const until =
        rule.validUntil === undefined ? Number.POSITIVE_INFINITY : Date.parse(rule.validUntil);
      if (Number.isNaN(from) || Number.isNaN(until)) {
        return {
          ...base,
          rule: { id: rule.id, version: rule.version },
          outcome: "unresolved",
          reason: "rule validity dates are malformed",
        };
      }
      if (at < from || at >= until) continue;
      return { ...base, rule: { id: rule.id, version: rule.version }, outcome: "accepted" };
    }
    return {
      ...base,
      outcome: "not-accepted",
      reason: "source is recognised, but not for this claim type/subject/period",
    };
  }
}
