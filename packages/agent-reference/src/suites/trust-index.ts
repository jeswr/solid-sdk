// AUTHORED-BY Codex GPT-6
/** JSON-encoded transparency receipts. Source signatures remain a separate admission check. */
import { z } from "zod";
import { digestBytes } from "../core/canonical.js";
import { DEFAULT_LIMITS } from "../core/limits.js";
import type { EvidenceItem } from "../core/types.js";
import { verifyConsistency, verifyInclusion } from "../mechanisms/merkle-log.js";
import { verifyStatement } from "../mechanisms/statements.js";
import type { TrustStore } from "../mechanisms/trust.js";
import { SuiteValuesNode } from "../model/suite-values.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const headSchema = z.strictObject({
  type: z.literal("SignedTreeHead"),
  issuer: z.string(),
  treeSize: z.number().int().positive().max(4096),
  rootHash: hash,
  at: z.iso.datetime(),
});
export const receiptSchema = z.strictObject({
  type: z.literal("IndexReceipt"),
  issuer: z.string(),
  recordDigest: z.string(),
  leafIndex: z.number().int().nonnegative(),
  head: z.string().max(16384),
  previousHead: z.string().max(16384),
  inclusion: z.array(hash).max(64),
  consistency: z.array(hash).max(64),
  coverage: z.strictObject({
    sources: z.array(z.string()).max(64),
    register: z.string(),
    order: z.literal("source-submission-order"),
  }),
});
export interface IndexPolicy {
  readonly source: string;
  readonly checkpoint: string;
  readonly sources: readonly string[];
  readonly register: string;
}
export async function checkIndexReceipt(
  record: EvidenceItem,
  evidence: readonly EvidenceItem[],
  policy: IndexPolicy,
  trust: TrustStore,
  at: string,
  verifier: string,
  recordCheck: <T extends { type: string }>(entry: T) => void,
): Promise<boolean> {
  try {
    const authority = trust.assessSource({
      evaluator: verifier,
      source: policy.source,
      claimType: "index.transparency",
      subject: policy.source,
      at,
    });
    if (authority.outcome !== "accepted") return false;
    const check = async (jws: string, schema: z.ZodType) => {
      const options = {
        trust,
        typ: schema === headSchema ? "awp-index-head+jws" : "awp-index-receipt+jws",
        schema,
        limits: DEFAULT_LIMITS,
        at,
        verifier,
        algs: ["EdDSA"] as const,
      };
      let result = await verifyStatement(jws, { ...options, role: "issuer" });
      if (result.verification.outcome === "unknown-key")
        result = await verifyStatement(jws, { ...options, role: "party" });
      recordCheck(result.verification);
      if (
        result.verification.outcome !== "valid" ||
        result.signer?.subject !== policy.source ||
        !result.payload
      )
        return undefined;
      const node = SuiteValuesNode.fromSignedPayload(result.payload);
      return node.string("issuer") === policy.source ? node : undefined;
    };
    const old = await check(policy.checkpoint, headSchema);
    if (!old) return false;
    const recordDigest = digestBytes(record.value);
    for (const item of evidence.filter(
      (e) => e.role === "membership" && e.format === "index-receipt+jws",
    )) {
      const receipt = await check(item.value, receiptSchema);
      if (!receipt || receipt.string("recordDigest") !== recordDigest) continue;
      const head = await check(receipt.string("head")!, headSchema);
      if (!head) return false;
      const coverage = receipt.node("coverage");
      if (
        !coverage ||
        coverage.string("register") !== policy.register ||
        coverage.string("order") !== "source-submission-order" ||
        coverage.strings("sources").length !== policy.sources.length ||
        !policy.sources.every((s) => coverage.strings("sources").includes(s))
      )
        return false;
      const headAt = Date.parse(head.string("at")!),
        oldAt = Date.parse(old.string("at")!),
        now = Date.parse(at);
      const valid =
        receipt.string("previousHead") === policy.checkpoint &&
        headAt >= oldAt &&
        headAt <= now &&
        now - headAt <= 86_400_000 &&
        verifyInclusion(
          record.value,
          receipt.number("leafIndex")!,
          head.number("treeSize")!,
          receipt.strings("inclusion"),
          head.string("rootHash")!,
        ) &&
        verifyConsistency(
          old.number("treeSize")!,
          head.number("treeSize")!,
          old.string("rootHash")!,
          head.string("rootHash")!,
          receipt.strings("consistency"),
        );
      recordCheck({
        type: "index-history-check",
        previousHead: policy.checkpoint,
        head: receipt.string("head"),
        record: recordDigest,
        outcome: valid ? "valid" : "invalid",
        mechanism: "RFC 9162 inclusion and consistency; JSON stand-in for COSE",
      });
      return valid;
    }
    return false;
  } catch {
    return false;
  }
}
