// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { compactVerify, decodeProtectedHeader } from "jose";
import { validInstant } from "./instant.js";
import { supportedPolicy } from "./policy.js";
import type { Mandate, MandateVerifier, Policy } from "./types.js";

/** A locally pinned pilot key; document-supplied JWKs and key URLs are never accepted. */
export interface LegacyPinnedKey {
  readonly publicKey: CryptoKey;
  readonly subject: string;
  readonly alg: "EdDSA" | "ES256";
}
function iri(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 512 &&
    /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]+$/.test(value) &&
    value.split("#").length <= 2
  );
}
function fields(value: object, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function validPolicy(p: Policy): boolean {
  return (
    fields(p, [
      "id",
      "type",
      "assigner",
      "assignee",
      "conflict",
      "permissions",
      "prohibitions",
      "obligations",
    ]) &&
    iri(p.id) &&
    (p.type === undefined || ["Set", "Agreement", "Offer"].includes(p.type)) &&
    (p.assigner === undefined || iri(p.assigner)) &&
    (p.assignee === undefined || iri(p.assignee)) &&
    supportedPolicy(p) &&
    (p.obligations ?? []).length === 0 &&
    (["permissions", "prohibitions"] as const).every((collection) =>
      (p[collection] ?? []).every(
        (r) =>
          fields(r, [
            "id",
            "type",
            "action",
            "target",
            "assigner",
            "assignee",
            "constraints",
            "duties",
          ]) &&
          ["use", "read", "distribute", "compensate", "transfer"].includes(r.action) &&
          (r.id === undefined || iri(r.id)) &&
          (r.target === undefined || iri(r.target)) &&
          (r.assigner === undefined || iri(r.assigner)) &&
          (r.assignee === undefined || iri(r.assignee)) &&
          r.type === (collection === "permissions" ? "permission" : "prohibition") &&
          (r.type !== "permission" || typeof r.target === "string") &&
          (r.duties ?? []).length === 0 &&
          (r.constraints ?? []).every(
            (c) =>
              fields(c, ["leftOperand", "operator", "rightOperand", "datatype"]) &&
              ["dateTime", "purpose", "recipient"].includes(c.leftOperand) &&
              ["eq", "neq", "isAnyOf", "isNoneOf", "lt", "lteq", "gt", "gteq"].includes(
                c.operator,
              ) &&
              (c.datatype === undefined || iri(c.datatype)) &&
              (typeof c.rightOperand === "string" ||
                typeof c.rightOperand === "number" ||
                (Array.isArray(c.rightOperand) &&
                  c.rightOperand.every((v) => typeof v === "string" || typeof v === "number"))),
          ),
      ),
    )
  );
}
/** Import-only pilot OwnerMandate JWS verifier. There is deliberately no JWS issuer. */
export function createLegacyMandateVerifier(options: {
  read: () => Promise<string | undefined>;
  ownerWebId: string;
  agentWebId: string;
  resolvePinned: (kid: string) => Promise<LegacyPinnedKey | undefined>;
  isRevoked: (id: string) => Promise<boolean>;
  now: () => Date;
}): MandateVerifier {
  return {
    async load() {
      try {
        const jws = await options.read();
        if (!jws || jws.length > 256 * 1024) return undefined;
        const header = decodeProtectedHeader(jws);
        if (
          Object.keys(header).some((k) => !["alg", "kid", "typ"].includes(k)) ||
          header.typ !== "awp-mandate+jws" ||
          !["EdDSA", "ES256"].includes(header.alg as string) ||
          typeof header.kid !== "string"
        )
          return undefined;
        const pinned = await options.resolvePinned(header.kid);
        if (!pinned || pinned.subject !== options.ownerWebId || pinned.alg !== header.alg)
          return undefined;
        const verified = await compactVerify(jws, pinned.publicKey, { algorithms: [pinned.alg] });
        const m = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(verified.payload));
        const now = options.now().getTime();
        if (
          !fields(m, [
            "type",
            "id",
            "version",
            "issuer",
            "subject",
            "validFrom",
            "validUntil",
            "autonomous",
            "withApproval",
            "note",
          ]) ||
          (m.note !== undefined && typeof m.note !== "string") ||
          m.type !== "OwnerMandate" ||
          !Number.isInteger(m.version) ||
          m.version < 1 ||
          !iri(m.id) ||
          !validInstant(m.validFrom) ||
          !validInstant(m.validUntil) ||
          m.issuer !== options.ownerWebId ||
          m.subject !== options.agentWebId ||
          !(Date.parse(m.validFrom) <= now) ||
          !(Date.parse(m.validUntil) > now) ||
          !validPolicy(m.autonomous) ||
          !validPolicy(m.withApproval) ||
          (await options.isRevoked(m.id)) !== false
        )
          return undefined;
        return {
          id: m.id,
          issuer: m.issuer,
          subject: m.subject,
          validFrom: m.validFrom,
          validUntil: m.validUntil,
          autonomous: m.autonomous,
          withApproval: m.withApproval,
          prohibitions: [],
          limits: [],
        } satisfies Mandate;
      } catch {
        return undefined;
      }
    },
  };
}
