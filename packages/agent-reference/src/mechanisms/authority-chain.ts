// AUTHORED-BY Codex GPT-6
import { z } from "zod";
import { DEFAULT_LIMITS } from "../core/limits.js";
import { id, iso } from "../core/schema.js";
import type { ReasonCode, VerificationResult } from "../core/types.js";
import { decodeAdapterJson } from "../wire/inspect.js";
import type { DocumentResolver } from "./organizations.js";
import { verifyStatement } from "./statements.js";
import type { TrustStore } from "./trust.js";

const reference = z.strictObject({ ref: id, id: z.string() });
export const mandateLinkSchema = z.strictObject({
  type: z.literal("MandateLink"),
  id,
  parent: id.optional(),
  issuer: id,
  subject: id,
  subjectKey: z.string().min(1),
  entity: id,
  actions: z.array(z.string()).min(1),
  scope: z.strictObject({
    operations: z.array(id).min(1),
    subjects: z.array(id).min(1),
    purposes: z.array(id).min(1),
  }),
  validFrom: iso,
  validUntil: iso,
  status: reference,
  mayDelegate: z.strictObject({ depth: z.number().int().min(1).max(16) }).optional(),
  holderSet: id.optional(),
});
export const chainPolicySchema = z.strictObject({
  actionField: z.literal("request").optional(),
  operations: z.array(id).optional(),
  roots: z.array(z.strictObject({ issuer: id, entity: id, operations: z.array(id).min(1) })).min(1),
  maxStatusAgeSeconds: z.number().positive(),
  holders: z.enum(["any", "all"]).default("any"),
  objectionRole: z.string().min(1).default("responsible-person"),
});
const holderSchema = z.strictObject({
  type: z.literal("AuthorityHolders"),
  id,
  issuer: id,
  entity: id,
  issuedAt: iso,
  validUntil: iso,
  holders: z.array(id).min(1),
  objections: z.array(id),
});
const statusSchema = z.strictObject({
  type: z.literal("StatusList"),
  id,
  issuer: id,
  issuedAt: iso,
  validUntil: iso,
  entries: z.record(z.string(), z.enum(["active", "withdrawn"])),
});
type Link = z.infer<typeof mandateLinkSchema>;
export type ChainPolicy = z.infer<typeof chainPolicySchema>;
type Result =
  | { ok: true; statement: string }
  | { ok: false; reason: ReasonCode; deciderRole?: string };

/** Keys are introduced by the host; every current status answer is resolved anew. */
export class AuthorityChainChecks {
  constructor(
    private readonly options: {
      policy: ChainPolicy;
      resolver: DocumentResolver;
      trust: TrustStore;
      now: () => string;
      verifier: string;
      record: (v: VerificationResult) => void;
    },
  ) {}
  private async verify<T>(jws: string, typ: string, schema: z.ZodType<T>) {
    const options = {
      trust: this.options.trust,
      typ,
      schema,
      limits: DEFAULT_LIMITS,
      at: this.options.now(),
      verifier: this.options.verifier,
    };
    let checked = await verifyStatement(jws, { ...options, role: "issuer" });
    if (checked.verification.outcome === "unknown-key")
      checked = await verifyStatement(jws, { ...options, role: "party" });
    this.options.record(checked.verification);
    return checked;
  }
  private async resolve(ref: string) {
    try {
      return await this.options.resolver.resolve(ref);
    } catch {
      return undefined;
    }
  }
  private fresh(issued: string, until: string) {
    const age = Date.parse(this.options.now()) - Date.parse(issued);
    return (
      age >= 0 &&
      age <= this.options.policy.maxStatusAgeSeconds * 1000 &&
      Date.parse(until) > Date.parse(this.options.now())
    );
  }
  async check(
    encoded: string | undefined,
    expected: {
      actor: string;
      kid: string;
      entity: string;
      action: string;
      operation: string;
      subject: string;
      purpose: string;
    },
  ): Promise<Result> {
    if (!encoded) return { ok: false, reason: "representation-missing" };
    let chains: string[][];
    try {
      chains = z
        .array(z.array(z.string()).min(1).max(16))
        .min(1)
        .max(16)
        .parse(decodeAdapterJson(encoded));
    } catch {
      return { ok: false, reason: "representation-invalid" };
    }
    const holders = new Set<string>();
    let requiredHolders: string[] | undefined;
    let holderSetId: string | undefined;
    let objection = false;
    for (const chain of chains) {
      let parent: Link | undefined;
      let parentKey: string | undefined;
      const ancestors: Link[] = [];
      const seen = new Set<string>();
      for (let index = 0; index < chain.length; index++) {
        const check = await this.verify(
          chain[index] as string,
          "awp-mandate-link+jws",
          mandateLinkSchema,
        );
        const link = check.payload;
        if (
          !link ||
          check.signer?.subject !== link.issuer ||
          Date.parse(link.validFrom) >= Date.parse(link.validUntil)
        )
          return { ok: false, reason: "representation-invalid" };
        if (seen.has(link.id)) return { ok: false, reason: "representation-invalid" };
        seen.add(link.id);
        const now = Date.parse(this.options.now());
        if (Date.parse(link.validFrom) > now || Date.parse(link.validUntil) <= now)
          return { ok: false, reason: "representation-expired" };
        if (!parent) {
          if (link.parent) return { ok: false, reason: "representation-missing" };
          const root = this.options.policy.roots.find(
            (r) =>
              r.issuer === link.issuer &&
              r.entity === expected.entity &&
              r.operations.includes(expected.operation),
          );
          if (!root) return { ok: false, reason: "representation-invalid" };
          if (!link.scope.operations.every((op) => root.operations.includes(op)))
            return { ok: false, reason: "representation-out-of-scope" };
        } else {
          if (!link.parent) return { ok: false, reason: "representation-missing" };
          if (link.parent !== parent.id)
            return {
              ok: false,
              reason: ancestors.some((a) => a.id === link.parent)
                ? "representation-invalid"
                : "representation-missing",
            };
          if (link.issuer !== parent.subject || check.signer.kid !== parentKey)
            return { ok: false, reason: "representation-invalid" };
          if (
            ancestors.some(
              (a, position) => !a.mayDelegate || index - position > a.mayDelegate.depth,
            ) ||
            (link.mayDelegate &&
              (!parent.mayDelegate || link.mayDelegate.depth >= parent.mayDelegate.depth))
          )
            return { ok: false, reason: "representation-invalid" };
          const subset = (child: string[], allowed: string[]) =>
            child.every((v) => allowed.includes(v));
          if (
            link.entity !== parent.entity ||
            !subset(link.actions, parent.actions) ||
            !subset(link.scope.operations, parent.scope.operations) ||
            !subset(link.scope.subjects, parent.scope.subjects) ||
            !subset(link.scope.purposes, parent.scope.purposes) ||
            Date.parse(link.validFrom) < Date.parse(parent.validFrom) ||
            Date.parse(link.validUntil) > Date.parse(parent.validUntil)
          )
            return { ok: false, reason: "representation-out-of-scope" };
        }
        if (
          link.entity !== expected.entity ||
          !link.actions.includes(expected.action) ||
          !link.scope.operations.includes(expected.operation) ||
          !link.scope.subjects.includes(expected.subject) ||
          !link.scope.purposes.includes(expected.purpose)
        )
          return { ok: false, reason: "representation-out-of-scope" };
        const statusJws = await this.resolve(link.status.ref);
        if (!statusJws) return { ok: false, reason: "lookup-failed" };
        const status = await this.verify(statusJws, "awp-status-list+jws", statusSchema);
        if (
          !status.payload ||
          status.signer?.subject !== link.issuer ||
          status.payload.issuer !== link.issuer ||
          status.payload.id !== link.status.ref
        )
          return { ok: false, reason: "representation-invalid" };
        if (!this.fresh(status.payload.issuedAt, status.payload.validUntil))
          return { ok: false, reason: "lookup-failed" };
        if (status.payload.entries[link.status.id] === "withdrawn")
          return { ok: false, reason: "mandate-withdrawn" };
        if (status.payload.entries[link.status.id] !== "active")
          return { ok: false, reason: "lookup-failed" };
        if (index === 0) {
          holders.add(link.subject);
          if (link.holderSet) {
            if (holderSetId && holderSetId !== link.holderSet)
              return { ok: false, reason: "representation-invalid" };
            holderSetId = link.holderSet;
            const jws = await this.resolve(link.holderSet);
            if (!jws) return { ok: false, reason: "lookup-failed" };
            const statement = await this.verify(jws, "awp-authority-holders+jws", holderSchema);
            const set = statement.payload;
            if (
              !set ||
              statement.signer?.subject !== link.issuer ||
              set.issuer !== link.issuer ||
              set.id !== link.holderSet ||
              set.entity !== link.entity ||
              !set.holders.includes(link.subject)
            )
              return { ok: false, reason: "representation-invalid" };
            if (!this.fresh(set.issuedAt, set.validUntil))
              return { ok: false, reason: "lookup-failed" };
            if (set.objections.some((h) => set.holders.includes(h) && h !== link.subject))
              objection = true;
            requiredHolders = set.holders;
          } else if (this.options.policy.holders === "all")
            return { ok: false, reason: "representation-missing" };
        }
        ancestors.push(link);
        parent = link;
        parentKey = link.subjectKey;
      }
      if (!parent || parent.subject !== expected.actor || parent.subjectKey !== expected.kid)
        return { ok: false, reason: "representation-invalid" };
    }
    if (this.options.policy.holders === "all" && !requiredHolders?.every((h) => holders.has(h)))
      return { ok: false, reason: "representation-missing" };
    if (objection)
      return {
        ok: false,
        reason: "approval-required",
        deciderRole: this.options.policy.objectionRole,
      };
    return { ok: true, statement: "urn:authority:verified-chain" };
  }
}
