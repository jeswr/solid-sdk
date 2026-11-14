// AUTHORED-BY Codex GPT-6
/** Pre-action approval binds the intent and terms; release binds the eventual whole message. */
import { digestOf } from "../core/canonical.js";
import { actionDigest } from "../mechanisms/mandate.js";
import { isClaimEvidence, unverifiedEvidenceClaim } from "../mechanisms/selective.js";
import type { ActionIntentNode, MessageNode } from "../model/message-nodes.js";
import type { TraceSink } from "../trace/recorder.js";
import { intentEvidenceMatches } from "../wire/approval-release.js";

export interface ApprovalReleaseBinding {
  intentDigest: string;
  kind?: string;
  fields: Record<string, unknown>;
  termsDigest?: string;
  carriedIntent?: boolean;
}
export function checkApprovalRelease(input: {
  message: MessageNode;
  intent: ActionIntentNode;
  binding: ApprovalReleaseBinding;
  termsDigest?: string;
  paymentMatches?: boolean;
  sink?: TraceSink;
}): boolean {
  const m = input.message.live;
  const carried = (m.evidence ?? []).filter((e) => e.format === "awp-action-intent/0.1");
  const followingAcceptance = input.binding.kind === "accept" && m.kind === "deliver";
  const approvedEvidence = input.intent.live.parameters.evidence;
  const deliveredEvidence = (m.evidence ?? [])
    .filter(isClaimEvidence)
    .map((e) => unverifiedEvidenceClaim(e).id)
    .sort();
  const sameDisclosure =
    followingAcceptance &&
    Array.isArray(approvedEvidence) &&
    digestOf([...approvedEvidence].sort()) === digestOf(deliveredEvidence) &&
    m.body.operation.id === input.intent.live.operation &&
    m.to?.party === input.intent.live.recipient;
  const valid =
    actionDigest(input.intent.live) === input.binding.intentDigest &&
    (!input.binding.kind || m.kind === input.binding.kind || sameDisclosure) &&
    (!input.binding.termsDigest || input.binding.termsDigest === input.termsDigest) &&
    (sameDisclosure ||
      Object.entries(input.binding.fields).every(
        ([field, value]) =>
          digestOf((m.body as Record<string, unknown>)[field] ?? null) === digestOf(value ?? null),
      )) &&
    (!input.binding.carriedIntent || carried.length === 1) &&
    carried.every((e) => intentEvidenceMatches(e.value, input.binding.intentDigest)) &&
    input.paymentMatches !== false;
  if (!valid) {
    input.sink?.emit({
      part: "outbound-gate",
      kind: "check",
      check: "limits-approval",
      verdict: "fail",
      reason: "approval-mismatch",
      caption: "The message differs from the intent or terms the principal approved.",
    });
    input.sink?.emit({
      part: "outbound-gate",
      kind: "decision",
      outcome: "stop",
      reason: "approval-mismatch",
      caption: "The gate stops the changed message before signing.",
    });
  }
  return valid;
}
