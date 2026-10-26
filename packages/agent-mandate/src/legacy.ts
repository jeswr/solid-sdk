// AUTHORED-BY Codex GPT-6.1-Sol
import { compactVerify, decodeProtectedHeader } from "jose";
import { supportedPolicy } from "./policy.js";
import type { Mandate, MandateVerifier, Policy } from "./types.js";

/** A locally pinned pilot key; document-supplied JWKs and key URLs are never accepted. */
export interface LegacyPinnedKey {
  readonly publicKey: CryptoKey;
  readonly subject: string;
  readonly alg: "EdDSA" | "ES256";
}
function validPolicy(p: Policy): boolean {
  return (
    typeof p.id === "string" &&
    supportedPolicy(p) &&
    (p.obligations ?? []).length === 0 &&
    [...(p.permissions ?? []), ...(p.prohibitions ?? [])].every(
      (r) =>
        ["use", "read", "distribute", "compensate", "transfer"].includes(r.action) &&
        (r.type === "permission" || r.type === "prohibition") &&
        (r.type !== "permission" || typeof r.target === "string") &&
        (r.duties ?? []).length === 0 &&
        (r.constraints ?? []).every(
          (c) =>
            ["dateTime", "purpose", "recipient"].includes(c.leftOperand) &&
            (typeof c.rightOperand === "string" ||
              typeof c.rightOperand === "number" ||
              (Array.isArray(c.rightOperand) &&
                c.rightOperand.every((v) => typeof v === "string" || typeof v === "number"))),
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
        if (
          m.type !== "OwnerMandate" ||
          !Number.isInteger(m.version) ||
          m.version < 1 ||
          typeof m.id !== "string" ||
          m.issuer !== options.ownerWebId ||
          m.subject !== options.agentWebId ||
          !(Date.parse(m.validFrom) <= options.now().getTime()) ||
          !(Date.parse(m.validUntil) > options.now().getTime()) ||
          !validPolicy(m.autonomous) ||
          !validPolicy(m.withApproval) ||
          (await options.isRevoked(m.id))
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
