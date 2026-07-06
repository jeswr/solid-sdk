// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The OUTBOX EXECUTOR — the deterministic, NO-LLM enforcement point (§2/§5/§7 + the ODRL
 * mandate directive). It is the security boundary: it holds the per-channel send tokens, it
 * evaluates the owner's SIGNED ODRL mandate against EVERY outbound intent DENY-BY-DEFAULT,
 * and it is the only component that transmits anything.
 *
 * Per confirmed/pending proposal it:
 *  1. loads + signature-verifies the mandate ONCE; if that fails, REFUSES ALL ACTIONS
 *     (fail-closed — the mandate-tamper case);
 *  2. evaluates the intent (`@jeswr/solid-odrl` `evaluate`): `permit` → autonomous;
 *     `prohibited` → never; `confirm-required` → only if the owner explicitly confirmed;
 *  3. CLAIMS the proposal by compare-and-swap (`pending/confirmed → executed`) BEFORE sending,
 *     so two executor runs can never both send the same proposal (at-most-once);
 *  4. builds the §5.2 signed carrier (`buildReply` / `buildActionMetadata`) and transmits via
 *     the channel sender;
 *  5. writes an owner-private PROV receipt referencing the mandate + the specific permit (or
 *     the owner confirmation) that authorized the send.
 *
 * The LLM-side Actor cannot bypass any of this: it holds no send tokens and cannot write its
 * own mandate. An intent the Actor crafted to *look* permitted but that misses a constraint is
 * denied here at evaluation time.
 */
import { buildReply, metadata, } from "@jeswr/agentic-legacy-bridge";
import { isSafeContainer } from "../config.js";
import { evaluateAutonomy } from "../mandate/evaluate.js";
import { writeOwnerOnlyAcl } from "../pod/acl.js";
import { listProposals, readProposal, updateProposal } from "../pod/proposal-store.js";
import { putResource, throwIfNotWritten } from "../pod/write.js";
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
/** Best-effort transition of a proposal's status (re-reads to CAS on a fresh ETag). */
async function markStatus(config, proposalId, proposalUrl, next) {
    try {
        const loaded = await readProposal(config.readFetch, proposalUrl);
        if (!loaded?.etag || loaded.proposal.id !== proposalId)
            return;
        await updateProposal(config.writeFetch, config.proposals, next, loaded.etag);
    }
    catch {
        // Best-effort — a failed status write never double-sends and never aborts the batch.
    }
}
/** Run one deterministic, mandate-enforced outbox pass. */
export async function runOutboxOnce(config) {
    if (!isSafeContainer(config.proposals))
        throw new Error("runOutboxOnce: unsafe proposals container");
    if (!isSafeContainer(config.outbox))
        throw new Error("runOutboxOnce: unsafe outbox container");
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
    for (const { proposal, url, etag } of loaded) {
        if (proposal.status !== "pending" && proposal.status !== "confirmed") {
            skipped += 1;
            continue;
        }
        const verdict = evaluateAutonomy(mandate.policy, proposal, {
            ...(config.agentWebId ? { agentWebId: config.agentWebId } : {}),
            now: now(),
        });
        if (verdict.decision === "prohibited") {
            if (etag) {
                await markStatus(config, proposal.id, url, {
                    ...proposal,
                    status: "rejected",
                    note: `prohibited by mandate: ${verdict.reason}`.slice(0, 500),
                });
            }
            prohibited += 1;
            continue;
        }
        const autonomous = verdict.decision === "permit";
        if (!autonomous && proposal.status !== "confirmed") {
            queuedForConfirmation += 1;
            continue;
        }
        // CLAIM before send (at-most-once). No ETag ⇒ cannot guarantee it ⇒ skip (never risk a double-send).
        if (!etag) {
            skipped += 1;
            continue;
        }
        const executedAt = now().toISOString();
        const claimed = { ...proposal, status: "executed", executedAt };
        let claimOk;
        try {
            claimOk = await updateProposal(config.writeFetch, config.proposals, claimed, etag);
        }
        catch {
            failed += 1;
            continue;
        }
        if (!claimOk) {
            skipped += 1; // lost the race — another executor claimed it
            continue;
        }
        const sender = config.senders[proposal.channel];
        if (!sender) {
            await markStatus(config, proposal.id, url, {
                ...claimed,
                status: "failed",
                note: `no sender for channel ${proposal.channel}`,
            });
            failed += 1;
            continue;
        }
        try {
            if (!outboxAclEnsured) {
                await writeOwnerOnlyAcl(config.writeFetch, config.outbox, config.ownerWebId);
                outboxAclEnsured = true;
            }
            const carrier = await buildCarrier(proposal, executedAt, config);
            const message = assembleMessage(proposal, carrier);
            const receipt = await sender(message); // the actual transmit — the token lives here
            await writeReceipt(config, proposal, url, executedAt, receipt.channelMessageId, {
                autonomous,
                mandateId: mandate.credentialId,
                permitId: verdict.permit?.id,
                permitLabel: verdict.permit?.action,
            });
            sent += 1;
        }
        catch {
            await markStatus(config, proposal.id, url, {
                ...claimed,
                status: "failed",
                note: "send failed after claim",
            });
            failed += 1;
        }
    }
    return { mandateLoaded: true, sent, queuedForConfirmation, prohibited, failed, skipped };
}
async function writeReceipt(config, proposal, proposalUrl, executedAt, channelMessageId, basis) {
    const resourceUrl = `${config.outbox}${proposal.id}.ttl`;
    const turtle = await serializeSendReceipt({
        resourceUrl,
        proposalUrl,
        channel: proposal.channel,
        recipient: proposal.recipient,
        executedAt,
        ...(config.agentWebId ? { agentWebId: config.agentWebId } : {}),
        ...(proposal.derivedFrom ? { derivedFrom: proposal.derivedFrom } : {}),
        ...(basis.mandateId ? { mandateId: basis.mandateId } : {}),
        ...(basis.autonomous
            ? {
                ...(basis.permitId ? { permitId: basis.permitId } : {}),
                ...(basis.permitLabel ? { permitLabel: basis.permitLabel } : {}),
            }
            : { authorizedByConfirmation: true }),
        ...(channelMessageId ? { channelMessageId } : {}),
    });
    const res = await putResource(config.writeFetch, resourceUrl, turtle, {
        contentType: "text/turtle",
        base: config.outbox,
    });
    throwIfNotWritten(res, resourceUrl);
}
//# sourceMappingURL=executor.js.map