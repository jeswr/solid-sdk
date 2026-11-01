// AUTHORED-BY Codex GPT-6.1-Sol
import { digestBytes } from "@jeswr/agent-model";
import { matrixEventToCanonical } from "@jeswr/matrix-chat-to-pod/transform";
import type { ChannelBinding } from "./binding.js";
import type { InboundRawMessage } from "./channel.js";
import { accountId } from "./direct/shared.js";
import { decodeEventContent, ENVELOPE_KEY, encodeEnvelope } from "./envelope.js";
import { ChannelParseError } from "./errors.js";
import type { MatrixCrypto } from "./matrix/crypto.js";
import {
  identifier,
  json,
  matrixOrigins,
  matrixRest,
  record,
  responseBody,
  syncToken,
} from "./matrix/shared.js";
import type { OriginFetchOptions } from "./origins.js";
import { MATRIX_CONTENT } from "./profiles.js";
import type { AccountRef, TokenProvider } from "./types.js";

export { createMatrixCrypto, type MatrixCrypto } from "./matrix/crypto.js";
export { matrixOrigins } from "./matrix/shared.js";

export interface MatrixReaderOptions {
  readonly account: AccountRef;
  readonly homeserver: string;
  readonly userId: string;
  readonly tokens: TokenProvider;
  readonly crypto: MatrixCrypto;
  readonly transport?: OriginFetchOptions;
}
interface State {
  account: string;
  homeserver: string;
  userId: string;
  since: string;
  pending: Record<string, unknown>[];
}
/** Failed room/decryption never advances the caller's checkpoint or hides a gap. */
export class MatrixRoomError extends ChannelParseError {
  constructor(readonly roomId: string) {
    super("Matrix room failed; retain the previous cursor");
  }
}
function cursorState(cursor: string, account: string, homeserver: string, userId: string): State {
  const state = json(cursor);
  if (
    Object.keys(state).sort().join() !== "account,homeserver,pending,since,userId" ||
    state.account !== account ||
    state.homeserver !== homeserver ||
    state.userId !== userId ||
    !Array.isArray(state.pending) ||
    state.pending.length > 512
  )
    throw new ChannelParseError("invalid Matrix account cursor");
  syncToken(state.since);
  state.pending.forEach((value) => {
    const event = record(value);
    identifier(event.room_id, "!");
    identifier(event.event_id, "$");
  });
  return state as unknown as State;
}
/** Pure parser: decrypted content is still untrusted, and never authenticates an agent. */
export function parseMatrixMessage(item: InboundRawMessage): import("./message.js").BridgeMessage {
  const raw = json(item.raw, MATRIX_CONTENT.maxBytes);
  if (raw.type === "m.room.encrypted" && typeof item.native !== "string")
    throw new ChannelParseError("Matrix encrypted event requires bounded decrypted JSON");
  const event =
    raw.type === "m.room.encrypted" ? json(item.native as string, MATRIX_CONTENT.maxBytes) : raw;
  const roomId = identifier(raw.room_id, "!");
  const eventId = identifier(raw.event_id, "$");
  if (
    item.id !== eventId ||
    event.event_id !== eventId ||
    event.room_id !== roomId ||
    event.sender !== raw.sender
  )
    throw new ChannelParseError("Matrix decrypted event identity mismatch");
  const canonical = matrixEventToCanonical(event, {
    messageIriFor: (id) =>
      `https://matrix.to/#/${encodeURIComponent(roomId)}/${encodeURIComponent(id)}`,
  });
  // Edits and redactions cannot masquerade as new statements or reuse signed carriers.
  if (canonical.kind !== "message")
    throw new ChannelParseError("Matrix event is not a new text message");
  const content = record(event.content);
  const blocks = Object.hasOwn(content, ENVELOPE_KEY)
    ? [encodeEnvelope(decodeEventContent(content))]
    : undefined;
  const bytes = typeof item.raw === "string" ? new TextEncoder().encode(item.raw) : item.raw;
  return {
    channel: "matrix",
    ...(canonical.matrixSender === undefined
      ? {}
      : { sender: { handle: identifier(canonical.matrixSender, "@") } }),
    textBody: canonical.message.content,
    ...(canonical.message.published === undefined ? {} : { date: canonical.message.published }),
    messageId: eventId,
    threadId: roomId,
    signals: Object.freeze(Object.create(null)) as Readonly<Record<string, string>>,
    rawSha256: digestBytes(bytes).slice(8),
    rawByteLength: bytes.byteLength,
    rawMediaType: "application/json",
    warnings: [],
    ...(blocks === undefined ? {} : { jsonLdBlocks: blocks }),
  };
}
function directRooms(value: unknown): Set<string> {
  const rooms = new Set<string>();
  for (const ids of Object.values(record(value))) {
    if (!Array.isArray(ids)) throw new ChannelParseError("invalid Matrix m.direct rooms");
    for (const id of ids) rooms.add(identifier(id, "!"));
  }
  if (rooms.size > 512) throw new ChannelParseError("Matrix direct room cap exceeded");
  return rooms;
}
/** Read-only, account-pinned /sync binding, restricted to m.direct rooms. */
export function createMatrixReader(options: MatrixReaderOptions): ChannelBinding {
  const account = Object.freeze({ id: accountId(options.account) });
  const homeserver = options.homeserver;
  const userId = identifier(options.userId, "@");
  const tokens = options.tokens;
  const crypto = options.crypto;
  const rest = matrixRest(homeserver, options.transport);
  return {
    id: "matrix",
    carriage: MATRIX_CONTENT,
    origins: matrixOrigins(homeserver),
    describe(state) {
      return {
        type: "channel-capability",
        id: "urn:agent:binding:matrix",
        channel: "matrix",
        binding: "matrix",
        carriage: MATRIX_CONTENT.id,
        structuredPayload: true,
        endToEndEncrypted: true,
        deliveryReceipts: false,
        historyWindow: "P0D",
        maxMessageBytes: MATRIX_CONTENT.maxBytes,
        sendSupported: true,
        costPerMessage: 0,
        rateLimit: { perRecipient: 0, perDay: 0 },
        credentialState: state,
      };
    },
    ingest: {
      async list(ref, cursor, { maxItems, maxBytes }) {
        if (accountId(ref) !== account.id)
          throw new ChannelParseError("Matrix account differs from configured device");
        if (
          !Number.isSafeInteger(maxItems) ||
          maxItems <= 0 ||
          !Number.isSafeInteger(maxBytes) ||
          maxBytes <= 0
        )
          throw new RangeError("list bounds must be positive safe integers");
        let state: State =
          cursor === undefined
            ? { account: account.id, homeserver, userId, since: "", pending: [] }
            : cursorState(cursor, account.id, homeserver, userId);
        if (!state.pending.length) {
          const response = await rest(
            `/user/${encodeURIComponent(userId)}/account_data/m.direct`,
            account,
            tokens,
            "read",
          );
          let rooms = directRooms(response.status === 404 ? {} : await responseBody(response));
          const requestedRooms = rooms;
          const filter = {
            room: {
              rooms: [...rooms],
              include_leave: true,
              timeline: { limit: 512, types: ["m.room.message", "m.room.encrypted"] },
              state: { types: [] },
              ephemeral: { types: [] },
            },
            presence: { types: [] },
          };
          const params = new URLSearchParams({ filter: JSON.stringify(filter), timeout: "0" });
          if (state.since) params.set("since", state.since);
          const sync = await responseBody(await rest(`/sync?${params}`, account, tokens, "read"));
          const since = syncToken(sync.next_batch);
          // This sync's account data supersedes the earlier snapshot, including removals.
          const updates = record(sync.account_data ?? {}).events;
          if (updates !== undefined) {
            if (!Array.isArray(updates)) throw new ChannelParseError("invalid Matrix account data");
            for (const update of updates)
              if (record(update).type === "m.direct") rooms = directRooms(record(update).content);
          }
          // A newly direct room was excluded from this request's filter. Retry from
          // the previous checkpoint with fresh m.direct data instead of losing its timeline.
          for (const room of rooms) if (!requestedRooms.has(room)) throw new MatrixRoomError(room);
          await crypto.receiveSync(sync);
          const pending: Record<string, unknown>[] = [];
          const roomUpdates = record(sync.rooms ?? {});
          for (const membership of ["join", "leave"]) {
            for (const [roomId, data] of Object.entries(record(roomUpdates[membership] ?? {}))) {
              if (!rooms.has(roomId)) continue;
              try {
                const room = record(data);
                if (!Object.hasOwn(room, "timeline")) continue;
                const timeline = record(room.timeline);
                if (timeline.limited === true || !Array.isArray(timeline.events)) throw new Error();
                for (const value of timeline.events) {
                  const event = record(value);
                  identifier(event.event_id, "$");
                  if (event.room_id !== undefined && event.room_id !== roomId) throw new Error();
                  pending.push({ ...event, room_id: roomId });
                }
              } catch {
                throw new MatrixRoomError(roomId);
              }
            }
          }
          if (pending.length > 512) throw new ChannelParseError("Matrix sync item cap exceeded");
          state = { ...state, since, pending };
          json(JSON.stringify(state));
        }
        const items: InboundRawMessage[] = [];
        let bytes = 0;
        while (state.pending.length && items.length < maxItems) {
          const event = state.pending[0] as Record<string, unknown>;
          const raw = JSON.stringify(event);
          const size = Buffer.byteLength(raw);
          if (size > MATRIX_CONTENT.maxBytes || bytes + size > maxBytes) {
            if (!items.length) throw new RangeError("next Matrix item exceeds byte bound");
            break;
          }
          let native: unknown = event;
          if (event.type === "m.room.encrypted") {
            try {
              native = JSON.stringify(await crypto.decrypt(event, event.room_id as string));
            } catch {
              throw new MatrixRoomError(event.room_id as string);
            }
          }
          items.push({ id: event.event_id as string, raw, native });
          bytes += size;
          state.pending.shift();
        }
        return { items, next: JSON.stringify(state) };
      },
      parse: parseMatrixMessage,
      threadKey: (message) => message.threadId,
    },
  };
}
