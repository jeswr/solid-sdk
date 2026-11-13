// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5

import { isWithinPodScope } from "@jeswr/guarded-fetch";
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

export async function readInvitations({
  reader,
  joinedFetch,
  storage,
  webId,
  signal,
  loadRoom,
  cache,
}: {
  reader: InboxReader;
  joinedFetch: typeof globalThis.fetch;
  storage: string;
  webId: string;
  signal: AbortSignal;
  loadRoom(room: string, signal: AbortSignal): Promise<InvitationRoom>;
  cache: InvitationRoomCache;
}): Promise<Invitation[]> {
  signal.throwIfAborted();
  const joined = new Set((await loadRooms(withAbortSignal(joinedFetch, signal), storage)).rooms);
  // Own-pod claims are kept per room and sender, so a forged newer Offer from a non-member
  // cannot displace a member's Offer for the same room before membership is checked.
  const items = await readInboxInvitations({
    reader,
    webId,
    signal,
    kind: "invitation",
    limit: 100,
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
  const claims = new Map<string, (string | undefined)[]>();
  for (const item of items.filter((item) => item.own))
    claims.set(item.room, [...(claims.get(item.room) ?? []), item.actor]);
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
        verified.set(room, loaded && actor ? { room, actor, name: loaded.name } : null);
      }
    }),
  );
  signal.throwIfAborted();
  const result: Invitation[] = [];
  for (const item of items) {
    const invitation = item.own
      ? verified.get(item.room)
      : { room: item.room, ...(item.actor ? { actor: item.actor } : {}) };
    if (!invitation || result.some((found) => found.room === invitation.room)) continue;
    result.push(invitation);
    if (result.length === 50) break;
  }
  return result;
}
