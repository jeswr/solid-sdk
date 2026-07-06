import { isSafeContainer } from "../config.js";
import { writeOwnerOnlyAcl } from "./acl.js";
import { parseProposal, proposalUrl, serializeProposal } from "./proposals.js";
import { listContainer, readGraph } from "./read.js";
import { putResource, throwIfNotWritten } from "./write.js";
/**
 * Create a new `pending` proposal (ACL-first, create-only). Returns the resource URL,
 * or `undefined` if a record with that id already exists (a `412` — never clobbered).
 */
export async function createProposal(fetchFn, container, ownerWebId, proposal) {
    if (!isSafeContainer(container))
        throw new Error("createProposal: unsafe container");
    const url = proposalUrl(container, proposal.id);
    if (!url)
        throw new Error("createProposal: unsafe proposal id");
    await writeOwnerOnlyAcl(fetchFn, container, ownerWebId);
    const body = await serializeProposal(proposal, { resourceUrl: url });
    const res = await putResource(fetchFn, url, body, {
        contentType: "text/turtle",
        ifNoneMatch: "*",
        base: container,
    });
    if (res.status === 412)
        return undefined; // already exists — do not clobber
    throwIfNotWritten(res, url);
    return url;
}
/**
 * Compare-and-swap an existing proposal (a status transition). Returns `true` on
 * success, `false` if the ETag no longer matches (`412` — someone else changed it).
 */
export async function updateProposal(fetchFn, container, proposal, ifMatch) {
    const url = proposalUrl(container, proposal.id);
    if (!url)
        throw new Error("updateProposal: unsafe proposal id");
    const body = await serializeProposal(proposal, { resourceUrl: url });
    const res = await putResource(fetchFn, url, body, {
        contentType: "text/turtle",
        ifMatch,
        base: container,
    });
    if (res.status === 412)
        return false;
    throwIfNotWritten(res, url);
    return true;
}
/** Read + parse a single proposal resource (or `undefined` if it is not a proposal). */
export async function readProposal(fetchFn, url) {
    const { store, etag } = await readGraph(fetchFn, url);
    const proposal = parseProposal(store);
    if (!proposal)
        return undefined;
    return { proposal, url, etag };
}
/**
 * List every well-formed proposal in a container. A resource that does not parse as a
 * proposal is skipped (fail-closed — a malformed record never reaches the executor).
 */
export async function listProposals(fetchFn, container) {
    const children = await listContainer(fetchFn, container);
    const out = [];
    for (const url of children) {
        if (!url.endsWith(".ttl") || url.endsWith(".acl"))
            continue;
        try {
            const loaded = await readProposal(fetchFn, url);
            if (loaded)
                out.push(loaded);
        }
        catch {
            // A single unreadable/unparseable proposal never aborts the batch.
        }
    }
    return out;
}
//# sourceMappingURL=proposal-store.js.map