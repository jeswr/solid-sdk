// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The content digest that CONTENT-LOCKS an owner confirmation to a specific proposal body.
 * The human-confirm gate approves the fully-rendered outbound content (§7); the confirmation
 * records this digest, and the executor authorizes a send ONLY if the CURRENT proposal still
 * hashes to it. So a deceived Actor cannot get a benign proposal confirmed and then swap the
 * body (recipient/text/times/action) before the send — the digest would no longer match.
 */
import { createHash } from "node:crypto";
/** A deterministic canonical string over every load-bearing, send-affecting field. */
function canonicalContent(proposal) {
    const times = [...(proposal.offeredTimes ?? [])]
        .map((t) => `${t.startTime}|${t.endTime ?? ""}|${t.name ?? ""}`)
        .sort()
        .join(";");
    return [
        `id=${proposal.id}`,
        `channel=${proposal.channel}`,
        `recipient=${proposal.recipient}`,
        `odrlAction=${proposal.odrlAction}`,
        `purpose=${proposal.purpose ?? ""}`,
        `spend=${proposal.spend ?? 0}`,
        `subject=${proposal.subject ?? ""}`,
        `inReplyTo=${proposal.inReplyTo ?? ""}`,
        `body=${proposal.bodyText}`,
        `times=${times}`,
    ].join("\n");
}
/** The `sha256:<hex>` content digest of a proposal's send-affecting fields. */
export function proposalContentDigest(proposal) {
    return `sha256:${createHash("sha256").update(canonicalContent(proposal), "utf8").digest("hex")}`;
}
//# sourceMappingURL=digest.js.map