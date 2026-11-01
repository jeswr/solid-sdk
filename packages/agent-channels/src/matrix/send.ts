// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  assertJsonBounds,
  canonicalJson,
  digestBytes,
  parseBoundedJson,
  validateMessage,
} from "@jeswr/agent-model";
import type { CarriageProfile, ChannelBinding } from "../binding.js";
import { accountId } from "../direct/shared.js";
import { summaryLines } from "../email/bodies.js";
import { assertFooter, decodeEmailProposal } from "../email-mime.js";
import { decodeEventContent, encodeEventContent } from "../envelope.js";
import { ChannelParseError, ProviderRejectedError } from "../errors.js";
import type { MatrixCrypto } from "../matrix/crypto.js";
import type { OriginFetchOptions } from "../origins.js";
import { AGENT_FOOTER, MATRIX_CONTENT } from "../profiles.js";
import type { AccountRef, RenderableProposal, TokenProvider, Wire } from "../types.js";
import {
  bridgeChannel,
  detectMatrixBridge,
  type MatrixBridgeChannel,
  matrixBridgeProfile,
} from "./bridge.js";
import { identifier, json, MATRIX_LIMITS, matrixRest, record, responseBody } from "./shared.js";

export interface MatrixSendOptions {
  readonly account: AccountRef;
  readonly homeserver: string;
  readonly userId: string;
  /** Trusted actor -> DM room pins; never use an inbound/model-selected destination. */
  readonly recipients: ReadonlyMap<string, string>;
  /** Trusted room -> bridge pins for deterministic footer-only rendering. */
  readonly bridgeRooms?: ReadonlyMap<string, MatrixBridgeChannel>;
  readonly tokens: TokenProvider;
  readonly transport?: OriginFetchOptions;
  readonly footer?: string;
  /** Local signature verifier, including sender key and intended audience. */
  readonly verify: (compactJws: string) => Promise<unknown>;
  /** Executor verifies the CURRENT mandate, halt/limits and owner approval for this wire/account. */
  readonly verifyApproval: (wire: Wire, account: AccountRef) => Promise<boolean>;
  /** Persisted provider event ID from the executor's outbox, when known. Never guess absence. */
  readonly eventIdFor?: (proposalId: string, account: AccountRef) => Promise<string | undefined>;
  readonly crypto?: MatrixCrypto;
  readonly now?: () => number;
}
/** Executor-only, approval-required send; no implicit network activity or retries. */
export function createMatrixSend(options: MatrixSendOptions): NonNullable<ChannelBinding["send"]> {
  const account = Object.freeze({ id: accountId(options.account) });
  const userId = identifier(options.userId, "@");
  const recipients = new Map(options.recipients);
  for (const room of recipients.values()) identifier(room, "!");
  const bridgeRooms = new Map(options.bridgeRooms);
  for (const [room, channel] of bridgeRooms) {
    identifier(room, "!");
    bridgeChannel(channel);
  }
  const carriageFor = (room: string) => {
    const bridge = bridgeRooms.get(room);
    return bridge === undefined ? MATRIX_CONTENT : matrixBridgeProfile(bridge);
  };
  const footer = options.footer ?? AGENT_FOOTER;
  assertFooter(footer);
  const { verify, verifyApproval, eventIdFor, crypto } = options;
  const lookupTokens = options.tokens;
  const now = options.now ?? Date.now;
  const rest = matrixRest(options.homeserver, options.transport);
  function current(message: RenderableProposal["message"]) {
    const at = now();
    if (
      !Number.isFinite(at) ||
      Date.parse(message.createdAt) > at ||
      Date.parse(message.expiresAt) <= at
    )
      throw new ChannelParseError("Matrix message is expired or not yet valid");
  }
  async function render(proposal: RenderableProposal, carriage: CarriageProfile): Promise<Wire> {
    const compactJws = proposal.compactJws;
    const decoded = decodeEmailProposal(compactJws);
    assertJsonBounds(proposal.message);
    const proposed = canonicalJson(proposal.message);
    const payload = await verify(compactJws);
    assertJsonBounds(payload);
    const checked = validateMessage(payload);
    if (
      !checked.ok ||
      canonicalJson(checked.message) !== proposed ||
      canonicalJson(decoded.message) !== proposed
    )
      throw new ChannelParseError("signed Matrix payload differs from proposal");
    const message = checked.message;
    const roomId = message.to && recipients.get(message.to.actor);
    if (!roomId) throw new ChannelParseError("no pinned Matrix recipient");
    const profile = carriageFor(roomId);
    if (canonicalJson(carriage) !== canonicalJson(profile))
      throw new ChannelParseError("unsupported Matrix carriage");
    const bridge = bridgeRooms.get(roomId);
    const content = {
      msgtype: "m.text",
      body: [
        `Automated message from ${message.from.actor}`,
        "",
        ...summaryLines(message),
        // Bridges carry no envelope: retain every body value, including those the summary omits.
        ...(bridge === undefined ? [] : [`Body: ${canonicalJson(message.body)}`]),
        "",
        footer,
      ].join("\n"),
      ...(bridge === undefined ? encodeEventContent(compactJws) : {}),
    };
    // The executor retains the signature in its reviewed wire. Only content is sent to Matrix.
    const bytes = canonicalJson({
      roomId,
      txnId: message.id,
      content,
      ...(bridge === undefined ? {} : { compactJws }),
    });
    if (Buffer.byteLength(bytes) > profile.maxBytes)
      throw new ChannelParseError("Matrix wire exceeds byte cap");
    return { bytes, mediaType: "application/json", digest: digestBytes(bytes) };
  }
  function assertWire(input: Wire): Wire {
    const wire = { bytes: input.bytes, digest: input.digest, mediaType: input.mediaType };
    if (
      Reflect.ownKeys(input).length !== 3 ||
      wire.mediaType !== "application/json" ||
      typeof wire.bytes !== "string" ||
      Buffer.byteLength(wire.bytes) > MATRIX_CONTENT.maxBytes ||
      wire.digest !== digestBytes(wire.bytes)
    )
      throw new ChannelParseError("invalid Matrix wire");
    return Object.freeze(wire);
  }
  async function checked(wire: Wire) {
    const snapshot = assertWire(wire);
    const data = json(snapshot.bytes, MATRIX_CONTENT.maxBytes);
    const carriage = carriageFor(identifier(data.roomId, "!"));
    const proposal = decodeEmailProposal(
      carriage === MATRIX_CONTENT ? decodeEventContent(data.content) : (data.compactJws as string),
    );
    if ((await render(proposal, carriage)).bytes !== snapshot.bytes)
      throw new ChannelParseError("Matrix wire differs from signed proposal");
    return { snapshot, proposal, roomId: data.roomId as string, content: record(data.content) };
  }
  return {
    render,
    async validate(wire, proposal) {
      try {
        const snapshot = assertWire(wire);
        const expected = await render(
          proposal,
          carriageFor(identifier(json(snapshot.bytes, MATRIX_CONTENT.maxBytes).roomId, "!")),
        );
        current(decodeEmailProposal(proposal.compactJws).message);
        return snapshot.bytes === expected.bytes
          ? { ok: true }
          : { ok: false, reason: "terms-digest-mismatch" };
      } catch {
        return { ok: false, reason: "malformed" };
      }
    },
    async transmit(wire, io) {
      if (io.dryRun !== false) return { outcome: "rejected", detail: "dry-run" };
      if (accountId(io.account) !== account.id)
        throw new ProviderRejectedError("Matrix sender account mismatch");
      const { snapshot, proposal, roomId, content } = await checked(wire);
      current(proposal.message);
      // This task specifies m.room.message sends. Refuse encrypted rooms rather than downgrade them.
      const responseState = await rest(
        `/rooms/${encodeURIComponent(roomId)}/state`,
        account,
        io.tokens,
        "send",
      );
      if (!responseState.ok)
        throw new ProviderRejectedError(
          "Matrix plaintext send requires a confirmed unencrypted room",
        );
      let state: unknown;
      try {
        state = parseBoundedJson(await responseState.text(), MATRIX_LIMITS);
      } catch {
        throw new ProviderRejectedError("Matrix room state is unreadable");
      }
      if (!Array.isArray(state))
        throw new ProviderRejectedError(
          "Matrix plaintext send requires a confirmed unencrypted room",
        );
      for (const value of state) {
        const event = record(value);
        if (typeof event.type !== "string" || !event.type || typeof event.state_key !== "string")
          throw new ProviderRejectedError("invalid Matrix room state");
        record(event.content);
        if (event.type === "m.room.encryption")
          throw new ProviderRejectedError(
            "Matrix plaintext send requires a confirmed unencrypted room",
          );
      }
      // Re-check room state even for native Matrix wires: a newly bridged room must
      // never receive a structured carrier approved for a different carriage.
      const bridge = detectMatrixBridge(undefined, state);
      if (bridge !== bridgeRooms.get(roomId))
        throw new ProviderRejectedError("Matrix bridge room differs from reviewed carriage");
      const response = await rest(
        `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(proposal.message.id)}`,
        account,
        io.tokens,
        "send",
        canonicalJson(content),
        async () => {
          current(proposal.message);
          if (
            typeof verifyApproval !== "function" ||
            (await verifyApproval(snapshot, account)) !== true
          )
            throw new ProviderRejectedError("current mandate and owner approval required");
          current(proposal.message);
        },
      );
      if ([400, 401, 403, 404].includes(response.status))
        throw new ProviderRejectedError(`Matrix send refused: HTTP ${response.status}`);
      if (!response.ok) throw new Error(`Matrix send uncertain: HTTP ${response.status}`);
      try {
        return {
          outcome: "accepted",
          providerRef: identifier((await responseBody(response)).event_id, "$"),
        };
      } catch {
        throw new Error("Matrix send uncertain: invalid acknowledgement");
      }
    },
    async lookup(wire) {
      try {
        const { proposal, roomId, content } = await checked(wire);
        const id = await eventIdFor?.(proposal.message.id, account);
        if (id === undefined)
          return { outcome: "unknown", detail: "Matrix provider event ID unavailable" };
        identifier(id, "$");
        const response = await rest(
          `/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(id)}`,
          account,
          lookupTokens,
          "read",
        );
        if (!response.ok) return { outcome: "unknown", detail: "Matrix event not readable" };
        let event = await responseBody(response);
        if (event.type === "m.room.encrypted") {
          if (!crypto) throw new ChannelParseError("Matrix lookup requires decryption");
          event = await crypto.decrypt(event, roomId);
        }
        if (
          event.type === "m.room.message" &&
          event.event_id === id &&
          event.sender === userId &&
          (event.room_id === undefined || event.room_id === roomId) &&
          canonicalJson(event.content) === canonicalJson(content)
        )
          return { outcome: "found", providerRef: id };
        return { outcome: "unknown", detail: "Matrix event differs from reviewed message" };
      } catch {
        return { outcome: "unknown", detail: "Matrix lookup could not verify the event" };
      }
    },
    // Omitted finalAbsence means false: an event lookup miss never permits retry.
  };
}
