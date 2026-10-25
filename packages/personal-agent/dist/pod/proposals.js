// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The ACTION-PROPOSAL record — the ONLY thing the Actor writes, and the ONLY thing
 * the outbox executor sends. The Actor PROPOSES (writes a `pending` record); a human
 * CONFIRMS it (`pending → confirmed`); the executor executes ONLY `confirmed` records
 * (§2/§7). The record is serialised with `n3.Writer` + typed quads (never
 * hand-concatenated) and parsed from a `parseRdf` store (never a bespoke parser).
 *
 * Every field that ultimately derives from an untrusted inbound message (the
 * recipient, the body, times) is re-validated on BOTH write and read — a proposal
 * that does not parse cleanly is dropped, never sent (fail-closed).
 */
import { normalizeEmailAddress, safeHttpIri, sanitizeText } from "@jeswr/agentic-legacy-bridge";
import { ODRL_ACTIONS } from "@jeswr/solid-odrl";
import { DataFactory, Writer } from "n3";
import { AGENTIC_ACTION_PROPOSAL, AGENTIC_CHANNEL, AGENTIC_CONFIRM_FRICTION, AGENTIC_CONFIRMED_AT, AGENTIC_EXECUTED_AT, AGENTIC_HIGH_FRICTION, AGENTIC_IN_REPLY_TO, AGENTIC_LOW_FRICTION, AGENTIC_NOTE, AGENTIC_ODRL_ACTION, AGENTIC_PROPOSAL_CONFIRMED, AGENTIC_PROPOSAL_EXECUTED, AGENTIC_PROPOSAL_FAILED, AGENTIC_PROPOSAL_PENDING, AGENTIC_PROPOSAL_REJECTED, AGENTIC_PROPOSAL_STATUS, AGENTIC_SPEND, DCT, DPV_HAS_PURPOSE, PROV_WAS_DERIVED_FROM, RDF_TYPE, SCHEMA, SCHEMA_END_TIME, SCHEMA_NAME, SCHEMA_RECIPIENT, SCHEMA_START_TIME, SCHEMA_TEXT, XSD_DATE_TIME, XSD_INTEGER, } from "../vocab.js";
import { firstIriOf, firstLiteralOf, objectsOf, subjectsOf } from "./rdf-query.js";
const ODRL_ACTION_SET = new Set(ODRL_ACTIONS);
const { namedNode, literal, quad } = DataFactory;
const SCHEMA_ABOUT = `${SCHEMA}about`;
const SCHEMA_IDENTIFIER = `${SCHEMA}identifier`;
const DCT_CREATED = `${DCT}created`;
const DCT_SUBJECT = `${DCT}subject`;
const MAX_TEXT = 100_000;
const MAX_SUBJECT = 2_000;
const MAX_OFFERED_TIMES = 16;
const STATUS_TO_IRI = {
    pending: AGENTIC_PROPOSAL_PENDING,
    confirmed: AGENTIC_PROPOSAL_CONFIRMED,
    executed: AGENTIC_PROPOSAL_EXECUTED,
    failed: AGENTIC_PROPOSAL_FAILED,
    rejected: AGENTIC_PROPOSAL_REJECTED,
};
const IRI_TO_STATUS = new Map(Object.entries(STATUS_TO_IRI).map(([k, v]) => [v, k]));
/** Fold a proposal id into a url-safe resource slug (rejecting an unsafe id). */
export function proposalSlug(id) {
    if (typeof id !== "string" || id.length === 0 || id.length > 256)
        return undefined;
    // Only an already-safe slug alphabet — the Actor mints these ids itself; this is a
    // belt-and-braces guard so an id can never carry a path/IRIREF-forbidden char.
    if (!/^[A-Za-z0-9._-]+$/.test(id))
        return undefined;
    if (id === "." || id === "..")
        return undefined;
    return id;
}
/** The in-pod resource URL for a proposal id within a container. */
export function proposalUrl(container, id) {
    const slug = proposalSlug(id);
    if (!slug)
        return undefined;
    return `${container}${slug}.ttl`;
}
/** Canonicalise an ISO-8601 datetime to a UTC ISO string, or `undefined` if invalid. */
function utcIso(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 64)
        return undefined;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms))
        return undefined;
    return new Date(ms).toISOString();
}
/** Clamp a declared spend to a finite non-negative integer (default 0). */
function safeSpend(value) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return 0;
    const n = Math.trunc(value);
    return n < 0 ? 0 : n;
}
/** Validate + normalise a recipient handle for a channel (email is validated as an addr-spec). */
function safeRecipient(channel, recipient) {
    if (channel === "email")
        return normalizeEmailAddress(recipient);
    if (typeof recipient !== "string")
        return undefined;
    const clean = sanitizeText(recipient).trim();
    return clean.length > 0 && clean.length <= 512 ? clean : undefined;
}
/**
 * Serialise an {@link ActionProposal} to Turtle. Throws (fail-closed) if a load-bearing
 * field (channel / recipient / body) is missing or unsafe — a proposal that cannot be
 * represented safely is never written.
 */
export function serializeProposal(proposal, options) {
    const slug = proposalSlug(proposal.id);
    if (!slug)
        throw new Error("serializeProposal: unsafe proposal id");
    const channel = sanitizeText(proposal.channel).trim();
    if (channel.length === 0 || channel.length > 64) {
        throw new Error("serializeProposal: invalid channel");
    }
    const recipient = safeRecipient(channel, proposal.recipient);
    if (!recipient)
        throw new Error("serializeProposal: invalid recipient for channel");
    if (!ODRL_ACTION_SET.has(proposal.odrlAction)) {
        throw new Error("serializeProposal: invalid odrlAction");
    }
    const spend = safeSpend(proposal.spend);
    const body = sanitizeText(proposal.bodyText).slice(0, MAX_TEXT);
    if (body.length === 0)
        throw new Error("serializeProposal: empty body");
    const proposedAt = utcIso(proposal.proposedAt);
    if (!proposedAt)
        throw new Error("serializeProposal: invalid proposedAt");
    const subject = namedNode(`${options.resourceUrl}#it`);
    const writer = new Writer({ format: "text/turtle" });
    writer.addQuad(quad(subject, namedNode(RDF_TYPE), namedNode(AGENTIC_ACTION_PROPOSAL)));
    writer.addQuad(quad(subject, namedNode(SCHEMA_IDENTIFIER), literal(slug)));
    writer.addQuad(quad(subject, namedNode(AGENTIC_CHANNEL), literal(channel)));
    writer.addQuad(quad(subject, namedNode(SCHEMA_RECIPIENT), literal(recipient)));
    writer.addQuad(quad(subject, namedNode(SCHEMA_TEXT), literal(body)));
    writer.addQuad(quad(subject, namedNode(AGENTIC_ODRL_ACTION), literal(proposal.odrlAction)));
    writer.addQuad(quad(subject, namedNode(AGENTIC_SPEND), literal(String(spend), namedNode(XSD_INTEGER))));
    const purpose = safeHttpIri(proposal.purpose);
    if (purpose)
        writer.addQuad(quad(subject, namedNode(DPV_HAS_PURPOSE), namedNode(purpose)));
    writer.addQuad(quad(subject, namedNode(AGENTIC_PROPOSAL_STATUS), namedNode(STATUS_TO_IRI[proposal.status])));
    writer.addQuad(quad(subject, namedNode(AGENTIC_CONFIRM_FRICTION), namedNode(proposal.friction === "high" ? AGENTIC_HIGH_FRICTION : AGENTIC_LOW_FRICTION)));
    writer.addQuad(quad(subject, namedNode(DCT_CREATED), literal(proposedAt, namedNode(XSD_DATE_TIME))));
    if (proposal.subject !== undefined) {
        const subj = sanitizeText(proposal.subject).slice(0, MAX_SUBJECT);
        if (subj.length > 0)
            writer.addQuad(quad(subject, namedNode(DCT_SUBJECT), literal(subj)));
    }
    const inReplyTo = safeAnchor(proposal.inReplyTo);
    if (inReplyTo)
        writer.addQuad(quad(subject, namedNode(AGENTIC_IN_REPLY_TO), namedNode(inReplyTo)));
    const derivedFrom = safeAnchor(proposal.derivedFrom);
    if (derivedFrom) {
        writer.addQuad(quad(subject, namedNode(PROV_WAS_DERIVED_FROM), namedNode(derivedFrom)));
    }
    const confirmedAt = utcIso(proposal.confirmedAt);
    if (confirmedAt) {
        writer.addQuad(quad(subject, namedNode(AGENTIC_CONFIRMED_AT), literal(confirmedAt, namedNode(XSD_DATE_TIME))));
    }
    const executedAt = utcIso(proposal.executedAt);
    if (executedAt) {
        writer.addQuad(quad(subject, namedNode(AGENTIC_EXECUTED_AT), literal(executedAt, namedNode(XSD_DATE_TIME))));
    }
    if (proposal.note !== undefined) {
        const note = sanitizeText(proposal.note).slice(0, MAX_SUBJECT);
        if (note.length > 0)
            writer.addQuad(quad(subject, namedNode(AGENTIC_NOTE), literal(note)));
    }
    let index = 0;
    for (const time of proposal.offeredTimes ?? []) {
        if (index >= MAX_OFFERED_TIMES)
            break;
        const start = utcIso(time.startTime);
        if (!start)
            continue;
        const eventNode = namedNode(`${options.resourceUrl}#event-${index}`);
        writer.addQuad(quad(subject, namedNode(SCHEMA_ABOUT), eventNode));
        writer.addQuad(quad(eventNode, namedNode(RDF_TYPE), namedNode(`${SCHEMA}Event`)));
        writer.addQuad(quad(eventNode, namedNode(SCHEMA_START_TIME), literal(start, namedNode(XSD_DATE_TIME))));
        const end = utcIso(time.endTime);
        if (end) {
            writer.addQuad(quad(eventNode, namedNode(SCHEMA_END_TIME), literal(end, namedNode(XSD_DATE_TIME))));
        }
        if (time.name !== undefined) {
            const name = sanitizeText(time.name).slice(0, MAX_SUBJECT);
            if (name.length > 0)
                writer.addQuad(quad(eventNode, namedNode(SCHEMA_NAME), literal(name)));
        }
        index += 1;
    }
    return new Promise((resolve, reject) => {
        writer.end((err, result) => (err ? reject(err) : resolve(result)));
    });
}
/** Accept only a safe http(s) IRI or an injection-free `urn:` anchor (no IRIREF-forbidden chars). */
function safeAnchor(value) {
    const http = safeHttpIri(value);
    if (http)
        return http;
    if (typeof value !== "string")
        return undefined;
    return /^urn:[a-z0-9][a-z0-9-]{0,31}:[^\s<>"{}|\\^`]+$/i.test(value) ? value : undefined;
}
/**
 * Parse the single {@link ActionProposal} out of a store, or `undefined` if the store
 * carries no well-formed proposal. Fail-closed: an unknown status IRI reads as
 * `pending` (never `confirmed`), so a tampered status can never make the executor send.
 */
export function parseProposal(store) {
    const subjectTerm = subjectsOf(store, RDF_TYPE, namedNode(AGENTIC_ACTION_PROPOSAL))[0];
    if (!subjectTerm)
        return undefined;
    const subject = subjectTerm.value;
    const id = firstLiteralOf(store, subject, SCHEMA_IDENTIFIER);
    const slug = proposalSlug(id);
    const channelRaw = firstLiteralOf(store, subject, AGENTIC_CHANNEL);
    const channel = typeof channelRaw === "string" ? sanitizeText(channelRaw).trim() : "";
    const recipient = safeRecipient(channel, firstLiteralOf(store, subject, SCHEMA_RECIPIENT));
    const bodyText = firstLiteralOf(store, subject, SCHEMA_TEXT);
    const proposedAt = utcIso(firstLiteralOf(store, subject, DCT_CREATED));
    const odrlActionRaw = firstLiteralOf(store, subject, AGENTIC_ODRL_ACTION);
    const odrlAction = typeof odrlActionRaw === "string" && ODRL_ACTION_SET.has(odrlActionRaw)
        ? odrlActionRaw
        : undefined;
    if (!slug || channel.length === 0 || !recipient || !bodyText || !proposedAt || !odrlAction) {
        return undefined;
    }
    const purpose = safeHttpIri(firstIriOf(store, subject, DPV_HAS_PURPOSE));
    const spend = safeSpend(Number(firstLiteralOf(store, subject, AGENTIC_SPEND)));
    const statusIri = firstIriOf(store, subject, AGENTIC_PROPOSAL_STATUS);
    const status = (statusIri && IRI_TO_STATUS.get(statusIri)) || "pending";
    const frictionIri = firstIriOf(store, subject, AGENTIC_CONFIRM_FRICTION);
    const friction = frictionIri === AGENTIC_LOW_FRICTION ? "low" : "high";
    const subjectLine = firstLiteralOf(store, subject, DCT_SUBJECT);
    const inReplyTo = safeAnchor(firstIriOf(store, subject, AGENTIC_IN_REPLY_TO));
    const derivedFrom = safeAnchor(firstIriOf(store, subject, PROV_WAS_DERIVED_FROM));
    const confirmedAt = utcIso(firstLiteralOf(store, subject, AGENTIC_CONFIRMED_AT));
    const executedAt = utcIso(firstLiteralOf(store, subject, AGENTIC_EXECUTED_AT));
    const note = firstLiteralOf(store, subject, AGENTIC_NOTE);
    const offeredTimes = [];
    for (const eventTerm of objectsOf(store, subject, SCHEMA_ABOUT)) {
        if (eventTerm.termType !== "NamedNode")
            continue;
        if (offeredTimes.length >= MAX_OFFERED_TIMES)
            break;
        const start = utcIso(firstLiteralOf(store, eventTerm.value, SCHEMA_START_TIME));
        if (!start)
            continue;
        const end = utcIso(firstLiteralOf(store, eventTerm.value, SCHEMA_END_TIME));
        const name = firstLiteralOf(store, eventTerm.value, SCHEMA_NAME);
        offeredTimes.push({
            startTime: start,
            ...(end ? { endTime: end } : {}),
            ...(name ? { name: sanitizeText(name).slice(0, MAX_SUBJECT) } : {}),
        });
    }
    return {
        id: slug,
        channel,
        recipient,
        odrlAction,
        ...(purpose ? { purpose } : {}),
        spend,
        status,
        friction,
        bodyText: sanitizeText(bodyText).slice(0, MAX_TEXT),
        ...(subjectLine ? { subject: sanitizeText(subjectLine).slice(0, MAX_SUBJECT) } : {}),
        ...(inReplyTo ? { inReplyTo } : {}),
        ...(derivedFrom ? { derivedFrom } : {}),
        ...(offeredTimes.length ? { offeredTimes } : {}),
        proposedAt,
        ...(confirmedAt ? { confirmedAt } : {}),
        ...(executedAt ? { executedAt } : {}),
        ...(note ? { note: sanitizeText(note).slice(0, MAX_SUBJECT) } : {}),
    };
}
//# sourceMappingURL=proposals.js.map