// AUTHORED-BY Codex GPT-6
/** Registrar documents and issuer status are resolved independently of the presenting core. */
import { z } from "zod";
import { DEFAULT_LIMITS } from "../core/limits.js";
import { id, iso } from "../core/schema.js";
import type { ReasonCode, VerificationResult } from "../core/types.js";
import { verifyStatement } from "./statements.js";
import type { KeyRole, TrustStore } from "./trust.js";

export interface DocumentResolver {
  resolve(id: string): Promise<string | undefined>;
}
export class LocalDocumentResolver implements DocumentResolver {
  constructor(
    private readonly documents: Readonly<Record<string, string>>,
    private readonly record: (id: string) => void = () => {},
  ) {}
  async resolve(id: string) {
    this.record(id);
    return this.documents[id];
  }
}
export const identifierDocumentSchema = z.strictObject({
  type: z.literal("OrganizationIdentifier"),
  id,
  issuer: id,
  subject: id,
  validFrom: iso,
  validUntil: iso,
  keys: z
    .array(
      z.strictObject({ kid: z.string(), subject: id, role: z.enum(["party", "issuer", "actor"]) }),
    )
    .max(64),
});
const statusReference = z.strictObject({ ref: id, id: z.string() });
export const organizationCredentialSchema = z.strictObject({
  type: z.literal("OrganizationMandate"),
  id,
  issuer: id,
  subjectKey: z.string(),
  actor: id,
  entity: id,
  roles: z.array(z.string()).min(1),
  actions: z.array(z.string()).min(1),
  validFrom: iso,
  validUntil: iso,
  status: statusReference,
});
export const statusListSchema = z.strictObject({
  type: z.literal("StatusList"),
  id,
  issuer: id,
  issuedAt: iso,
  validUntil: iso,
  entries: z.record(z.string(), z.enum(["active", "withdrawn"])),
});
export interface OrganizationPolicy {
  registrar: string;
  maxStatusAgeSeconds: number;
  requiredRoles: Readonly<Record<string, readonly string[]>>;
  actionKinds?: Readonly<Record<string, string>>;
  statusClaims?: readonly string[];
}
type Checked = { ok: true } | { ok: false; reason: ReasonCode };
export class OrganizationChecks {
  constructor(
    private readonly options: {
      policy: OrganizationPolicy;
      resolver: DocumentResolver;
      trust: TrustStore;
      now: () => string;
      verifier: string;
      record: (verification: VerificationResult) => void;
    },
  ) {}
  private async resolve(id: string) {
    try {
      return await this.options.resolver.resolve(id);
    } catch {
      return undefined;
    }
  }
  private async verify<T>(jws: string, typ: string, schema: z.ZodType<T>) {
    const options = {
      trust: this.options.trust,
      typ,
      schema,
      limits: DEFAULT_LIMITS,
      at: this.options.now(),
      verifier: this.options.verifier,
    };
    let check = await verifyStatement(jws, { ...options, role: "issuer" });
    if (check.verification.outcome === "unknown-key")
      check = await verifyStatement(jws, { ...options, role: "party" });
    this.options.record(check.verification);
    return check;
  }
  async key(identifier: string, kid: string, subject: string, role: KeyRole): Promise<Checked> {
    const document = await this.resolve(identifier);
    if (!document) return { ok: false, reason: "lookup-failed" };
    const check = await this.verify(
      document,
      "awp-organization-identifier+jws",
      identifierDocumentSchema,
    );
    const doc = check.payload;
    if (
      !doc ||
      check.signer?.subject !== this.options.policy.registrar ||
      doc.issuer !== this.options.policy.registrar ||
      doc.subject !== identifier
    )
      return { ok: false, reason: "evidence-invalid" };
    const now = Date.parse(this.options.now());
    if (Date.parse(doc.validFrom) > now || Date.parse(doc.validUntil) <= now)
      return { ok: false, reason: "stale-data" };
    return doc.keys.some((k) => k.kid === kid && k.subject === subject && k.role === role)
      ? { ok: true }
      : { ok: false, reason: "unknown-key" };
  }
  async status(issuer: string, reference: unknown, mandate = false): Promise<Checked> {
    const parsed = statusReference.safeParse(reference);
    if (!parsed.success) return { ok: false, reason: "lookup-failed" };
    const jws = await this.resolve(parsed.data.ref);
    if (!jws) return { ok: false, reason: "lookup-failed" };
    const check = await this.verify(jws, "awp-status-list+jws", statusListSchema);
    const list = check.payload;
    if (
      !list ||
      check.signer?.subject !== issuer ||
      list.issuer !== issuer ||
      list.id !== parsed.data.ref
    )
      return { ok: false, reason: "evidence-invalid" };
    const key = await this.key(issuer, check.signer.kid, issuer, check.signer.role);
    if (!key.ok) return key;
    const now = Date.parse(this.options.now()),
      issued = Date.parse(list.issuedAt);
    if (
      issued > now ||
      now - issued > this.options.policy.maxStatusAgeSeconds * 1000 ||
      Date.parse(list.validUntil) <= now
    )
      return { ok: false, reason: "stale-data" };
    const status = list.entries[parsed.data.id];
    return status === "active"
      ? { ok: true }
      : {
          ok: false,
          reason:
            status === "withdrawn"
              ? mandate
                ? "mandate-withdrawn"
                : "status-withdrawn"
              : "lookup-failed",
        };
  }
  async authority(
    jws: string,
    expected: {
      actor: string;
      kid: string;
      entity: string;
      operation: string;
      action: string;
      requestedEntity?: unknown;
    },
  ): Promise<Checked & { statement?: string }> {
    const check = await this.verify(
      jws,
      "awp-organization-mandate+jws",
      organizationCredentialSchema,
    );
    const credential = check.payload;
    if (!credential || check.signer?.subject !== credential.issuer)
      return { ok: false, reason: "representation-invalid" };
    const key = await this.key(
      credential.issuer,
      check.signer.kid,
      credential.issuer,
      check.signer.role,
    );
    if (!key.ok) return key;
    if (
      credential.issuer !== expected.entity ||
      credential.entity !== expected.entity ||
      credential.actor !== expected.actor ||
      credential.subjectKey !== expected.kid ||
      (expected.requestedEntity !== undefined && expected.requestedEntity !== credential.entity) ||
      !credential.actions.includes(expected.action) ||
      !this.options.policy.requiredRoles[expected.operation]?.length ||
      !(this.options.policy.requiredRoles[expected.operation] ?? []).every((role) =>
        credential.roles.includes(role),
      )
    )
      return { ok: false, reason: "representation-out-of-scope" };
    const now = Date.parse(this.options.now());
    if (Date.parse(credential.validFrom) > now || Date.parse(credential.validUntil) <= now)
      return { ok: false, reason: "representation-expired" };
    const status = await this.status(credential.issuer, credential.status, true);
    return status.ok ? { ok: true, statement: credential.id } : status;
  }
}
