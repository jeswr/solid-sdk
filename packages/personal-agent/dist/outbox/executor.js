// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The OUTBOX EXECUTOR — the deterministic, NO-LLM enforcement point (§2/§5/§7 + the ODRL
 * mandate directive). It is the security boundary: it holds the per-channel send tokens, it
 * evaluates the owner's SIGNED ODRL mandate against EVERY outbound intent DENY-BY-DEFAULT,
 * and it is the only component that transmits anything.
 *
 * CRITICALLY, it derives NO authorization or idempotency state from the Actor-writable
 * proposal resource (whose `status` field a deceived/prompt-injected Actor could forge):
 *  1. the mandate is loaded + signature-verified ONCE; if that fails, it REFUSES ALL ACTIONS
 *     (fail-closed — the mandate-tamper case);
 *  2. idempotency is the presence of a RECEIPT in the OUTBOX — an Actor-UNWRITABLE container —
 *     so a re-run (or an Actor resetting the proposal's status) can never cause a double-send;
 *  3. `evaluate()` decides `permit` (autonomous) / `prohibited` (never) / `confirm-required`;
 *  4. a `confirm-required` intent is authorized ONLY by an owner CONFIRMATION in the
 *     Actor-UNWRITABLE confirmations container, content-locked to the proposal's CURRENT digest
 *     (so the Actor can neither forge a confirmation nor swap the body after it was confirmed);
 *  5. the send is CLAIMED by a create-only receipt write (at-most-once) before transmitting;
 *  6. every outcome (sent / rejected / failed) is a PROV receipt referencing the mandate + the
 *     authorizing permit (or the owner confirmation).
 */
import { buildReply, metadata, } from "@jeswr/agentic-legacy-bridge";
import { isSafeContainer } from "../config.js";
import { evaluateAutonomy } from "../mandate/evaluate.js";
import { writeOwnerOnlyAcl } from "../pod/acl.js";
import { readConfirmation } from "../pod/confirmation-store.js";
import { proposalContentDigest } from "../pod/digest.js";
import { listProposals } from "../pod/proposal-store.js";
import { putResource, refuseRedirect, throwIfNotWritten } from "../pod/write.js";
import { serializeSendReceipt } from "./receipt.js";
const EMPTY_RESULT = {
    mandateLoaded: false,
    sent: 0,
    queuedForConfirmation: 0,
    prohibited: 0,
    failed: 0,
    skipped: 0,
};
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
async function buildCarrier(proposal, executedAt, config) {
    const senderFields = config.agentWebId
        ? { sender: config.agentWebId, issuer: config.agentWebId }
        : {};
    if (proposal.inReplyTo) {
        return buildReply({
            inReplyTo: proposal.inReplyTo,
            ...(proposal.offeredTimes ? { offeredTimes: proposal.offeredTimes } : {}),
            dateSent: executedAt,
            ...senderFields,
            ...(config.sign ? { sign: config.sign } : {}),
        });
    }
    return metadata.buildActionMetadata({
        sentAt: executedAt,
        ...senderFields,
        ...(proposal.derivedFrom ? { derivedFrom: proposal.derivedFrom } : {}),
        ...(config.sign ? { sign: config.sign } : {}),
    });
}
function assembleMessage(proposal, carrier) {
    const textBody = carrier.onboardingBlock
        ? `${proposal.bodyText}\n\n${carrier.onboardingBlock}`
        : proposal.bodyText;
    const htmlBody = `<p>${escapeHtml(proposal.bodyText)}</p>\n${carrier.inlineHtml}`;
    return {
        channel: proposal.channel,
        to: proposal.recipient,
        ...(proposal.subject ? { subject: proposal.subject } : {}),
        textBody,
        htmlBody,
        headers: carrier.headers,
        mimeParts: [
            { contentType: "text/plain; charset=utf-8", body: textBody },
            { contentType: "text/html; charset=utf-8", body: htmlBody },
            carrier.mimePart,
        ],
        ...(proposal.inReplyTo ? { inReplyToId: proposal.inReplyTo } : {}),
    };
}
/** GET a resource to test existence (200 → exists). Redirect-refused. */
async function resourceExists(fetchFn, url) {
    const res = await fetchFn(url, { method: "GET", redirect: "manual" });
    refuseRedirect(res, "GET", url);
    return res.ok;
}
/**
 * Write a receipt into the outbox. `createOnly` makes it the at-most-once CLAIM (`If-None-Match:
 * *`): a `412` means another run already claimed the send → returns `false`. A normal write
 * (finalize) overwrites the claim with the final outcome. Returns `true` on write, `false` on a
 * lost claim race.
 */
async function putReceipt(config, proposal, proposalUrl, executedAt, outcome, basis, extra, createOnly, mandateId) {
    const resourceUrl = `${config.outbox}${proposal.id}.ttl`;
    const receipt = {
        resourceUrl,
        proposalUrl,
        outcome,
        channel: proposal.channel,
        recipient: proposal.recipient,
        executedAt,
        ...(config.agentWebId ? { agentWebId: config.agentWebId } : {}),
        ...(proposal.derivedFrom ? { derivedFrom: proposal.derivedFrom } : {}),
        ...(mandateId ? { mandateId } : {}),
        ...(basis.autonomous
            ? {
                ...(basis.permitId ? { permitId: basis.permitId } : {}),
                ...(basis.permitLabel ? { permitLabel: basis.permitLabel } : {}),
            }
            : { authorizedByConfirmation: true }),
        ...(extra.channelMessageId ? { channelMessageId: extra.channelMessageId } : {}),
        ...(extra.note ? { note: extra.note } : {}),
    };
    const turtle = await serializeSendReceipt(receipt);
    const res = await putResource(config.writeFetch, resourceUrl, turtle, {
        contentType: "text/turtle",
        base: config.outbox,
        ...(createOnly ? { ifNoneMatch: "*" } : {}),
    });
    if (createOnly && res.status === 412)
        return false;
    throwIfNotWritten(res, resourceUrl);
    return true;
}
/** Run one deterministic, mandate-enforced outbox pass. */
export async function runOutboxOnce(config) {
    for (const container of [config.proposals, config.confirmations, config.outbox]) {
        if (!isSafeContainer(container))
            throw new Error(`runOutboxOnce: unsafe container ${container}`);
    }
    const now = config.now ?? (() => new Date());
    // Fail-closed: an unverifiable / tampered / wrong-issuer mandate ⇒ refuse ALL actions.
    const mandate = await config.verifier.load();
    if (!mandate || mandate.issuer !== config.ownerWebId)
        return EMPTY_RESULT;
    const loaded = await listProposals(config.readFetch, config.proposals);
    let sent = 0;
    let queuedForConfirmation = 0;
    let prohibited = 0;
    let failed = 0;
    let skipped = 0;
    let outboxAclEnsured = false;
    const ensureOutboxAcl = async () => {
        if (!outboxAclEnsured) {
            await writeOwnerOnlyAcl(config.writeFetch, config.outbox, config.ownerWebId);
            outboxAclEnsured = true;
        }
    };
    for (const { proposal, url } of loaded) {
        // A TERMINAL proposal status is a fail-closed SKIP marker (never trusted to SEND, only to
        // NOT send): it guards legacy/pre-receipt proposals from the old status-based model against
        // being re-sent after upgrade. Only `pending`/`confirmed` are candidates; a forged terminal
        // status can at most SUPPRESS the Actor's own proposal (not escalate).
        if (proposal.status !== "pending" && proposal.status !== "confirmed") {
            skipped += 1;
            continue;
        }
        const receiptUrl = `${config.outbox}${proposal.id}.ttl`;
        // Idempotency is the Actor-UNwritable receipt — NOT the Actor-writable proposal status.
        if (await resourceExists(config.readFetch, receiptUrl)) {
            skipped += 1;
            continue;
        }
        const verdict = evaluateAutonomy(mandate.policy, proposal, {
            ...(config.agentWebId ? { agentWebId: config.agentWebId } : {}),
            now: now(),
        });
        const executedAt = now().toISOString();
        if (verdict.decision === "prohibited") {
            await ensureOutboxAcl();
            await putReceipt(config, proposal, url, executedAt, "rejected", { autonomous: true }, { note: `prohibited by mandate: ${verdict.reason}` }, true, mandate.credentialId);
            prohibited += 1;
            continue;
        }
        const autonomous = verdict.decision === "permit";
        if (!autonomous) {
            // A confirm-required intent is authorized ONLY by an owner confirmation whose CONTENT
            // DIGEST matches the CURRENT proposal — forgery- and swap-proof.
            const confirmation = await readConfirmation(config.readFetch, config.confirmations, proposal.id);
            if (!confirmation || confirmation.contentDigest !== proposalContentDigest(proposal)) {
                queuedForConfirmation += 1;
                continue;
            }
        }
        const basis = autonomous
            ? {
                autonomous: true,
                ...(verdict.permit?.id ? { permitId: verdict.permit.id } : {}),
                ...(verdict.permit?.action ? { permitLabel: verdict.permit.action } : {}),
            }
            : { autonomous: false };
        await ensureOutboxAcl();
        const sender = config.senders[proposal.channel];
        if (!sender) {
            await putReceipt(config, proposal, url, executedAt, "failed", basis, { note: `no sender for channel ${proposal.channel}` }, true, mandate.credentialId);
            failed += 1;
            continue;
        }
        // CLAIM the send (create-only receipt, outcome `claimed`) BEFORE transmitting — at-most-once.
        // It is finalized to `sent` ONLY after a successful transmit, so a crash between the claim
        // and the send leaves an honest `claimed` (never a false `sent`) and is never re-sent.
        const claimed = await putReceipt(config, proposal, url, executedAt, "claimed", basis, {}, true, mandate.credentialId);
        if (!claimed) {
            skipped += 1; // another run already claimed this proposal
            continue;
        }
        try {
            const carrier = await buildCarrier(proposal, executedAt, config);
            const message = assembleMessage(proposal, carrier);
            const receipt = await sender(message); // the actual transmit — the token lives here
            await putReceipt(config, proposal, url, executedAt, "sent", basis, receipt.channelMessageId ? { channelMessageId: receipt.channelMessageId } : {}, false, mandate.credentialId);
            sent += 1;
        }
        catch {
            await putReceipt(config, proposal, url, executedAt, "failed", basis, { note: "send failed after claim" }, false, mandate.credentialId);
            failed += 1;
        }
    }
    return { mandateLoaded: true, sent, queuedForConfirmation, prohibited, failed, skipped };
}
//# sourceMappingURL=executor.js.map