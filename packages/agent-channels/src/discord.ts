// AUTHORED-BY Codex GPT-6.1-Sol
import { digestBytes } from "@jeswr/agent-model";
import type { ChannelBinding } from "./binding.js";
import { accountId, assertGrant } from "./direct/shared.js";
import {
  cleanText,
  discordOrigins,
  GATEWAY_ORIGIN,
  MAX_EVENT_BYTES,
  readJson,
  record,
  snowflake,
} from "./discord/shared.js";
import { ChannelParseError } from "./errors.js";
import { DISCORD_FOOTER } from "./profiles.js";
import type { AccountRef, Bounds, TokenProvider } from "./types.js";

export const ORIGINS: ReadonlySet<string> = discordOrigins();
export const GATEWAY_INTENTS = Object.freeze({
  GUILD_MESSAGES: 1 << 9,
  DIRECT_MESSAGES: 1 << 12,
  MESSAGE_CONTENT: 1 << 15,
});
export const DISCORD_INTENTS =
  GATEWAY_INTENTS.GUILD_MESSAGES |
  GATEWAY_INTENTS.DIRECT_MESSAGES |
  GATEWAY_INTENTS.MESSAGE_CONTENT;
export const DISCORD_DESCRIPTION =
  "Bot-visible guild channels and bot DMs only. Personal user DMs are unavailable; bots cannot DM users who do not share a server. MESSAGE_CONTENT must be enabled and approved where Discord requires it.";

/**
 * Trusted Gateway transport seam, not a fetch or a model tool. The host owns
 * Identify (with these intents), heartbeats, reconnect/resume and a replayable
 * account-scoped event buffer. It must pin TLS/DNS to origin, refuse redirects,
 * bound buffering, and replay the same batch when a caller retries a cursor.
 * Never log accessToken. No user-account/self-bot transport is supported.
 */
export interface DiscordGatewaySource {
  read(options: {
    readonly origin: typeof GATEWAY_ORIGIN;
    readonly account: AccountRef;
    readonly accessToken: string;
    readonly intents: number;
    readonly cursor: string | undefined;
    readonly limits: Bounds;
  }): Promise<{ readonly events: readonly (string | Uint8Array)[]; readonly next: string }>;
}
export interface DiscordReaderOptions {
  readonly tokens: TokenProvider;
  readonly gateway: DiscordGatewaySource;
}
function checkpoint(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || /[\p{Cc}]/u.test(value))
    throw new ChannelParseError("invalid Discord checkpoint");
  return value;
}
function messageEvent(raw: string | Uint8Array) {
  const { value } = readJson(raw);
  if (value.op !== 0 || value.t !== "MESSAGE_CREATE") return undefined;
  return record(value.d);
}
/** Reader only; Gateway credentials always come from TokenProvider.read. */
export function createDiscordReader(options: DiscordReaderOptions): ChannelBinding {
  const tokens = options.tokens;
  const read = options.gateway.read.bind(options.gateway);
  return {
    id: "discord",
    carriage: DISCORD_FOOTER,
    origins: discordOrigins(),
    describe(state) {
      return {
        type: "channel-capability",
        id: "urn:agent:binding:discord",
        channel: "discord",
        binding: "discord",
        carriage: DISCORD_FOOTER.id,
        description: DISCORD_DESCRIPTION,
        structuredPayload: false,
        endToEndEncrypted: false,
        deliveryReceipts: false,
        historyWindow: "P0D",
        maxMessageBytes: DISCORD_FOOTER.maxBytes,
        sendSupported: true,
        costPerMessage: 0,
        rateLimit: { perRecipient: 0, perDay: 0 },
        credentialState: state,
      };
    },
    ingest: {
      async list(account, cursor, limits) {
        const ref = Object.freeze({ id: accountId(account) });
        const bounds = Object.freeze({ maxItems: limits.maxItems, maxBytes: limits.maxBytes });
        if (
          !Number.isSafeInteger(bounds.maxItems) ||
          bounds.maxItems <= 0 ||
          !Number.isSafeInteger(bounds.maxBytes) ||
          bounds.maxBytes <= 0
        )
          throw new RangeError("list bounds must be positive safe integers");
        let after: string | undefined;
        if (cursor !== undefined) {
          const { value } = readJson(cursor);
          if (Object.keys(value).sort().join() !== "account,checkpoint" || value.account !== ref.id)
            throw new ChannelParseError("invalid account cursor");
          after = checkpoint(value.checkpoint);
        }
        const grant = await tokens.read(ref);
        assertGrant(grant, "read");
        let batch: Awaited<ReturnType<typeof read>>;
        try {
          batch = await read(
            Object.freeze({
              origin: GATEWAY_ORIGIN,
              account: ref,
              accessToken: grant.accessToken,
              intents: DISCORD_INTENTS,
              cursor: after,
              limits: bounds,
            }),
          );
        } catch {
          throw new Error("Discord Gateway read failed");
        }
        const next = checkpoint(batch.next);
        if (!Array.isArray(batch.events) || batch.events.length > bounds.maxItems)
          throw new ChannelParseError("Discord Gateway exceeded item bound");
        const items = [];
        let bytes = 0;
        for (const event of batch.events) {
          if (typeof event !== "string" && !(event instanceof Uint8Array))
            throw new ChannelParseError("invalid Discord Gateway event");
          const size = Buffer.byteLength(event);
          bytes += size;
          if (bytes > bounds.maxBytes || size > MAX_EVENT_BYTES)
            throw new RangeError("Discord Gateway exceeded byte bound");
          // Bound allocation before snapshotting mutable buffers for provenance.
          const raw = typeof event === "string" ? event : new Uint8Array(event);
          const message = messageEvent(raw);
          if (message) items.push({ id: snowflake(message.id), raw });
        }
        return { items, next: JSON.stringify({ account: ref.id, checkpoint: next }) };
      },
      parse(item) {
        const message = messageEvent(item.raw);
        if (!message || snowflake(message.id) !== item.id)
          throw new ChannelParseError("Discord message id mismatch");
        const channel = snowflake(message.channel_id);
        if (message.guild_id !== undefined) snowflake(message.guild_id);
        const author = record(message.author);
        const sender = snowflake(author.id);
        const text = [cleanText(message.content, 4000)];
        if (!Array.isArray(message.embeds) || message.embeds.length > 10)
          throw new ChannelParseError("invalid Discord embeds");
        for (const embed of message.embeds) {
          const footer = record(embed).footer;
          if (footer !== undefined) text.push(cleanText(record(footer).text, 2048));
        }
        const name = author.global_name ?? author.username;
        if (
          typeof message.timestamp !== "string" ||
          !Number.isFinite(Date.parse(message.timestamp))
        )
          throw new ChannelParseError("invalid Discord timestamp");
        return {
          channel: "discord",
          sender: { handle: sender, displayName: cleanText(name, 128) },
          textBody: text.join("\n"),
          messageId: item.id,
          threadId: channel,
          date: new Date(message.timestamp).toISOString(),
          signals: Object.freeze({}),
          rawSha256: digestBytes(item.raw).slice("sha-256:".length),
          rawByteLength: Buffer.byteLength(item.raw),
          rawMediaType: "application/json",
          warnings: ["identity-unverified"],
        };
      },
      threadKey(message) {
        return message.threadId;
      },
    },
  };
}
