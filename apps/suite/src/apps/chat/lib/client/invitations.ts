// AUTHORED-BY Codex GPT-6.1-Sol
import {
  createInboxReader,
  createNotify,
  notificationKind,
  roomInvitation,
} from "@jeswr/pod-access/notify";
import { httpIri, loadRooms, roomContainer } from "../model";

export interface InvitationDelivery {
  webId: string;
  delivered: boolean;
  reason?: string;
}
export interface Invitation {
  room: string;
  actor?: string;
}

/** Offers use containers; also accept the canonical index subject from other senders. */
export function invitationRoom(value: string): string {
  const url = new URL(httpIri(value));
  if (url.search) throw new TypeError("Expected a room without a query");
  if (url.pathname.endsWith("/index.ttl") && (!url.hash || url.hash === "#it")) {
    url.hash = "";
    return roomContainer(new URL("./", url).href);
  }
  if (!url.pathname.endsWith("/")) throw new TypeError("Expected a room container");
  return roomContainer(url.href);
}

/** Preserve the SDK guard's own deadline signal as well as caller cancellation. */
function transport(fetch: typeof globalThis.fetch, signal?: AbortSignal): typeof globalThis.fetch {
  return async (input, init) => {
    signal?.throwIfAborted();
    const signals = [signal, init?.signal].filter((value): value is AbortSignal => !!value);
    const response = await fetch(input, { ...init, signal: AbortSignal.any(signals) });
    signal?.throwIfAborted();
    return response;
  };
}

export async function deliverInvitations(
  fetch: typeof globalThis.fetch,
  actor: string,
  room: { url: string; name: string; isDirect: boolean; members: readonly string[] },
  displayName: string,
  signal?: AbortSignal,
): Promise<InvitationDelivery[]> {
  const notify = createNotify({ fetch: transport(fetch, signal) });
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

export async function readInvitations(
  fetch: typeof globalThis.fetch,
  joinedFetch: typeof globalThis.fetch,
  storage: string,
  webId: string,
  signal?: AbortSignal,
): Promise<Invitation[]> {
  signal?.throwIfAborted();
  const scoped = transport(fetch, signal);
  const reader = createInboxReader({ fetch: scoped, maxItems: 200 });
  const inbox = await reader.inbox(webId);
  signal?.throwIfAborted();
  if (!inbox) return [];
  const notifications = await reader.list(inbox, { ...(signal ? { signal } : {}) });
  const { rooms } = await loadRooms(transport(joinedFetch, signal), storage);
  signal?.throwIfAborted();
  const joined = new Set(rooms);
  const invitations = new Map<string, Invitation>();
  // The SDK orders newest first. Keep the first occurrence of each room.
  for (const item of notifications) {
    if (notificationKind(item) !== "invitation" || !item.object) continue;
    let room: string;
    try {
      room = invitationRoom(item.object);
    } catch {
      continue;
    }
    if (joined.has(room) || invitations.has(room)) continue;
    invitations.set(room, { room, ...(item.actor ? { actor: item.actor } : {}) });
    if (invitations.size === 50) break;
  }
  return [...invitations.values()];
}
