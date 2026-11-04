// AUTHORED-BY Codex GPT-6.1-Sol
import { DEFAULT_LIMITS, digestBytes, parseBoundedJson } from "@jeswr/agent-model";
import type { ChannelBinding } from "./binding.js";
import { accountId, assertGrant } from "./direct/shared.js";
import { ChannelParseError } from "./errors.js";
import { createOriginScopedFetch, type OriginFetchOptions } from "./origins.js";
import { X_READ_ONLY } from "./profiles.js";
import type { TokenProvider } from "./types.js";
import type { XSpendCounter } from "./x/spend.js";

export { createXSpendCounter, type XSpendCounter, type XSpendOptions } from "./x/spend.js";

const origins = () => new Set(["https://api.x.com"]);
const MAX_X_BYTES = 1024 * 1024;
export const ORIGINS: ReadonlySet<string> = origins();
/** The credentials layer obtains a user grant with OAuth 2 authorization code + PKCE S256. */
export const X_READ_SCOPES = Object.freeze(["dm.read", "tweet.read", "users.read"]);
export interface XReaderOptions {
  readonly enabled?: boolean;
  readonly tokens: TokenProvider;
  readonly spend: XSpendCounter;
  readonly transport?: OriginFetchOptions;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ChannelParseError("invalid X object");
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9]{1,40}$/.test(value))
    throw new ChannelParseError("invalid X identifier");
  return value;
}
function pageToken(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,2048}$/.test(value))
    throw new ChannelParseError("invalid X page token");
  return value;
}
function json(raw: string | Uint8Array): Record<string, unknown> {
  try {
    if (typeof raw !== "string" && raw.byteLength > MAX_X_BYTES)
      throw new ChannelParseError("X input exceeds byte bound");
    const text =
      typeof raw === "string" ? raw : new TextDecoder("utf-8", { fatal: true }).decode(raw);
    return object(parseBoundedJson(text, { ...DEFAULT_LIMITS, maxEnvelopeBytes: MAX_X_BYTES }));
  } catch {
    throw new ChannelParseError("invalid bounded X JSON");
  }
}
function event(value: unknown): Record<string, unknown> {
  const row = object(value);
  id(row.id);
  id(row.sender_id);
  if (
    row.event_type !== "MessageCreate" ||
    typeof row.text !== "string" ||
    row.text.length > DEFAULT_LIMITS.maxStringLength ||
    typeof row.dm_conversation_id !== "string" ||
    !/^[0-9-]{1,100}$/.test(row.dm_conversation_id) ||
    typeof row.created_at !== "string" ||
    !Number.isFinite(Date.parse(row.created_at))
  )
    throw new ChannelParseError("invalid X message event");
  return row;
}
/** Optional, read-only DM lookup. This module implements no OAuth exchange or send path. */
export function createXReader(options: XReaderOptions): ChannelBinding {
  const enabled = options.enabled === true;
  const { tokens, spend } = options;
  const scoped = createOriginScopedFetch(origins(), options.transport);
  return {
    id: "x",
    carriage: X_READ_ONLY,
    origins: origins(),
    describe(state) {
      return {
        type: "channel-capability",
        id: "urn:agent:binding:x",
        channel: "x",
        binding: "x",
        carriage: X_READ_ONLY.id,
        structuredPayload: false,
        endToEndEncrypted: false,
        deliveryReceipts: false,
        historyWindow: "P30D",
        maxMessageBytes: 0,
        sendSupported: false,
        costPerMessage: 0,
        rateLimit: { perRecipient: 0, perDay: 0 },
        credentialState: enabled ? state : "disabled",
      };
    },
    ingest: {
      async list(account, cursor, limits) {
        if (!enabled) throw new Error("X read binding is disabled");
        const ref = Object.freeze({ id: accountId(account) });
        const { maxItems, maxBytes } = limits;
        if (
          !Number.isSafeInteger(maxItems) ||
          maxItems <= 0 ||
          !Number.isSafeInteger(maxBytes) ||
          maxBytes <= 0
        )
          throw new RangeError("list bounds must be positive safe integers");
        let page = "";
        if (cursor !== undefined) {
          const state = json(cursor);
          if (Object.keys(state).sort().join() !== "account,page" || state.account !== ref.id)
            throw new ChannelParseError("invalid account cursor");
          page = state.page === "" ? "" : pageToken(state.page);
        }
        const params = new URLSearchParams({
          max_results: String(Math.min(100, maxItems)),
          event_types: "MessageCreate",
          "dm_event.fields": "id,text,event_type,sender_id,dm_conversation_id,created_at",
        });
        if (page) params.set("pagination_token", page);
        // Reserve synchronously, so concurrent callers cannot overshoot before their awaits.
        spend.reserve();
        const grant = await tokens.read(ref);
        assertGrant(grant, "read");
        const response = await scoped(`https://api.x.com/2/dm_events?${params}`, {
          method: "GET",
          redirect: "manual",
          headers: { authorization: `Bearer ${grant.accessToken}` },
        });
        if (!response.ok) throw new Error(`X read failed: HTTP ${response.status}`);
        const body = json(await response.text());
        if (body.errors !== undefined) throw new ChannelParseError("X returned provider errors");
        const rows = body.data === undefined ? [] : body.data;
        if (!Array.isArray(rows) || rows.length > Math.min(100, maxItems))
          throw new ChannelParseError("invalid X message page");
        const items = rows.map((value) => {
          const row = event(value);
          return { id: row.id as string, raw: JSON.stringify(row) };
        });
        if (items.reduce((sum, item) => sum + Buffer.byteLength(item.raw), 0) > maxBytes)
          throw new RangeError("X page exceeds byte bound");
        const meta = body.meta === undefined ? {} : object(body.meta);
        const next = meta.next_token === undefined ? "" : pageToken(meta.next_token);
        if (next && next === page) throw new ChannelParseError("repeated X page token");
        return { items, next: JSON.stringify({ account: ref.id, page: next }) };
      },
      parse(item) {
        const row = event(json(item.raw));
        if (item.id !== row.id) throw new ChannelParseError("X message id mismatch");
        return {
          channel: "x",
          sender: { handle: row.sender_id as string },
          textBody: (row.text as string).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (char) =>
            char === "\n" || char === "\r" || char === "\t" ? char : "",
          ),
          messageId: row.id as string,
          threadId: row.dm_conversation_id as string,
          date: new Date(row.created_at as string).toISOString(),
          signals: {},
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
