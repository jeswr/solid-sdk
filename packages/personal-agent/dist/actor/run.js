import { isSafeContainer } from "../config.js";
import { createProposal } from "../pod/proposal-store.js";
import { listContainer, readGraph } from "../pod/read.js";
import { deriveProposals } from "./derive.js";
import { readInboundContext, readInterpretations } from "./interpretations.js";
/** Run the deterministic Actor pass once over the inbox. */
export async function runActorOnce(options) {
    if (!isSafeContainer(options.inbox))
        throw new Error("runActorOnce: unsafe inbox container");
    if (!isSafeContainer(options.proposals)) {
        throw new Error("runActorOnce: unsafe proposals container");
    }
    const now = options.now ?? (() => new Date());
    const children = await listContainer(options.readFetch, options.inbox);
    let graphsScanned = 0;
    let proposalsCreated = 0;
    for (const url of children) {
        if (!url.startsWith(options.inbox))
            continue;
        if (!url.endsWith(".ttl") || url.endsWith(".chat.ttl") || url.endsWith(".acl"))
            continue;
        const slug = url.slice(options.inbox.length, url.length - ".ttl".length);
        if (slug.length === 0)
            continue;
        graphsScanned += 1;
        let store;
        try {
            ({ store } = await readGraph(options.readFetch, url));
        }
        catch {
            continue; // an unreadable graph never aborts the pass
        }
        const inbound = readInboundContext(store);
        const interps = readInterpretations(store);
        const proposals = deriveProposals(interps, {
            inbound,
            idPrefix: slug,
            now: now(),
            ...(options.minConfidence !== undefined ? { minConfidence: options.minConfidence } : {}),
        });
        for (const proposal of proposals) {
            const created = await createProposal(options.writeFetch, options.proposals, options.ownerWebId, proposal);
            if (created)
                proposalsCreated += 1;
        }
    }
    return { graphsScanned, proposalsCreated };
}
//# sourceMappingURL=run.js.map