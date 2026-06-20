// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `importRoom` — the (thin) orchestration that pages a Matrix room's history and
 * writes each message into a Solid pod as an owner-private SolidOS LongChat
 * resource readable by PM `/chat` and any LongChat reader.
 *
 * The VALUE of this package is the pure {@link matrixEventToCanonical} transform;
 * this module is deliberately thin: page → transform → stitch edits/redactions →
 * write. It does TWO kinds of fetch, with different trust postures:
 *
 *  - **Homeserver reads** go through `@jeswr/guarded-fetch`'s NODE pinning fetch
 *    ({@link createNodeGuardedFetch}). The Matrix homeserver URL is a
 *    USER-CONFIGURED REMOTE (a classic SSRF surface), so every homeserver request
 *    is https-only, blocks private/loopback/link-local/cloud-metadata addresses,
 *    DNS-pins to close the rebinding window, caps the response size + time, and
 *    does NOT auto-follow redirects. The Matrix access token rides ONLY on the
 *    guarded homeserver request as a `Bearer` header; it is never written to the
 *    pod, never logged, never placed in a URL.
 *  - **Pod writes** go through the caller's INJECTABLE authed `writeFetch` (a
 *    DPoP/Bearer Solid fetch). The pod is the user's own trusted origin, so it is
 *    NOT routed through the SSRF guard — the caller owns that fetch and its auth.
 *
 * Imported chat is THIRD-PARTY data landing in the user's pod, so the default ACL
 * is OWNER-ONLY (never auto-shared) — see {@link writeOwnerOnlyAcl}. Edits and
 * redactions from the source are honoured on re-sync (an edit rewrites the target
 * resource + sets `dct:isReplacedBy`; a redaction stamps `schema:dateDeleted`).
 */
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import { longChatMessageSubject, serializeLongChat, } from "@jeswr/solid-chat-interop";
import { matrixEventToCanonical } from "./transform.js";
/** A conservative max for a single Matrix `/messages` page. */
const MAX_PAGE_SIZE = 1000;
/** Slugify a Matrix event id into a safe, collision-free path segment. */
function eventSlug(eventId) {
    // Matrix event ids look like `$base64url` or `$opaque:server`. Keep only
    // URL-safe chars; everything else → `_`. Prefix `m-` to keep it a valid name and
    // avoid a leading `$`/`-`.
    return `m-${eventId.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}
/**
 * Build the default in-pod resource URL for an event under `container`. `container`
 * is assumed to end with `/` (validated by {@link importRoom}).
 */
function defaultMessageUrl(container, eventId) {
    return `${container}${eventSlug(eventId)}.ttl`;
}
/**
 * PUT a SolidOS LongChat message resource (Turtle) at `url` via the injectable
 * authed fetch. Throws on a non-2xx so the caller sees a failed write rather than
 * silently losing data.
 */
async function putLongChat(writeFetch, url, msg) {
    const subject = longChatMessageSubject(url);
    // The canonical message's `id` should be the subject; align it so the written
    // resource is self-describing at `#it`.
    const turtle = await serializeLongChat({ ...msg, id: subject }, subject);
    const res = await writeFetch(url, {
        method: "PUT",
        headers: { "content-type": "text/turtle" },
        body: turtle,
    });
    if (!res.ok) {
        throw new Error(`pod write failed: PUT ${url} -> ${res.status} ${res.statusText}`);
    }
}
/**
 * Write a default OWNER-ONLY WAC ACL for `container` (and its descendants, via
 * `acl:default`). Only the owner gets read/write/control; nothing is public.
 *
 * The ACL document is built with `@jeswr/solid-chat-interop`'s n3 `Writer` path
 * indirectly via a small typed builder here is overkill; instead we delegate to a
 * dedicated ACL writer that uses `n3.Writer` (never hand-concatenated triples) —
 * see {@link buildOwnerOnlyAclTurtle}. The ACL is PUT to `${container}.acl`.
 */
async function writeOwnerOnlyAcl(writeFetch, container, ownerWebId) {
    const aclUrl = `${container}.acl`;
    const turtle = await buildOwnerOnlyAclTurtle(container, ownerWebId);
    const res = await writeFetch(aclUrl, {
        method: "PUT",
        headers: { "content-type": "text/turtle" },
        body: turtle,
    });
    if (!res.ok) {
        throw new Error(`owner-only ACL write failed: PUT ${aclUrl} -> ${res.status} ${res.statusText}`);
    }
}
/**
 * Build an owner-only WAC ACL Turtle document for `container`, granting the owner
 * `acl:Read`/`acl:Write`/`acl:Control` over the container AND its descendants
 * (`acl:accessTo` + `acl:default`). Built with `n3.Writer` + typed quads — never
 * hand-concatenated triples (house rule). Exported for testing.
 */
export async function buildOwnerOnlyAclTurtle(container, ownerWebId) {
    const { DataFactory, Store, Writer } = await import("n3");
    const { namedNode } = DataFactory;
    const Acl = "http://www.w3.org/ns/auth/acl#";
    const RdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    const store = new Store();
    const auth = namedNode(`${container}.acl#owner`);
    store.addQuad(auth, namedNode(RdfType), namedNode(`${Acl}Authorization`));
    store.addQuad(auth, namedNode(`${Acl}agent`), namedNode(ownerWebId));
    store.addQuad(auth, namedNode(`${Acl}accessTo`), namedNode(container));
    store.addQuad(auth, namedNode(`${Acl}default`), namedNode(container));
    store.addQuad(auth, namedNode(`${Acl}mode`), namedNode(`${Acl}Read`));
    store.addQuad(auth, namedNode(`${Acl}mode`), namedNode(`${Acl}Write`));
    store.addQuad(auth, namedNode(`${Acl}mode`), namedNode(`${Acl}Control`));
    const writer = new Writer({ format: "text/turtle", prefixes: { acl: Acl } });
    writer.addQuads([...store]);
    return new Promise((resolve, reject) => {
        writer.end((error, result) => (error ? reject(error) : resolve(result)));
    });
}
/**
 * Build the Matrix `/messages` request URL for one page (backwards pagination).
 * `from` is omitted on the first page (the server starts from the most recent).
 */
function messagesUrl(homeserverUrl, roomId, pageSize, from) {
    const base = new URL(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`, homeserverUrl);
    base.searchParams.set("dir", "b");
    base.searchParams.set("limit", String(pageSize));
    if (from !== undefined)
        base.searchParams.set("from", from);
    return base;
}
/**
 * Import a Matrix room's history into a Solid pod (owner-private, READ/import-only).
 *
 * Pages `GET /_matrix/client/v3/rooms/{roomId}/messages?dir=b` (backwards) through
 * the SSRF-guarded homeserver fetch, transforms each event with the pure
 * {@link matrixEventToCanonical}, stitches edits/redactions onto their target
 * resources, and writes each message as an owner-private LongChat resource via the
 * injectable {@link ImportRoomOptions.writeFetch}.
 *
 * Re-running is idempotent at the resource level (each event id maps to a stable
 * resource URL, so a re-sync overwrites in place and applies new edits/redactions).
 *
 * @throws if `homeserverUrl` is not https, `container` does not end with `/`,
 *   `writeAcl` is set without an `ownerWebId`, or a homeserver/pod request fails.
 */
export async function importRoom(options) {
    const { homeserverUrl, accessToken, roomId, writeFetch, container, webIdFor, writeAcl = true, ownerWebId, } = options;
    if (!/^https:\/\//i.test(homeserverUrl)) {
        throw new Error("homeserverUrl must be an https URL (a user-configured remote is SSRF-guarded).");
    }
    if (!container.endsWith("/")) {
        throw new Error("container must end with '/' (it is a Solid container).");
    }
    if (writeAcl && !ownerWebId) {
        throw new Error("writeAcl is enabled but ownerWebId is missing (owner-only ACL needs the owner).");
    }
    const pageSize = Math.min(Math.max(1, options.pageSize ?? 100), MAX_PAGE_SIZE);
    const maxPages = Math.max(1, options.maxPages ?? 200);
    const messageUrlFor = options.messageUrlFor ?? ((eventId) => defaultMessageUrl(container, eventId));
    const guardedFetch = options.guardedFetch ?? createNodeGuardedFetch(options.guardOptions ?? {});
    const ctx = {
        messageIriFor: messageUrlFor,
        ...(webIdFor ? { webIdFor } : {}),
        // The room maps to the container; expose it as the in-pod room IRI.
        roomIriFor: () => container,
        // Honestly record the homeserver as the derivation source.
        ...(isHttps(homeserverUrl) ? { derivedFrom: homeserverUrl } : {}),
    };
    // Optionally write the owner-only ACL first so the container is locked down
    // BEFORE any message lands in it.
    if (writeAcl && ownerWebId) {
        await writeOwnerOnlyAcl(writeFetch, container, ownerWebId);
    }
    let written = 0;
    let redacted = 0;
    let skipped = 0;
    let pages = 0;
    let from;
    while (pages < maxPages) {
        const url = messagesUrl(homeserverUrl, roomId, pageSize, from);
        const res = await guardedFetch(url.toString(), {
            headers: {
                authorization: `Bearer ${accessToken}`,
                accept: "application/json",
            },
        });
        if (!res.ok) {
            throw new Error(`Matrix /messages failed: ${res.status} ${res.statusText} (room ${roomId}, page ${pages}).`);
        }
        pages++;
        const body = (await res.json());
        const chunk = Array.isArray(body.chunk) ? body.chunk : [];
        for (const event of chunk) {
            const result = matrixEventToCanonical(event, ctx);
            switch (result.kind) {
                case "message": {
                    await putLongChat(writeFetch, messageUrlFor(result.eventId), result.message);
                    written++;
                    break;
                }
                case "replace": {
                    // Apply the edit to the TARGET resource and set the edit pointer.
                    const targetUrl = messageUrlFor(result.targetEventId);
                    const editUrl = messageUrlFor(result.eventId);
                    const replaced = {
                        ...result.message,
                        id: longChatMessageSubject(targetUrl),
                        replacedBy: longChatMessageSubject(editUrl),
                    };
                    await putLongChat(writeFetch, targetUrl, replaced);
                    written++;
                    break;
                }
                case "redaction": {
                    await applyRedaction(writeFetch, messageUrlFor, result.targetEventId, result.deletedAt);
                    redacted++;
                    break;
                }
                case "skip":
                    skipped++;
                    break;
            }
        }
        const end = typeof body.end === "string" ? body.end : undefined;
        // Stop when the server signals no more events: no `end`, an empty chunk, or an
        // unchanged token (some servers echo `from` at the timeline edge).
        if (end === undefined || chunk.length === 0 || end === from)
            break;
        from = end;
    }
    return { written, redacted, skipped, pages };
}
/**
 * Apply a redaction tombstone to the target resource: stamp `schema:dateDeleted`
 * and CLEAR the body (right-to-be-forgotten — a redacted message must not retain
 * its content on re-sync). We write a minimal LongChat resource carrying only the
 * tombstone. The `deletedAt` defaults to `now` when the source did not carry one.
 */
async function applyRedaction(writeFetch, messageUrlFor, targetEventId, deletedAt) {
    const url = messageUrlFor(targetEventId);
    const subject = longChatMessageSubject(url);
    const tombstone = {
        id: subject,
        content: "",
        mediaType: "text/plain",
        deletedAt: deletedAt ?? new Date().toISOString(),
    };
    await putLongChat(writeFetch, url, tombstone);
}
/** True for an https URL (best-effort; unparseable → false). */
function isHttps(u) {
    try {
        return new URL(u).protocol === "https:";
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=import.js.map