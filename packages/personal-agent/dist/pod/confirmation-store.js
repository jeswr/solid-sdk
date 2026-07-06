// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The OWNER-ONLY confirmation record — the unforgeable human-confirm gate for a
 * `confirm-required` intent. It lives in a container the Actor CANNOT write (the Actor's
 * gate only permits the proposals container), so the executor's confirmation check cannot be
 * spoofed by a deceived/prompt-injected Actor. Each record binds a proposal id to a CONTENT
 * DIGEST, so it authorizes exactly the content the owner approved.
 *
 * Serialised via `n3.Writer` + typed quads; parsed via `parseRdf` + `.match()`.
 */
import { DataFactory, Writer } from "n3";
import { isSafeContainer } from "../config.js";
import { AGENTIC_CONFIRMATION, AGENTIC_CONFIRMED_AT, AGENTIC_CONFIRMS_PROPOSAL, AGENTIC_CONTENT_DIGEST, RDF_TYPE, XSD_DATE_TIME, } from "../vocab.js";
import { writeOwnerOnlyAcl } from "./acl.js";
import { proposalSlug } from "./proposals.js";
import { firstLiteralOf, subjectsOf } from "./rdf-query.js";
import { readGraph } from "./read.js";
import { putResource, throwIfNotWritten } from "./write.js";
const { namedNode, literal, quad } = DataFactory;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
/** The in-pod resource URL for a confirmation of a proposal id. */
export function confirmationUrl(container, proposalId) {
    const slug = proposalSlug(proposalId);
    return slug ? `${container}${slug}.ttl` : undefined;
}
/** Serialise a confirmation to Turtle. Throws (fail-closed) on an unsafe id/digest. */
export function serializeConfirmation(confirmation, resourceUrl) {
    const slug = proposalSlug(confirmation.proposalId);
    if (!slug)
        throw new Error("serializeConfirmation: unsafe proposal id");
    if (!DIGEST_RE.test(confirmation.contentDigest)) {
        throw new Error("serializeConfirmation: invalid content digest");
    }
    const at = new Date(Date.parse(confirmation.confirmedAt));
    if (!Number.isFinite(at.getTime()))
        throw new Error("serializeConfirmation: invalid confirmedAt");
    const subject = namedNode(`${resourceUrl}#confirmation`);
    const writer = new Writer({ format: "text/turtle" });
    writer.addQuad(quad(subject, namedNode(RDF_TYPE), namedNode(AGENTIC_CONFIRMATION)));
    writer.addQuad(quad(subject, namedNode(AGENTIC_CONFIRMS_PROPOSAL), literal(slug)));
    writer.addQuad(quad(subject, namedNode(AGENTIC_CONTENT_DIGEST), literal(confirmation.contentDigest)));
    writer.addQuad(quad(subject, namedNode(AGENTIC_CONFIRMED_AT), literal(at.toISOString(), namedNode(XSD_DATE_TIME))));
    return new Promise((resolve, reject) => {
        writer.end((err, result) => (err ? reject(err) : resolve(result)));
    });
}
/** Parse a confirmation from a store, fail-closed (`undefined` unless well-formed). */
export function parseConfirmation(store) {
    const subject = subjectsOf(store, RDF_TYPE, namedNode(AGENTIC_CONFIRMATION))[0];
    if (!subject)
        return undefined;
    const proposalId = firstLiteralOf(store, subject.value, AGENTIC_CONFIRMS_PROPOSAL);
    const contentDigest = firstLiteralOf(store, subject.value, AGENTIC_CONTENT_DIGEST);
    const confirmedAt = firstLiteralOf(store, subject.value, AGENTIC_CONFIRMED_AT);
    if (!proposalId || !proposalSlug(proposalId))
        return undefined;
    if (!contentDigest || !DIGEST_RE.test(contentDigest))
        return undefined;
    if (!confirmedAt)
        return undefined;
    return { proposalId, contentDigest, confirmedAt };
}
/** Write an owner confirmation (ACL-first, overwrite — a re-confirm updates the digest). */
export async function writeConfirmation(fetchFn, container, ownerWebId, confirmation) {
    if (!isSafeContainer(container))
        throw new Error("writeConfirmation: unsafe container");
    const url = confirmationUrl(container, confirmation.proposalId);
    if (!url)
        throw new Error("writeConfirmation: unsafe proposal id");
    await writeOwnerOnlyAcl(fetchFn, container, ownerWebId);
    const body = await serializeConfirmation(confirmation, url);
    const res = await putResource(fetchFn, url, body, {
        contentType: "text/turtle",
        base: container,
    });
    throwIfNotWritten(res, url);
    return url;
}
/** Read the confirmation for a proposal id (or `undefined` if none / malformed). */
export async function readConfirmation(fetchFn, container, proposalId) {
    const url = confirmationUrl(container, proposalId);
    if (!url)
        return undefined;
    try {
        const { store } = await readGraph(fetchFn, url);
        return parseConfirmation(store);
    }
    catch {
        return undefined; // absent / unreadable → no confirmation (fail-closed)
    }
}
//# sourceMappingURL=confirmation-store.js.map