// AUTHORED-BY Codex GPT-6
/** Local holder protocol: signed, reader-bound grants; no Solid access-control claim. */
import { z } from "zod";
import { digestOf } from "../core/canonical.js";
import { DEFAULT_LIMITS } from "../core/limits.js";
import { id, iso } from "../core/schema.js";
import type { JsonObject } from "../core/types.js";
import type { EvidenceLedger } from "../store/ledger.js";
import type { SigningKey } from "./jws.js";
import { signStatement, TYP, verifyStatement } from "./statements.js";
import type { TrustStore } from "./trust.js";

export const resourceGrantSchema = z.strictObject({
  type: z.literal("ResourceGrant"),
  id,
  issuer: id,
  ref: id,
  reader: z.strictObject({ actor: id, party: id }),
  items: z
    .array(z.strictObject({ id, claimType: z.string() }))
    .min(1)
    .max(64),
  purpose: id,
  validUntil: iso,
  digest: z.string().optional(),
});
export type ResourceGrant = z.infer<typeof resourceGrantSchema>;
export const referenceSchema = z.strictObject({
  ref: id,
  digest: z.string().optional(),
  claimTypes: z.array(z.string()).min(1),
  grant: z.string(),
});
export type ResourceReference = z.infer<typeof referenceSchema>;
const readSchema = z.strictObject({
  type: z.literal("ResourceRead"),
  id,
  actor: id,
  party: id,
  ref: id,
  item: id,
  purpose: id,
  at: iso,
});

export function referencesIn(
  value: unknown,
  path = "",
): { reference: ResourceReference; path: string }[] {
  if (!value || typeof value !== "object") return [];
  if (!Array.isArray(value) && Object.hasOwn(value, "grant") && Object.hasOwn(value, "ref")) {
    const parsed = referenceSchema.safeParse(value);
    if (!parsed.success) throw new Error("invalid resource reference");
    return [{ reference: parsed.data, path }];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    referencesIn(child, path ? `${path}.${key}` : key),
  );
}
export async function verifyResourceGrant(
  jws: string,
  trust: TrustStore,
  at: string,
  verifier: string,
) {
  const options = {
    trust,
    typ: "awp-resource-grant+jws",
    schema: resourceGrantSchema,
    limits: DEFAULT_LIMITS,
    at,
    verifier,
  };
  let checked = await verifyStatement(jws, { ...options, role: "issuer" });
  if (checked.verification.outcome === "unknown-key")
    checked = await verifyStatement(jws, { ...options, role: "party" });
  const grant = checked.payload;
  return {
    ...checked,
    payload:
      grant && checked.signer?.subject === grant.issuer && checked.verification.outcome === "valid"
        ? grant
        : undefined,
  };
}
export interface ResourceReader {
  read(
    reference: ResourceReference,
    requestJws: string,
  ): Promise<
    | { ok: true; jws: string; grant: ResourceGrant }
    | {
        ok: false;
        reason:
          | "not-authorised"
          | "purpose-not-permitted"
          | "expired"
          | "lookup-failed"
          | "evidence-invalid";
      }
  >;
}
export class LocalResourceHolder implements ResourceReader {
  private readonly seen = new Set<string>();
  constructor(
    private readonly options: {
      identity: string;
      key: SigningKey;
      trust: TrustStore;
      resources: Readonly<Record<string, readonly JsonObject[]>>;
      ledger: EvidenceLedger;
      now: () => string;
    },
  ) {}
  async read(reference: ResourceReference, requestJws: string): ReturnType<ResourceReader["read"]> {
    const at = this.options.now();
    const checked = await verifyStatement(requestJws, {
      trust: this.options.trust,
      typ: "awp-resource-read+jws",
      role: "actor",
      schema: readSchema,
      limits: DEFAULT_LIMITS,
      verifier: this.options.identity,
      at,
    });
    this.options.ledger.append(checked.verification, at);
    const request = checked.payload;
    const grantCheck = await verifyResourceGrant(
      reference.grant,
      this.options.trust,
      at,
      this.options.identity,
    );
    this.options.ledger.append(grantCheck.verification, at);
    const grant = grantCheck.payload;
    const record = (reason: string) =>
      this.options.ledger.append(
        {
          type: "resource-read",
          ref: reference.ref,
          item: request?.item ?? "unknown",
          actor: request?.actor ?? "unknown",
          purpose: request?.purpose ?? "unknown",
          reason,
          at,
        },
        at,
      );
    const refuse = (
      reason:
        | "not-authorised"
        | "purpose-not-permitted"
        | "expired"
        | "lookup-failed"
        | "evidence-invalid",
    ) => {
      record(reason);
      return { ok: false as const, reason };
    };
    if (
      !request ||
      checked.verification.outcome !== "valid" ||
      checked.signer?.subject !== request.actor ||
      checked.signer.party !== request.party ||
      !grant ||
      grant.issuer !== this.options.identity
    )
      return refuse("not-authorised");
    if (this.seen.has(request.id) || Math.abs(Date.parse(at) - Date.parse(request.at)) > 60000)
      return refuse("not-authorised");
    this.seen.add(request.id);
    if (
      grant.reader.actor !== request.actor ||
      grant.reader.party !== request.party ||
      request.ref !== grant.ref ||
      reference.ref !== grant.ref ||
      !grant.items.some((i) => i.id === request.item)
    )
      return refuse("not-authorised");
    if (Date.parse(grant.validUntil) <= Date.parse(at)) return refuse("expired");
    if (request.purpose !== grant.purpose) return refuse("purpose-not-permitted");
    if (
      digestOf([...new Set(grant.items.map((i) => i.claimType))].sort()) !==
      digestOf([...new Set(reference.claimTypes)].sort())
    )
      return refuse("evidence-invalid");
    const resource = this.options.resources[grant.ref];
    if (!resource) return refuse("lookup-failed");
    if (
      (grant.digest && grant.digest !== digestOf(resource)) ||
      (reference.digest && reference.digest !== grant.digest)
    )
      return refuse("evidence-invalid");
    const original = resource.find((s) => s.id === request.item);
    if (
      !original ||
      original.issuer !== this.options.identity ||
      !grant.items.some((i) => i.id === original.id && i.claimType === original.claimType)
    )
      return refuse("lookup-failed");
    const statement: JsonObject = {
      ...original,
      resourceGrant: reference.grant,
      terms: {
        policy: {
          id: grant.id,
          assignee: grant.reader.actor,
          permissions: [
            {
              type: "permission",
              action: "use",
              target: String(original.id),
              constraints: [
                { leftOperand: "purpose", operator: "eq", rightOperand: grant.purpose },
                { leftOperand: "dateTime", operator: "lt", rightOperand: grant.validUntil },
              ],
            },
          ],
        },
        inherited: [{ target: String(original.id), terms: original.terms ?? null }],
      },
    };
    record("fit-for-use");
    return {
      ok: true,
      jws: await signStatement(this.options.key, TYP.statement, statement),
      grant,
    };
  }
}
