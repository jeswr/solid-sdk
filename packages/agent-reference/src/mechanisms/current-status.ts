// AUTHORED-BY Codex GPT-6
import { DEFAULT_LIMITS } from "../core/limits.js";
import type { ReasonCode, VerificationResult } from "../core/types.js";
import { type DocumentResolver, statusListSchema } from "./organizations.js";
import { verifyStatement } from "./statements.js";
import type { TrustStore } from "./trust.js";

export async function currentStatus(options: {
  issuer: string;
  reference: { ref: string; id: string };
  resolver: DocumentResolver;
  trust: TrustStore;
  now: string;
  verifier: string;
  maxAgeSeconds: number;
  record: (v: VerificationResult) => void;
}): Promise<{ ok: true } | { ok: false; reason: ReasonCode }> {
  let jws: string | undefined;
  try {
    jws = await options.resolver.resolve(options.reference.ref);
  } catch {}
  if (!jws) return { ok: false, reason: "lookup-failed" };
  const args = {
    trust: options.trust,
    typ: "awp-status-list+jws",
    schema: statusListSchema,
    limits: DEFAULT_LIMITS,
    at: options.now,
    verifier: options.verifier,
  };
  let check = await verifyStatement(jws, { ...args, role: "issuer" });
  if (check.verification.outcome === "unknown-key")
    check = await verifyStatement(jws, { ...args, role: "party" });
  options.record(check.verification);
  const status = check.payload;
  if (
    !status ||
    check.signer?.subject !== options.issuer ||
    status.issuer !== options.issuer ||
    status.id !== options.reference.ref
  )
    return { ok: false, reason: "evidence-invalid" };
  const age = Date.parse(options.now) - Date.parse(status.issuedAt);
  if (
    age < 0 ||
    age > options.maxAgeSeconds * 1000 ||
    Date.parse(status.validUntil) <= Date.parse(options.now)
  )
    return { ok: false, reason: "lookup-failed" };
  return status.entries[options.reference.id] === "active"
    ? { ok: true }
    : {
        ok: false,
        reason:
          status.entries[options.reference.id] === "withdrawn"
            ? "status-withdrawn"
            : "lookup-failed",
      };
}
