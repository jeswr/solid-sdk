// AUTHORED-BY Codex GPT-6.1-Sol
import {
  createNotify,
  type InboxReader,
  readInvitations as readInboxInvitations,
  roomInvitation,
  withAbortSignal,
} from "@jeswr/pod-access/notify";
import { invitationRoom, loadRooms } from "../model";

export interface InvitationDelivery {
  webId: string;
  delivered: boolean;
  reason?: string;
}
export interface Invitation {
  room: string;
  actor?: string;
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

export async function readInvitations(
  reader: InboxReader,
  joinedFetch: typeof globalThis.fetch,
  storage: string,
  webId: string,
  signal: AbortSignal,
): Promise<Invitation[]> {
  signal.throwIfAborted();
  const { rooms } = await loadRooms(withAbortSignal(joinedFetch, signal), storage);
  return readInboxInvitations({
    reader,
    webId,
    signal,
    kind: "invitation",
    exclude: new Set(rooms),
    normalise(item) {
      if (!item.object) return null;
      const room = invitationRoom(item.object, storage);
      return { key: room, value: { room, ...(item.actor ? { actor: item.actor } : {}) } };
    },
  });
}
