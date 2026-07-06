// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The content digest that CONTENT-LOCKS an owner confirmation to a specific proposal body.
 * The human-confirm gate approves the fully-rendered outbound content (§7); the confirmation
 * records this digest, and the executor authorizes a send ONLY if the CURRENT proposal still
 * hashes to it. So a deceived Actor cannot get a benign proposal confirmed and then swap the
 * body (recipient/text/times/action) before the send — the digest would no longer match.
 */
import { createHash } from "node:crypto";
import type { ActionProposal } from "./proposals.js";

/**
 * A deterministic, INJECTIVE canonical form. Uses JSON (fixed key order + a sorted array of
 * fully-structured time objects), so a delimiter / newline embedded in an attacker-controlled
 * field (`bodyText`, a time `name`, …) is escaped inside a JSON string and can NEVER make two
 * distinct proposals collide — unlike delimiter-joined concatenation.
 */
function canonicalContent(proposal: ActionProposal): string {
  const times = (proposal.offeredTimes ?? [])
    .map((t) => ({ startTime: t.startTime, endTime: t.endTime ?? null, name: t.name ?? null }))
    .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  return JSON.stringify({
    id: proposal.id,
    channel: proposal.channel,
    recipient: proposal.recipient,
    odrlAction: proposal.odrlAction,
    purpose: proposal.purpose ?? null,
    spend: proposal.spend ?? 0,
    subject: proposal.subject ?? null,
    inReplyTo: proposal.inReplyTo ?? null,
    body: proposal.bodyText,
    times,
  });
}

/** The `sha256:<hex>` content digest of a proposal's send-affecting fields. */
export function proposalContentDigest(proposal: ActionProposal): string {
  return `sha256:${createHash("sha256").update(canonicalContent(proposal), "utf8").digest("hex")}`;
}
