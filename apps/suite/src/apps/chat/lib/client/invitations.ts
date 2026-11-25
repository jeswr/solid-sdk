// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5

import { isWithinPodScope } from "@jeswr/guarded-fetch";
import { readContainerMembers } from "@jeswr/ldp-container";
import {
  createNotify,
  type InboxReader,
  readInvitations as readInboxInvitations,
  roomInvitation,
  withAbortSignal,
} from "@jeswr/pod-access/notify";
import { ChatModelError, invitationRoom, loadRooms } from "../model";

export interface InvitationDelivery {
  webId: string;
  delivered: boolean;
  reason?: string;
}
export interface Invitation {
  room: string;
  /** A sender claim. For own-pod rooms it is a loaded member, unless the room was unreachable. */
  actor?: string;
  /** Own-pod rooms that loaded: the room's name. */
  name?: string;
}

export async function deliverInvitations(
  fetch: typeof globalThis.fetch,
  actor: string,
  room: { url: string; name: string; isDirect: boolean; members: readonly string[] },
  displayName: string,
  signal?: AbortSignal,
): Promise<InvitationDelivery[]> {
  const notify = createNotify({ fetch: signal ? withAbortSignal(fetch, signal) : fetch });
  const members = [...new Set(room.members)].filter((member) => member !== actor);
  const results: InvitationDelivery[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, members.length) }, async () => {
      while (cursor < members.length) {
        const index = cursor++;
        const webId = members[index] as string;
        if (signal?.aborted) {
          results[index] = { webId, delivered: false, reason: "aborted" };
          continue;
        }
        const result = await notify(webId, {
          ...roomInvitation(room.url),
          actor,
          summary: room.isDirect
            ? `${displayName} started a conversation with you`
            : `${displayName} invited you to ${room.name}`,
        });
        results[index] = {
          webId,
          delivered: result.delivered,
          ...(signal?.aborted
            ? { reason: "aborted" }
            : result.reason
              ? { reason: result.reason }
              : {}),
        };
      }
    }),
  );
  return results;
}

/** The own-pod room metadata an invitation check needs. */
export interface InvitationRoom {
  name: string;
  members: readonly string[];
}
/** Own-pod room checks shared across scans; a scan keeps only rooms its inbox still offers. */
export type InvitationRoomCache = Map<string, Promise<InvitationRoom | null>>;

/**
 * Rooms in the user's pod are created by that user, who is never invited: an index the owner
 * cannot read (4xx other than auth, timeout or rate limit) or that holds no room does not exist.
 */
function missingRoom(error: unknown): boolean {
  if (error instanceof ChatModelError) return true;
  const status: unknown = Object(error).status;
  return (
    typeof status === "number" && status >= 400 && status < 500 && ![401, 408, 429].includes(status)
  );
}

/**
 * Inbox children read per scan, in listing order (the listing carries no dates, so the reader
 * cannot choose the newest before fetching). Kind filtering happens after the fetch, so this is
 * the scan's request bound, not a result cap. Children beyond it are reported as `truncated`.
 */
export const INBOX_SCAN_LIMIT = 300;
/** Most invitation rows shown. */
const MAX_INVITATIONS = 50;
/** Own-pod rooms whose index is loaded for verification in one scan. */
const MAX_ROOM_CHECKS = 100;
/** Rows foreign or unverifiable claims may occupy together; verified rooms take the rest. */
const MAX_UNVERIFIED = 20;
/** Bytes read from the user's own rooms listing. */
const MAX_ROOMS_LISTING_BYTES = 1024 * 1024;
/**
 * Requests one scan makes beyond inbox discovery: the joined-rooms document, the inbox listing,
 * at most INBOX_SCAN_LIMIT inbox children, the own rooms listing and at most MAX_ROOM_CHECKS
 * room indexes. No limit is keyed on a claimed sender or any other poster-chosen value.
 */
export const MAX_SCAN_REQUESTS = 1 + 1 + INBOX_SCAN_LIMIT + 1 + MAX_ROOM_CHECKS;

/** What a scan found, and whether valid rows were left out. */
export interface InvitationScan {
  invitations: Invitation[];
  /** True when the inbox listing, an own-room check budget or a row cap left invitations out. */
  truncated: boolean;
}

export async function readInvitations({
  reader,
  joinedFetch,
  storage,
  webId,
  signal,
  loadRoom,
  cache,
  inboxTruncated,
}: {
  reader: InboxReader;
  joinedFetch: typeof globalThis.fetch;
  storage: string;
  webId: string;
  signal: AbortSignal;
  loadRoom(room: string, signal: AbortSignal): Promise<InvitationRoom>;
  cache: InvitationRoomCache;
  /** Read after the inbox listing: did the reader leave children unread? */
  inboxTruncated(): boolean;
}): Promise<InvitationScan> {
  signal.throwIfAborted();
  const joined = new Set((await loadRooms(withAbortSignal(joinedFetch, signal), storage)).rooms);
  // Own-pod claims are kept per room and sender, so a forged newer Offer from a non-member
  // cannot displace a member's Offer for the same room before membership is checked.
  const items = await readInboxInvitations({
    reader,
    webId,
    signal,
    kind: "invitation",
    limit: INBOX_SCAN_LIMIT,
    normalise(item) {
      if (!item.object) return null;
      const room = invitationRoom(item.object, storage);
      if (joined.has(room)) return null;
      const own = isWithinPodScope(storage, room);
      return {
        key: own ? JSON.stringify([room, item.actor ?? ""]) : room,
        value: { room, own, ...(item.actor ? { actor: item.actor } : {}) },
      };
    },
  });
  signal.throwIfAborted();
  let truncated = inboxTruncated();
  const claimed = new Set(items.filter((item) => item.own).map((item) => item.room));
  // An own-pod claim can only name a room that exists in the user's own rooms container, which
  // is listed once. Claims for rooms that do not exist cost nothing, however many are posted.
  const existing = new Set<string>();
  if (claimed.size) {
    const listing = await readContainerMembers(
      withAbortSignal(joinedFetch, signal),
      `${new URL("chat/rooms/", storage).href}`,
      { scope: storage, signal, package: "chat", maxBytes: MAX_ROOMS_LISTING_BYTES },
    );
    for (const member of listing ?? []) if (claimed.has(member.url)) existing.add(member.url);
  }
  const claims = new Map<string, (string | undefined)[]>();
  for (const item of items) {
    if (!item.own || !existing.has(item.room)) continue;
    if (!claims.has(item.room) && claims.size >= MAX_ROOM_CHECKS) {
      truncated = true;
      continue;
    }
    claims.set(item.room, [...(claims.get(item.room) ?? []), item.actor]);
  }
  for (const room of cache.keys()) {
    if (!claims.has(room)) cache.delete(room);
  }
  const check = (room: string) => {
    let pending = cache.get(room);
    if (!pending) {
      pending = loadRoom(room, signal).catch((error: unknown) => {
        if (missingRoom(error)) return null;
        cache.delete(room);
        throw error;
      });
      cache.set(room, pending);
    }
    return pending;
  };
  const rooms = [...claims.keys()];
  const verified = new Map<string, Invitation | null>();
  const names = new Set<string>();
  let cursor = 0;
  // Settle every worker before returning, so no load of this scan outlives it and touches the
  // cache a later scan owns.
  await Promise.allSettled(
    Array.from({ length: Math.min(4, rooms.length) }, async () => {
      while (cursor < rooms.length) {
        const room = rooms[cursor++] as string;
        const actors = claims.get(room) as (string | undefined)[];
        let loaded: InvitationRoom | null;
        try {
          loaded = await check(room);
        } catch {
          signal.throwIfAborted();
          // Unreachable or 5xx: keep the newest claim, unverified, with the fallback name.
          verified.set(room, { room, ...(actors[0] ? { actor: actors[0] } : {}) });
          continue;
        }
        signal.throwIfAborted();
        const actor = actors.find((claim) => claim && loaded?.members.includes(claim));
        if (loaded && actor) names.add(room);
        verified.set(room, loaded && actor ? { room, actor, name: loaded.name } : null);
      }
    }),
  );
  signal.throwIfAborted();
  // Verified own-pod rooms (a loaded room naming a claimed member, whatever its name) come first
  // and are never crowded out by unverified rows: foreign claims and verification-failed
  // fallbacks share one global budget, deduplicated by room URL only.
  const candidates = new Map<string, { invitation: Invitation; verified: boolean }>();
  for (const item of items) {
    const invitation = item.own
      ? verified.get(item.room)
      : { room: item.room, ...(item.actor ? { actor: item.actor } : {}) };
    if (!invitation || candidates.has(invitation.room)) continue;
    candidates.set(invitation.room, { invitation, verified: names.has(invitation.room) });
  }
  const chosen = new Set<string>();
  for (const [room, candidate] of candidates) {
    if (!candidate.verified) continue;
    if (chosen.size < MAX_INVITATIONS) chosen.add(room);
    else truncated = true;
  }
  let unverified = 0;
  for (const [room, candidate] of candidates) {
    if (candidate.verified) continue;
    if (unverified < MAX_UNVERIFIED && chosen.size < MAX_INVITATIONS) {
      unverified++;
      chosen.add(room);
    } else truncated = true;
  }
  const invitations = [...candidates]
    .filter(([room]) => chosen.has(room))
    .map(([, candidate]) => candidate.invitation);
  return { invitations, truncated };
}
