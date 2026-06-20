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

import { createNodeGuardedFetch, type NodePinningOptions } from "@jeswr/guarded-fetch/node";
import {
  type CanonicalMessage,
  longChatMessageSubject,
  serializeLongChat,
} from "@jeswr/solid-chat-interop";
import type { MatrixEvent, MatrixMessagesResponse } from "./matrix.js";
import { type MatrixContext, matrixEventToCanonical } from "./transform.js";

/** Options for {@link importRoom}. */
export interface ImportRoomOptions {
  /**
   * The Matrix homeserver base URL (e.g. `https://matrix.example.org`). A
   * user-configured remote → all reads against it are SSRF-guarded. Must be https.
   */
  readonly homeserverUrl: string;
  /**
   * The Matrix access token (a runtime secret). Sent ONLY as a `Bearer` header on
   * the guarded homeserver request. NEVER logged, persisted, or written to the pod.
   */
  readonly accessToken: string;
  /** The Matrix room id to import (`!room:server`). */
  readonly roomId: string;
  /**
   * An authenticated Solid `fetch` for the POD writes (DPoP/Bearer). Injectable so
   * the importer is unit-testable without a live server; the caller owns its auth.
   */
  readonly writeFetch: typeof globalThis.fetch;
  /**
   * The pod container the imported messages are written into (must end with `/`).
   * Each message becomes `${container}<eventid-slug>.ttl`.
   */
  readonly container: string;
  /**
   * Map a Matrix `event_id` to the in-pod resource URL it is written at. Defaults
   * to a deterministic slug under {@link container}. Override to control layout.
   */
  readonly messageUrlFor?: (eventId: string) => string;
  /** Resolve a Matrix sender to a real WebID (see {@link MatrixContext.webIdFor}). */
  readonly webIdFor?: (matrixUserId: string) => string | undefined;
  /** Page size for the Matrix `/messages` request (default 100, capped at 1000). */
  readonly pageSize?: number;
  /** Max number of pages to fetch (default 200) — a runaway-import guard. */
  readonly maxPages?: number;
  /**
   * Write a default OWNER-ONLY ACL alongside the container. Default `true`.
   * Requires {@link ownerWebId}. Set `false` if the container already has the
   * intended ACL (the importer never widens an existing ACL).
   */
  readonly writeAcl?: boolean;
  /** The owner WebID granted full control by the default ACL (required if `writeAcl`). */
  readonly ownerWebId?: string;
  /**
   * The guarded-fetch instance for homeserver reads. Injectable for tests;
   * production uses {@link createNodeGuardedFetch} with strict defaults.
   */
  readonly guardedFetch?: typeof globalThis.fetch;
  /** Extra guarded-fetch options (e.g. a body cap / timeout); merged with defaults. */
  readonly guardOptions?: NodePinningOptions;
}

/** The outcome of an {@link importRoom} run. */
export interface ImportRoomResult {
  /** Number of messages (incl. edits applied) written to the pod. */
  readonly written: number;
  /** Number of redactions (tombstones) applied. */
  readonly redacted: number;
  /** Number of events skipped (non-message / unmappable / hostile). */
  readonly skipped: number;
  /** Number of pages fetched from the homeserver. */
  readonly pages: number;
}

/** A conservative max for a single Matrix `/messages` page. */
const MAX_PAGE_SIZE = 1000;

/** Slugify a Matrix event id into a safe, collision-free path segment. */
function eventSlug(eventId: string): string {
  // Matrix event ids look like `$base64url` or `$opaque:server`. Keep only
  // URL-safe chars; everything else → `_`. Prefix `m-` to keep it a valid name and
  // avoid a leading `$`/`-`.
  return `m-${eventId.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

/**
 * Build the default in-pod resource URL for an event under `container`. `container`
 * is assumed to end with `/` (validated by {@link importRoom}).
 */
function defaultMessageUrl(container: string, eventId: string): string {
  return `${container}${eventSlug(eventId)}.ttl`;
}

/**
 * PUT a SolidOS LongChat message resource (Turtle) at `url` via the injectable
 * authed fetch. Throws on a non-2xx so the caller sees a failed write rather than
 * silently losing data.
 */
async function putLongChat(
  writeFetch: typeof globalThis.fetch,
  url: string,
  msg: CanonicalMessage,
): Promise<void> {
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
async function writeOwnerOnlyAcl(
  writeFetch: typeof globalThis.fetch,
  container: string,
  ownerWebId: string,
): Promise<void> {
  const aclUrl = `${container}.acl`;
  const turtle = await buildOwnerOnlyAclTurtle(container, ownerWebId);
  const res = await writeFetch(aclUrl, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: turtle,
  });
  if (!res.ok) {
    throw new Error(
      `owner-only ACL write failed: PUT ${aclUrl} -> ${res.status} ${res.statusText}`,
    );
  }
}

/**
 * Build an owner-only WAC ACL Turtle document for `container`, granting the owner
 * `acl:Read`/`acl:Write`/`acl:Control` over the container AND its descendants
 * (`acl:accessTo` + `acl:default`). Built with `n3.Writer` + typed quads — never
 * hand-concatenated triples (house rule). Exported for testing.
 */
export async function buildOwnerOnlyAclTurtle(
  container: string,
  ownerWebId: string,
): Promise<string> {
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
  return new Promise<string>((resolve, reject) => {
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}

/**
 * Build the Matrix `/messages` request URL for one page (backwards pagination).
 * `from` is omitted on the first page (the server starts from the most recent).
 */
function messagesUrl(homeserverUrl: string, roomId: string, pageSize: number, from?: string): URL {
  const base = new URL(
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`,
    homeserverUrl,
  );
  base.searchParams.set("dir", "b");
  base.searchParams.set("limit", String(pageSize));
  if (from !== undefined) base.searchParams.set("from", from);
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
export async function importRoom(options: ImportRoomOptions): Promise<ImportRoomResult> {
  const {
    homeserverUrl,
    accessToken,
    roomId,
    writeFetch,
    container,
    webIdFor,
    writeAcl = true,
    ownerWebId,
  } = options;

  if (!/^https:\/\//i.test(homeserverUrl)) {
    throw new Error(
      "homeserverUrl must be an https URL (a user-configured remote is SSRF-guarded).",
    );
  }
  if (!container.endsWith("/")) {
    throw new Error("container must end with '/' (it is a Solid container).");
  }
  if (writeAcl && !ownerWebId) {
    throw new Error(
      "writeAcl is enabled but ownerWebId is missing (owner-only ACL needs the owner).",
    );
  }

  const pageSize = Math.min(Math.max(1, options.pageSize ?? 100), MAX_PAGE_SIZE);
  const maxPages = Math.max(1, options.maxPages ?? 200);
  const messageUrlFor =
    options.messageUrlFor ?? ((eventId: string) => defaultMessageUrl(container, eventId));
  const guardedFetch = options.guardedFetch ?? createNodeGuardedFetch(options.guardOptions ?? {});

  const ctx: MatrixContext = {
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
  let from: string | undefined;

  while (pages < maxPages) {
    const url = messagesUrl(homeserverUrl, roomId, pageSize, from);
    const res = await guardedFetch(url.toString(), {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(
        `Matrix /messages failed: ${res.status} ${res.statusText} (room ${roomId}, page ${pages}).`,
      );
    }
    pages++;
    const body = (await res.json()) as MatrixMessagesResponse;
    const chunk = Array.isArray(body.chunk) ? body.chunk : [];

    for (const event of chunk) {
      const result = matrixEventToCanonical(event as MatrixEvent, ctx);
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
          const replaced: CanonicalMessage = {
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
    if (end === undefined || chunk.length === 0 || end === from) break;
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
async function applyRedaction(
  writeFetch: typeof globalThis.fetch,
  messageUrlFor: (eventId: string) => string,
  targetEventId: string,
  deletedAt: string | undefined,
): Promise<void> {
  const url = messageUrlFor(targetEventId);
  const subject = longChatMessageSubject(url);
  const tombstone: CanonicalMessage = {
    id: subject,
    content: "",
    mediaType: "text/plain",
    deletedAt: deletedAt ?? new Date().toISOString(),
  };
  await putLongChat(writeFetch, url, tombstone);
}

/** True for an https URL (best-effort; unparseable → false). */
function isHttps(u: string): boolean {
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
}
