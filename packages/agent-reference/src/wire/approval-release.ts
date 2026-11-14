// AUTHORED-BY Codex GPT-6
/** Construction/persistence boundary: snapshot the fields the pending continuation will release. */
import { digestOf } from "../core/canonical.js";
import { DEFAULT_LIMITS, parseBoundedJson } from "../core/limits.js";
import type { ActionIntent, Json, JsonObject, OperationRef } from "../core/types.js";
import type { ApprovalReleaseBinding } from "../gates/approval-release.js";
import { actionDigest } from "../mechanisms/mandate.js";
import { copyData } from "../model/copy.js";
import type { HandlerReply, OutboundPlan } from "../runtime/operations.js";

export function intentEvidenceMatches(value: string, digest: string): boolean {
  try {
    return (
      actionDigest(parseBoundedJson(value, DEFAULT_LIMITS) as unknown as ActionIntent) === digest
    );
  } catch {
    return false;
  }
}
export function snapshotApprovalRelease(
  intent: ActionIntent,
  continuation: {
    type: string;
    operation?: OperationRef;
    terms?: JsonObject;
    input?: JsonObject;
    basis?: JsonObject | string;
    purpose?: string;
    reply?: HandlerReply;
    plan?: OutboundPlan | object;
  },
  proposal?: { id: string; termsDigest: string },
  terms?: Json,
): ApprovalReleaseBinding {
  const binding: ApprovalReleaseBinding = { intentDigest: actionDigest(intent), fields: {} };
  if (continuation.type === "propose" && continuation.terms) {
    binding.kind = "propose";
    binding.fields = {
      operation: continuation.operation,
      terms: continuation.terms,
      termsDigest: digestOf(continuation.terms),
    };
  } else if (continuation.type === "invoke") {
    binding.kind = "invoke";
    binding.fields = {
      operation: continuation.operation,
      basis: continuation.basis,
      purpose: continuation.purpose ?? intent.purpose ?? null,
      challenge: intent.parameters.challenge ?? null,
    };
    if (intent.action !== "pay") binding.fields.input = continuation.input;
  } else if (continuation.type === "message") {
    const plan = continuation.plan as OutboundPlan;
    binding.kind = plan.kind;
    binding.fields = plan.body as Record<string, unknown>;
  } else if (continuation.type === "reply") {
    const reply = continuation.reply;
    if (reply?.type === "accept") {
      binding.kind = "accept";
      binding.fields = {
        proposal: proposal?.id,
        termsDigest: proposal?.termsDigest,
        selection: reply.selection ?? null,
      };
      if (terms) {
        binding.termsDigest = digestOf(terms);
        binding.carriedIntent = !!(terms as JsonObject).compensation;
      }
    } else if (reply?.type === "deliver") {
      binding.kind = "deliver";
      binding.fields = { output: reply.output };
    } else if (reply?.type === "counter") {
      binding.kind = "propose";
      binding.fields = { terms: reply.terms, termsDigest: digestOf(reply.terms) };
    }
  }
  return copyData(binding);
}
