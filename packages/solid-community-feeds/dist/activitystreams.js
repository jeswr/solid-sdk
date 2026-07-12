// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see prod-solid-server docs/MODEL-PROVENANCE.md
/**
 * Optional ActivityStreams 2.0 (AS2 / JSON-LD) projection of the unified model.
 *
 * The suite uses Linked-Data conventions where the model is RDF. A community
 * message maps cleanly onto an `as:Note`, a thread onto an `as:Collection` of
 * notes, and a channel onto an `as:Collection` of threads. This lets a consumer
 * store/index community items as RDF (e.g. in a pod) using the standard
 * ActivityStreams vocabulary, with no bespoke vocab.
 *
 * These builders emit plain JSON-LD objects (the `@context` is the canonical AS2
 * context URL). They are dependency-free — a consumer that wants quads can parse
 * the JSON-LD with the suite's RDF libs (`@jeswr/fetch-rdf` / jsonld). We do NOT
 * pull an RDF library into this read client's runtime; the AS2 layer is opt-in.
 */
const AS2_CONTEXT = "https://www.w3.org/ns/activitystreams";
/** Project a {@link CommunityMessage} to an `as:Note`. */
export function messageToAs2(message) {
    const note = {
        "@context": AS2_CONTEXT,
        type: "Note",
        id: message.permalink,
        attributedTo: {
            type: "Person",
            name: message.author,
            // The stable handle is preserved as the actor's preferredUsername.
            preferredUsername: message.authorId,
        },
        content: message.body,
        published: message.createdAt,
        url: message.permalink,
        // A non-AS extension marker recording which backend this came from.
        "https://w3id.org/jeswr/community#source": message.source,
    };
    if (message.bodyHtml) {
        note.mediaType = "text/html";
        note.content = message.bodyHtml;
        note.summary = message.body;
    }
    return note;
}
/** Project a {@link CommunityThread} to an `as:Collection` of notes. */
export function threadToAs2(thread) {
    const items = (thread.messages ?? []).map(messageToAs2);
    return {
        "@context": AS2_CONTEXT,
        type: "Collection",
        id: thread.permalink,
        name: thread.title,
        url: thread.permalink,
        totalItems: thread.messageCount ?? items.length,
        published: thread.lastActivityAt,
        items,
        "https://w3id.org/jeswr/community#source": thread.source,
    };
}
/** Project a {@link CommunityChannel} to an `as:Collection` of threads. */
export function channelToAs2(channel) {
    const items = (channel.threads ?? []).map(threadToAs2);
    const out = {
        "@context": AS2_CONTEXT,
        type: "Collection",
        id: channel.permalink,
        name: channel.name,
        url: channel.permalink,
        totalItems: items.length,
        items,
        "https://w3id.org/jeswr/community#source": channel.source,
    };
    if (channel.topic) {
        out.summary = channel.topic;
    }
    return out;
}
//# sourceMappingURL=activitystreams.js.map