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
import { canonicalContainer, isWithinBase, safeHttpIri } from "./safe-iri.js";
import {
  type MatrixContext,
  type MatrixEventResult,
  matrixEventToCanonical,
  type SkipResult,
} from "./transform.js";

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

/**
 * Fail CLOSED on any HTTP redirect. Every trust-bearing fetch in this package sets
 * `redirect: "manual"` so the runtime does NOT silently auto-follow a 3xx — a
 * followed redirect on a DPoP/Bearer POD WRITE could land the authed request (and
 * its body) at an attacker-chosen or wrong resource, and a followed redirect on the
 * ACL write could leave the container UNLOCKED while content lands in it. With
 * `redirect: "manual"` the runtime surfaces the redirect as either an
 * `opaqueredirect` response (`type === "opaqueredirect"`, `status === 0`) or a raw
 * 3xx; either is refused here. Call BEFORE inspecting `res.ok`.
 */
function assertNoRedirect(res: Response, method: string, url: string): void {
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    // `url` is a caller/config value; canonicalise it for the message so a hostile
    // URL cannot inject control chars into logs (`safeHttpIri` strips/encodes them).
    const safe = safeHttpIri(url) ?? "<unsafe-url>";
    throw new Error(`refusing to follow a redirect on ${method} ${safe} (status ${res.status}).`);
  }
}

/**
 * Slugify a Matrix event id into a safe, COLLISION-FREE path segment. A naive
 * "replace every non-URL-safe char with `_`" is NOT injective — `$a:b` and `$a/b`
 * would collide onto the same resource and overwrite each other. We instead
 * base64url-encode the full event id (a reversible, total, collision-free encoding)
 * and prefix `m-` so the name is a valid, non-`$`/`-`-leading segment.
 *
 * STABILITY CONTRACT (load-bearing): this slug is the DURABLE mapping from a Matrix
 * event id to its in-pod resource, and re-sync relies on it being STABLE — an
 * import overwrites / edits / tombstones the SAME resource it wrote before. Do NOT
 * change this encoding without a migration step (tombstone or move the old-slug
 * resource), or a re-sync after the change would write to a new URL and leave the
 * old resource orphaned with stale/redacted content. This is the initial release
 * (v0.0.1, no prior published/run version), so there are NO legacy slugs to migrate
 * today; the constraint exists to prevent a FUTURE breaking change. A caller that
 * needs a different layout supplies {@link ImportRoomOptions.messageUrlFor} (and
 * must keep IT stable for the same reason).
 */
function eventSlug(eventId: string): string {
  const b64 = Buffer.from(eventId, "utf8").toString("base64");
  // base64url: + → -, / → _, strip `=` padding (not needed for a one-way name).
  const b64url = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `m-${b64url}`;
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
    redirect: "manual",
  });
  assertNoRedirect(res, "PUT", url);
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
    redirect: "manual",
  });
  assertNoRedirect(res, "PUT", aclUrl);
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
  // SECURITY (fail-closed): an ACL is the most dangerous injection sink in this
  // package — a `>` in `ownerWebId` or `container` reaching n3.Writer's un-escaped
  // `<...>` could inject a public `acl:agentClass foaf:Agent` grant, turning the
  // owner-private container PUBLIC. Both MUST be canonical, injection-safe http(s)
  // IRIs; anything else is refused BEFORE a single quad is built (never write a
  // half-safe ACL). `container` must be an UNAMBIGUOUS container — path ends in '/',
  // NO query/fragment — so `${container}.acl` cannot resolve to a decoy resource
  // (e.g. `chat/?x=/` → `chat/?x=/.acl`, not the real `chat/.acl`).
  const safeContainer = canonicalContainer(container);
  if (safeContainer === undefined) {
    throw new Error(
      "owner-only ACL: container must be a safe http(s) container IRI ending in '/' with no query or fragment.",
    );
  }
  const safeOwner = safeHttpIri(ownerWebId);
  if (safeOwner === undefined) {
    throw new Error("owner-only ACL: ownerWebId must be a safe absolute http(s) IRI.");
  }
  const { DataFactory, Store, Writer } = await import("n3");
  const { namedNode } = DataFactory;
  const Acl = "http://www.w3.org/ns/auth/acl#";
  const RdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  const store = new Store();
  const auth = namedNode(`${safeContainer}.acl#owner`);
  store.addQuad(auth, namedNode(RdfType), namedNode(`${Acl}Authorization`));
  store.addQuad(auth, namedNode(`${Acl}agent`), namedNode(safeOwner));
  store.addQuad(auth, namedNode(`${Acl}accessTo`), namedNode(safeContainer));
  store.addQuad(auth, namedNode(`${Acl}default`), namedNode(safeContainer));
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
    webIdFor,
    writeAcl = true,
    ownerWebId,
  } = options;

  if (!/^https:\/\//i.test(homeserverUrl)) {
    throw new Error(
      "homeserverUrl must be an https URL (a user-configured remote is SSRF-guarded).",
    );
  }
  // SECURITY: canonicalise + validate the container ONCE, up front, and use this
  // ONE value for BOTH the ACL URL and every message-URL scope check. Rejecting a
  // query/fragment here is load-bearing: a raw `chat/?x=/` "ends in `/`" yet its
  // `.acl` would land on a decoy resource while messages resolve under `/chat/`,
  // leaving the imported chat OUTSIDE the owner-only ACL. No downstream code
  // re-derives from the raw input.
  const container = canonicalContainer(options.container);
  if (container === undefined) {
    throw new Error(
      "container must be a safe http(s) container IRI ending in '/' with no query or fragment.",
    );
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

  let skipped = 0;
  let pages = 0;
  let from: string | undefined;

  // ORDER-INDEPENDENT FOLD. The Matrix `/messages?dir=b` API returns events
  // NEWEST-FIRST, so an edit or redaction can be seen BEFORE the original message
  // it targets (within a page or across pages). Writing as-we-go would let the
  // older original later OVERWRITE a newer edit/redaction, restoring stale or
  // redacted content. We therefore fold every result into final per-event state
  // FIRST (latest edit wins by timestamp; a redaction is terminal regardless of
  // order), then write each resource exactly ONCE in a deterministic order. This
  // makes the outcome independent of the page/chunk order entirely.
  const states = new Map<string, EventState>();

  while (pages < maxPages) {
    const url = messagesUrl(homeserverUrl, roomId, pageSize, from);
    const res = await guardedFetch(url.toString(), {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
      // The guarded fetch re-validates + re-pins each redirect hop itself and strips
      // the Authorization header cross-origin; we ALSO set manual + refuse a 3xx
      // here so a raw redirect from an injected/non-guarded fetch double can never
      // leak the Bearer token or read from a redirected host.
      redirect: "manual",
    });
    assertNoRedirect(res, "GET", url.toString());
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
      if (result.kind === "skip") {
        skipped++;
        continue;
      }
      foldResult(states, result);
    }

    const end = typeof body.end === "string" ? body.end : undefined;
    // Stop when the server signals no more events: no `end`, an empty chunk, or an
    // unchanged token (some servers echo `from` at the timeline edge).
    if (end === undefined || chunk.length === 0 || end === from) break;
    from = end;
  }

  // Materialise the folded state to the pod — each target resource written once.
  // Sorting the keys keeps the write order deterministic (helps tests + diffs).
  let written = 0;
  let redacted = 0;
  for (const eventId of [...states.keys()].sort()) {
    const state = states.get(eventId);
    if (state === undefined) continue;
    // SCOPE GUARD (fail-closed): the resolved write URL — whether the default slug
    // or a caller-supplied `messageUrlFor` — MUST be a safe http(s) IRI strictly
    // within the configured container. This stops a custom (or buggy) resolver, or
    // an injection-carrying event id, from writing OUTSIDE the owner-locked
    // container (where the owner-only ACL does not apply).
    const targetUrl = assertWritableUrl(messageUrlFor(eventId), container);

    if (state.redactedAt !== undefined) {
      // A redaction is terminal: tombstone the resource, clearing any body.
      await applyRedaction(writeFetch, targetUrl, state.redactedAt);
      redacted++;
      continue;
    }

    // The effective message is the latest edit's content (if any) over the base
    // message; an orphan edit (target not in range) still gets written so data is
    // not lost. A base message with no edit writes as-is.
    const base = state.edit?.message ?? state.message;
    if (base === undefined) continue; // nothing to write (shouldn't happen)
    const subject = longChatMessageSubject(targetUrl);
    const out: CanonicalMessage = { ...base, id: subject };
    if (state.edit !== undefined) {
      // Preserve the original message's timestamps/author where the edit lacked
      // them, but the edit's CONTENT wins; set the dct:isReplacedBy edit pointer —
      // only when the edit's own resource is a safe, in-container IRI (else drop the
      // metadata pointer rather than lose the message content or inject an IRI).
      const editSubject = safeHttpIri(
        longChatMessageSubject(messageUrlFor(state.edit.editEventId)),
      );
      if (editSubject !== undefined && isWithinBase(editSubject, container)) {
        out.replacedBy = editSubject;
      }
      if (state.message?.published !== undefined && out.published === undefined) {
        out.published = state.message.published;
      }
      if (state.message?.author !== undefined && out.author === undefined) {
        out.author = state.message.author;
      }
    }
    await putLongChat(writeFetch, targetUrl, out);
    written++;
  }

  return { written, redacted, skipped, pages };
}

/** The folded final state for one target event id (order-independent). */
interface EventState {
  /** The base message (from the original `m.room.message`), if seen. */
  message?: CanonicalMessage;
  /** The latest edit (by timestamp) applied to this target, if any. */
  edit?: { message: CanonicalMessage; editEventId: string; ts: number };
  /** The redaction timestamp (ISO) — terminal; set ⇒ the resource is a tombstone. */
  redactedAt?: string;
}

/** Parse an ISO timestamp to ms for edit-recency comparison; missing → -Infinity. */
function tsMs(iso: string | undefined): number {
  if (iso === undefined) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Fold one non-skip transform result into the per-event state map (the
 * order-independent merge). `message` sets the base; `replace` keeps the
 * LATEST-by-timestamp edit; `redaction` marks the target terminal (and a redaction
 * is never un-set by a later/earlier message or edit).
 */
function foldResult(
  states: Map<string, EventState>,
  result: Exclude<MatrixEventResult, SkipResult>,
): void {
  switch (result.kind) {
    case "message": {
      const s = states.get(result.eventId) ?? {};
      s.message = result.message;
      states.set(result.eventId, s);
      break;
    }
    case "replace": {
      const s = states.get(result.targetEventId) ?? {};
      const ts = tsMs(result.message.published);
      if (s.edit === undefined || ts >= s.edit.ts) {
        s.edit = { message: result.message, editEventId: result.eventId, ts };
      }
      states.set(result.targetEventId, s);
      break;
    }
    case "redaction": {
      const s = states.get(result.targetEventId) ?? {};
      // Terminal + idempotent: keep the first redaction stamp we see.
      if (s.redactedAt === undefined) {
        s.redactedAt = result.deletedAt ?? new Date().toISOString();
      }
      states.set(result.targetEventId, s);
      break;
    }
  }
}

/**
 * Apply a redaction tombstone to the target resource: stamp `schema:dateDeleted`
 * and CLEAR the body (right-to-be-forgotten — a redacted message must not retain
 * its content on re-sync). We write a minimal LongChat resource carrying only the
 * tombstone. The `deletedAt` defaults to `now` when the source did not carry one.
 */
async function applyRedaction(
  writeFetch: typeof globalThis.fetch,
  url: string,
  deletedAt: string | undefined,
): Promise<void> {
  const subject = longChatMessageSubject(url);
  const tombstone: CanonicalMessage = {
    id: subject,
    content: "",
    mediaType: "text/plain",
    deletedAt: deletedAt ?? new Date().toISOString(),
  };
  await putLongChat(writeFetch, url, tombstone);
}

/**
 * Resolve + validate a pod write URL against the container base (fail-closed). The
 * resolver's output MUST be a safe, canonical http(s) IRI STRICTLY within `container`
 * (same origin + a path under the container); anything else throws before any write
 * happens. Returns the canonical safe URL to use for BOTH the HTTP request and the
 * `#it` subject, so the two can never disagree.
 */
function assertWritableUrl(url: string, container: string): string {
  const safe = safeHttpIri(url);
  if (safe === undefined || !isWithinBase(safe, container)) {
    throw new Error("refusing a pod write to a resource outside the configured container base.");
  }
  return safe;
}

/** True for an https URL (best-effort; unparseable → false). */
function isHttps(u: string): boolean {
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
}
