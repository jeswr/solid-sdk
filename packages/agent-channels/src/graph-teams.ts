// AUTHORED-BY Codex GPT-6.1-Sol
import { digestBytes } from "@jeswr/agent-model";
import type { ChannelBinding } from "./binding.js";
import type { InboundRawMessage } from "./channel.js";
import { accountId } from "./direct/shared.js";
import { ChannelParseError } from "./errors.js";
import { record } from "./graph-mail/rest.js";
import { envelopes } from "./graph-teams/card.js";
import {
  BASE,
  collection,
  type GraphTeamsTiming,
  graphTeamsOrigins,
  graphTeamsRest,
  id,
  json,
  nextLink,
  responseJson,
} from "./graph-teams/rest.js";
import { htmlToText } from "./html.js";
import type { OriginFetchOptions } from "./origins.js";
import { TEAMS_CARD } from "./profiles.js";
import type { TokenProvider } from "./types.js";

export const ORIGINS: ReadonlySet<string> = graphTeamsOrigins();
export interface GraphTeamsReaderOptions extends GraphTeamsTiming {
  readonly tokens: TokenProvider;
  readonly transport?: OriginFetchOptions;
}
interface State {
  account: string;
  jobs: string[];
  pending: InboundRawMessage[];
  pages: number;
}
const initial = (account: string): State => ({
  account,
  jobs: [`${BASE}/me/chats`, `${BASE}/me/joinedTeams`],
  pending: [],
  pages: 0,
});
function saved(cursor: string, account: string): State {
  const value = json(cursor, true);
  if (
    Object.keys(value).sort().join() !== "account,jobs,pages,pending" ||
    value.account !== account ||
    !Array.isArray(value.jobs) ||
    value.jobs.length > 512 ||
    !Array.isArray(value.pending) ||
    value.pending.length > 512 ||
    !Number.isSafeInteger(value.pages) ||
    (value.pages as number) < 0 ||
    (value.pages as number) > 512
  )
    throw new ChannelParseError("invalid Teams account cursor");
  value.jobs.forEach(collection);
  for (const item of value.pending) {
    const row = record(item);
    if (typeof row.id !== "string" || typeof row.raw !== "string")
      throw new ChannelParseError("invalid Teams pending item");
    parse({ id: row.id, raw: row.raw });
  }
  return value as unknown as State;
}
function conversation(path: string): string {
  const url = collection(`${BASE}${path}`);
  const chat = /^\/v1\.0\/me\/chats\/([^/]+)\/messages$/.exec(url.pathname);
  const channel = /^\/v1\.0\/teams\/([^/]+)\/channels\/([^/]+)\/messages$/.exec(url.pathname);
  if (chat) return `teams:chat:${chat[1]}`;
  if (channel) return `teams:channel:${channel[1]}:${channel[2]}`;
  throw new ChannelParseError("invalid Teams conversation");
}
function plainText(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (c) => (c === "\n" || c === "\t" ? c : ""));
}
function parse(item: InboundRawMessage) {
  try {
    const wrapper = json(item.raw);
    if (typeof wrapper.path !== "string") throw new Error();
    const key = conversation(wrapper.path);
    const row = record(wrapper.message);
    const messageId = `${key}:${encodeURIComponent(id(row.id))}`;
    if (item.id !== messageId || row.messageType !== "message" || row.deletedDateTime != null)
      throw new Error();
    const body = record(row.body);
    const contentType = typeof body.contentType === "string" ? body.contentType.toLowerCase() : "";
    if (!["html", "text"].includes(contentType) || typeof body.content !== "string")
      throw new Error();
    const textBody = contentType === "html" ? htmlToText(body.content) : plainText(body.content);
    const user = record(record(row.from).user);
    const handle = id(user.id);
    if (
      typeof row.createdDateTime !== "string" ||
      !Number.isFinite(Date.parse(row.createdDateTime))
    )
      throw new Error();
    const reply = row.replyToId == null ? undefined : id(row.replyToId);
    const blocks = envelopes(row.attachments);
    return {
      channel: "teams",
      sender: {
        handle,
        ...(typeof user.displayName === "string"
          ? { displayName: plainText(user.displayName) }
          : {}),
      },
      textBody,
      date: new Date(row.createdDateTime).toISOString(),
      messageId,
      threadId: reply
        ? `${key}:${encodeURIComponent(reply)}`
        : key.startsWith("teams:channel:")
          ? messageId
          : key,
      signals: Object.freeze({ "teams-conversation": key }),
      rawSha256: digestBytes(item.raw).slice("sha-256:".length),
      rawByteLength: Buffer.byteLength(item.raw),
      rawMediaType: "application/json",
      warnings: ["identity-unverified", ...(blocks.length ? ["signature-unverified"] : [])],
      ...(blocks.length ? { jsonLdBlocks: blocks } : {}),
    };
  } catch {
    throw new ChannelParseError("invalid Teams inbound message");
  }
}
/** Read-only, bounded Graph traversal. Completed polls repeat stable IDs for deduplication. */
export function createGraphTeamsReader(options: GraphTeamsReaderOptions): ChannelBinding {
  const tokens = options.tokens;
  const rest = graphTeamsRest(options.transport, options);
  let channelsUnavailable = false;
  return {
    id: "graph-teams",
    carriage: TEAMS_CARD,
    origins: graphTeamsOrigins(),
    describe(state) {
      return {
        type: "channel-capability",
        id: "urn:agent:binding:graph-teams",
        channel: "teams",
        binding: "graph-teams",
        carriage: TEAMS_CARD.id,
        description: `Chats: read/send. Channels: ${channelsUnavailable ? "unavailable (HTTP 403; tenant consent required)" : "read; tenant consent may be required"}. Channel sending is unsupported.`,
        structuredPayload: true,
        endToEndEncrypted: false,
        deliveryReceipts: false,
        historyWindow: "PT0S",
        maxMessageBytes: TEAMS_CARD.maxBytes,
        sendSupported: true,
        costPerMessage: 0,
        rateLimit: { perRecipient: 0, perDay: 0 },
        credentialState: state,
      };
    },
    ingest: {
      async list(account, cursor, { maxItems, maxBytes }) {
        const ref = Object.freeze({ id: accountId(account) });
        if (
          !Number.isSafeInteger(maxItems) ||
          maxItems <= 0 ||
          !Number.isSafeInteger(maxBytes) ||
          maxBytes <= 0
        )
          throw new RangeError("list bounds must be positive safe integers");
        let state = cursor === undefined ? initial(ref.id) : saved(cursor, ref.id);
        if (!state.jobs.length && !state.pending.length) state = initial(ref.id);
        const items: InboundRawMessage[] = [];
        let bytes = 0;
        let requests = 0;
        while (items.length < maxItems) {
          const pending = state.pending[0];
          if (pending) {
            const size = Buffer.byteLength(pending.raw);
            if (bytes + size > maxBytes) {
              if (!items.length) throw new RangeError("next item exceeds byte bound");
              break;
            }
            items.push(pending);
            bytes += size;
            state.pending.shift();
            continue;
          }
          if (!state.jobs.length || requests >= 32) break;
          if (state.pages >= 512) throw new ChannelParseError("Teams scan exceeds page bound");
          const url = collection(state.jobs.shift());
          requests++;
          state.pages++;
          const response = await rest(url.href, ref, tokens, "read");
          if (response.status === 403 && !url.pathname.startsWith("/v1.0/me/chats")) {
            channelsUnavailable = true;
            continue;
          }
          if (!response.ok) throw new Error(`Graph Teams read failed: HTTP ${response.status}`);
          const page = await responseJson(response);
          if (!Array.isArray(page.value) || page.value.length > 512)
            throw new ChannelParseError("invalid Teams page");
          const next = page["@odata.nextLink"];
          if (next !== undefined) state.jobs.unshift(nextLink(next, url));
          const children: string[] = [];
          for (const value of page.value) {
            const row = record(value);
            if (url.pathname.endsWith("/messages")) {
              if (row.messageType !== "message" || row.deletedDateTime != null) continue;
              const path = url.pathname.slice("/v1.0".length);
              // A malformed or oversized individual message is skippable.
              try {
                const key = encodeURIComponent(id(row.id));
                const item = {
                  id: `${conversation(path)}:${key}`,
                  raw: JSON.stringify({ path, message: row }),
                };
                parse(item);
                state.pending.push(item);
              } catch {}
            } else {
              const key = encodeURIComponent(id(row.id));
              const path =
                url.pathname === "/v1.0/me/chats"
                  ? `${url.pathname}/${key}/messages`
                  : url.pathname === "/v1.0/me/joinedTeams"
                    ? `/v1.0/teams/${key}/channels`
                    : `${url.pathname}/${key}/messages`;
              children.push(`https://graph.microsoft.com${path}`);
            }
          }
          state.jobs.unshift(...new Set(children));
          if (state.jobs.length > 512)
            throw new ChannelParseError("Teams scan exceeds collection bound");
          json(JSON.stringify(state), true);
        }
        return { items, next: JSON.stringify(state) };
      },
      parse,
      threadKey(message) {
        return message.threadId;
      },
    },
  };
}
