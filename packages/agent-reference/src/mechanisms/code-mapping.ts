// AUTHORED-BY Codex GPT-6
/** Vocabulary translation is an explicit derivation; it never changes the clinical source. */
import { z } from "zod";
import { digestOf } from "../core/canonical.js";
import { DEFAULT_LIMITS } from "../core/limits.js";
import { id, iso } from "../core/schema.js";
import type { JsonObject, ReasonCode, VerificationResult } from "../core/types.js";
import { currentStatus } from "./current-status.js";
import type { DocumentResolver } from "./organizations.js";
import { verifyStatement } from "./statements.js";
import type { TrustStore } from "./trust.js";
export const mappingTableSchema = z.strictObject({
  type: z.literal("CodeMappingTable"),
  id,
  issuer: id,
  version: z.string(),
  fromList: id,
  toList: id,
  validFrom: iso,
  validUntil: iso,
  entries: z.array(
    z.strictObject({
      from: z.string(),
      to: z.string(),
      relation: z.enum(["exact", "approximate"]),
    }),
  ),
  status: z.strictObject({ ref: id, id: z.string() }),
});
export const mappingPolicySchema = z.strictObject({
  receivers: z.array(id),
  acceptedLists: z.array(id),
  maxStatusAgeSeconds: z.number().positive(),
  assurance: z.enum(["recomputed", "attested"]).default("recomputed"),
  approximate: z.enum(["ask-more", "admit-lowered"]),
  routes: z.array(
    z.strictObject({ fromList: id, toList: id, registry: id, table: id, version: z.string() }),
  ),
});
export type MappingPolicy = z.infer<typeof mappingPolicySchema>;
export async function mapCodeClaim(
  original: JsonObject,
  options: {
    policy: MappingPolicy;
    trust: TrustStore;
    resolver: DocumentResolver;
    at: string;
    verifier: string;
    record: <T extends { type: string }>(record: T) => void;
    purpose?: string;
    attestedDerivers?: readonly { deriver: string; rule: string; purposes: readonly string[] }[];
  },
): Promise<
  | { ok: true; statement: JsonObject }
  | { ok: false; reason: ReasonCode; outcome: "ask-more" | "refuse"; code?: string }
> {
  const fail = (reason: ReasonCode, outcome: "ask-more" | "refuse" = "refuse") => ({
    ok: false as const,
    reason,
    outcome,
    code: String(original.code),
  });
  const route = options.policy.routes.find(
    (r) => r.fromList === original.codeList && options.policy.acceptedLists.includes(r.toList),
  );
  if (!route) return fail("unsupported-term", "ask-more");
  let jws: string | undefined;
  try {
    jws = await options.resolver.resolve(route.table);
  } catch {}
  if (!jws) return fail("lookup-failed", "ask-more");
  const args = {
    trust: options.trust,
    typ: "awp-code-mapping-table+jws",
    schema: mappingTableSchema,
    limits: DEFAULT_LIMITS,
    at: options.at,
    verifier: options.verifier,
  };
  let checked = await verifyStatement(jws, { ...args, role: "issuer" });
  if (checked.verification.outcome === "unknown-key")
    checked = await verifyStatement(jws, { ...args, role: "party" });
  options.record(checked.verification);
  const table = checked.payload;
  if (!table || checked.signer?.subject !== route.registry || table.issuer !== route.registry)
    return fail("bad-signature");
  if (
    table.id !== route.table ||
    table.version !== route.version ||
    table.fromList !== route.fromList ||
    table.toList !== route.toList
  )
    return fail("rule-not-accepted");
  if (
    Date.parse(table.validFrom) > Date.parse(options.at) ||
    Date.parse(table.validUntil) <= Date.parse(options.at)
  )
    return fail("expired");
  const authority = options.trust.assessSource({
    evaluator: options.verifier,
    source: route.registry,
    claimType: "code-mapping",
    subject: route.fromList,
    at: options.at,
  });
  options.record(authority);
  if (authority.outcome !== "accepted") return fail("source-not-authoritative");
  const current = await currentStatus({
    issuer: route.registry,
    reference: table.status,
    resolver: options.resolver,
    trust: options.trust,
    now: options.at,
    verifier: options.verifier,
    maxAgeSeconds: options.policy.maxStatusAgeSeconds,
    record: (r: VerificationResult) => options.record(r),
  });
  if (!current.ok)
    return fail(current.reason, current.reason === "lookup-failed" ? "ask-more" : "refuse");
  const entries = table.entries.filter((e) => e.from === original.code);
  if (entries.length !== 1) return fail("unsupported-term", "ask-more");
  const entry = required(entries[0]);
  const statement: JsonObject = {
    ...structuredClone(original),
    codeList: table.toList,
    code: entry.to,
    method: "derived",
    derivation: {
      type: "code-mapping",
      deriver: options.verifier,
      assurance: "recomputed",
      rule: table.id,
      version: table.version,
      mappingDigest: digestOf(table),
      originalDigest: digestOf(original),
      originalSource: String(original.issuer),
      originalQuality: {
        method: original.method ?? null,
        asOf: original.asOf ?? null,
        period: original.period ?? null,
        validUntil: original.validUntil ?? null,
      },
      inputs: [
        {
          id: original.id ?? "",
          digest: digestOf(original),
          issuer: original.issuer ?? "",
          claimType: original.claimType ?? "",
          method: original.method ?? "unknown",
          asOf: original.asOf ?? "",
        },
      ],
      basis: [original.method ?? "unknown"],
      originalCode: { codeList: original.codeList ?? "", code: original.code ?? "" },
      outputDigest: digestOf({ codeList: table.toList, code: entry.to }),
      approximate: entry.relation === "approximate",
      standing: entry.relation === "approximate" ? "lowered" : "original",
    },
  };
  if (options.policy.assurance === "attested") {
    if (
      !options.attestedDerivers?.some(
        (a) =>
          a.deriver === route.registry &&
          a.rule === table.id &&
          a.purposes.includes(options.purpose ?? ""),
      )
    )
      return fail("source-not-authoritative");
    let recordJws: string | undefined;
    try {
      recordJws = await options.resolver.resolve(
        mappingAttestationReference(table.id, table.version, digestOf(original)),
      );
    } catch {}
    if (!recordJws) return fail("lookup-failed", "ask-more");
    const verifyArgs = {
      trust: options.trust,
      typ: "awp-mapping-attestation+jws",
      schema: mappingAttestationSchema,
      limits: DEFAULT_LIMITS,
      at: options.at,
      verifier: options.verifier,
    };
    let proof = await verifyStatement(recordJws, { ...verifyArgs, role: "issuer" });
    if (proof.verification.outcome === "unknown-key")
      proof = await verifyStatement(recordJws, { ...verifyArgs, role: "party" });
    options.record(proof.verification);
    const p = proof.payload;
    if (
      !p ||
      proof.signer?.subject !== route.registry ||
      p.issuer !== route.registry ||
      p.deriver !== route.registry ||
      p.rule !== table.id ||
      p.version !== table.version ||
      p.mappingDigest !== digestOf(table) ||
      p.originalDigest !== digestOf(original) ||
      digestOf(p.input) !== digestOf({ codeList: original.codeList, code: original.code }) ||
      digestOf(p.output) !== digestOf({ codeList: table.toList, code: entry.to }) ||
      Date.parse(p.at) > Date.parse(options.at)
    )
      return fail("derivation-not-verified");
    const d = statement.derivation as JsonObject;
    d.assurance = "attested";
    d.deriver = route.registry;
    d.attestation = recordJws;
  }
  options.record({
    type: "code-mapping-derivation",
    statement,
    originalDigest: digestOf(original),
    mapping: jws,
  });
  if (entry.relation === "approximate" && options.policy.approximate === "ask-more")
    return fail("confidence-too-low", "ask-more");
  return { ok: true, statement };
}

export const mappingAttestationSchema = z.strictObject({
  type: z.literal("MappingAttestation"),
  issuer: id,
  rule: id,
  version: z.string(),
  mappingDigest: z.string(),
  originalDigest: z.string(),
  input: z.strictObject({ codeList: id, code: z.string() }),
  output: z.strictObject({ codeList: id, code: z.string() }),
  assurance: z.literal("attested"),
  deriver: id,
  at: iso,
});
export function mappingAttestationReference(
  table: string,
  version: string,
  originalDigest: string,
) {
  return `urn:mapping-attestation:${digestOf({ table, version, originalDigest }).slice(8)}`;
}
/** An issuer-only registry evaluates its actual published table, rather than signing a supplied result. */
export async function issueMappingAttestation(
  originalJws: string,
  options: Parameters<typeof mapCodeClaim>[1] & {
    identity: string;
    key: import("./jws.js").SigningKey;
  },
) {
  const args = {
    trust: options.trust,
    typ: "awp-statement+jws",
    schema: z
      .object({ issuer: id, claimType: z.string(), subject: id, codeList: id, code: z.string() })
      .passthrough(),
    limits: DEFAULT_LIMITS,
    at: options.at,
    verifier: options.identity,
  };
  let original = await verifyStatement(originalJws, { ...args, role: "issuer" });
  if (original.verification.outcome === "unknown-key")
    original = await verifyStatement(originalJws, { ...args, role: "party" });
  options.record(original.verification);
  const c = original.payload;
  if (
    !c ||
    original.signer?.subject !== c.issuer ||
    options.trust.assessSource({
      evaluator: options.identity,
      source: c.issuer,
      claimType: c.claimType,
      subject: c.subject,
      at: options.at,
    }).outcome !== "accepted"
  )
    return undefined;
  const mapped = await mapCodeClaim(c as JsonObject, {
    ...options,
    policy: { ...options.policy, assurance: "recomputed", approximate: "admit-lowered" },
  });
  if (!mapped.ok) return undefined;
  const d = mapped.statement.derivation as JsonObject;
  if (!options.policy.routes.some((r) => r.table === d.rule && r.registry === options.identity))
    return undefined;
  const { signStatement } = await import("./statements.js");
  const statement = {
    type: "MappingAttestation",
    issuer: options.identity,
    rule: d.rule,
    version: d.version,
    mappingDigest: d.mappingDigest,
    originalDigest: d.originalDigest,
    input: { codeList: c.codeList, code: c.code },
    output: { codeList: mapped.statement.codeList, code: mapped.statement.code },
    assurance: "attested",
    deriver: options.identity,
    at: options.at,
  };
  return {
    ref: mappingAttestationReference(String(d.rule), String(d.version), String(d.originalDigest)),
    jws: await signStatement(options.key, "awp-mapping-attestation+jws", statement),
  };
}

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error("required capability value is missing");
  return value;
}
