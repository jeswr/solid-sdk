// AUTHORED-BY Codex GPT-6.1-Sol
import { DEFAULT_LIMITS, parseBoundedJson } from "@jeswr/agent-model";
import type { ChannelBinding } from "./binding.js";
import type { InboundRawMessage } from "./channel.js";
import { accountId } from "./direct/shared.js";
import { assertEmailAddress, assertFooter, type EmailConfig, inspectEmail } from "./email-mime.js";
import { ChannelParseError } from "./errors.js";
import {
  gmailOrigins,
  gmailRest,
  historyId,
  messageId,
  opaque,
  rawMessage,
  record,
  responseBody,
} from "./gmail/rest.js";
import type { OriginFetchOptions } from "./origins.js";
import { EMAIL_MIME } from "./profiles.js";
import type { TokenProvider } from "./types.js";

export const ORIGINS: ReadonlySet<string> = gmailOrigins();
export interface GmailReaderOptions extends EmailConfig {
  readonly tokens: TokenProvider;
  readonly transport?: OriginFetchOptions;
}
interface State {
  account: string;
  mode: "list" | "history";
  start: string;
  page: string;
  pending: string[];
  resume: string;
  latest: string;
}
function cursorState(cursor: string, account: string): State {
  const value = record(
    parseBoundedJson(cursor, { ...DEFAULT_LIMITS, maxEnvelopeBytes: 64 * 1024 }),
  );
  if (
    Object.keys(value).sort().join() !== "account,latest,mode,page,pending,resume,start" ||
    value.account !== account ||
    !["list", "history"].includes(value.mode as string) ||
    !Array.isArray(value.pending) ||
    value.pending.length > 512
  )
    throw new ChannelParseError("invalid account cursor");
  for (const key of ["page", "resume"] as const) if (value[key] !== "") opaque(value[key]);
  historyId(value.start);
  historyId(value.latest);
  value.pending.forEach(messageId);
  return value as unknown as State;
}
/** Read-only binding. Wire bytes are parsed by the injected legacy-bridge parser. */
export function createGmailReader(options: GmailReaderOptions): ChannelBinding {
  const tokens = options.tokens;
  const config: EmailConfig = {
    parseEmail: options.parseEmail,
    recipient: options.recipient,
    ownAccounts: new Set([...options.ownAccounts]),
    footer: options.footer,
  };
  assertEmailAddress(config.recipient);
  assertFooter(config.footer);
  const rest = gmailRest(options.transport);
  return {
    id: "gmail",
    carriage: EMAIL_MIME,
    origins: gmailOrigins(),
    describe(state) {
      return {
        type: "channel-capability",
        id: "urn:agent:binding:gmail",
        channel: "email",
        binding: "gmail",
        carriage: EMAIL_MIME.id,
        structuredPayload: true,
        endToEndEncrypted: false,
        deliveryReceipts: false,
        historyWindow: "P30D",
        maxMessageBytes: EMAIL_MIME.maxBytes,
        sendSupported: true,
        costPerMessage: 0,
        rateLimit: { perRecipient: 0, perDay: 0 },
        credentialState: state,
      };
    },
    ingest: {
      async list(account, cursor, limits) {
        const ref = Object.freeze({ id: accountId(account) });
        const { maxItems, maxBytes } = limits;
        if (
          !Number.isSafeInteger(maxItems) ||
          maxItems <= 0 ||
          !Number.isSafeInteger(maxBytes) ||
          maxBytes <= 0
        )
          throw new RangeError("list bounds must be positive safe integers");
        async function initial(): Promise<State> {
          // Capture the baseline BEFORE a full listing, so concurrent arrivals are replayed.
          const profile = await responseBody(await rest("/profile", ref, tokens, "read"));
          const start = historyId(profile.historyId);
          return {
            account: ref.id,
            mode: "list",
            start,
            page: "",
            pending: [],
            resume: "",
            latest: start,
          };
        }
        let state = cursor === undefined ? await initial() : cursorState(cursor, ref.id);
        if (!state.pending.length) {
          const params = new URLSearchParams({ maxResults: String(Math.min(100, maxItems)) });
          if (state.page) params.set("pageToken", state.page);
          if (state.mode === "history") {
            params.set("startHistoryId", state.start);
            params.set("historyTypes", "messageAdded");
          }
          let response = await rest(
            `/${state.mode === "list" ? "messages" : "history"}?${params}`,
            ref,
            tokens,
            "read",
          );
          if (state.mode === "history" && response.status === 404) {
            state = await initial();
            response = await rest(
              `/messages?maxResults=${Math.min(100, maxItems)}`,
              ref,
              tokens,
              "read",
            );
          }
          const body = await responseBody(response);
          const ids: string[] = [];
          const rows = state.mode === "list" ? body.messages : body.history;
          if (rows !== undefined && !Array.isArray(rows))
            throw new ChannelParseError("invalid Gmail message list");
          for (const row of (rows ?? []) as unknown[]) {
            if (state.mode === "list") ids.push(messageId(record(row).id));
            else {
              const entry = record(row);
              historyId(entry.id);
              const added = entry.messagesAdded;
              if (added !== undefined && !Array.isArray(added))
                throw new ChannelParseError("invalid Gmail history entry");
              for (const item of (added ?? []) as unknown[])
                ids.push(messageId(record(record(item).message).id));
            }
          }
          state.pending = [...new Set(ids)];
          if (state.pending.length > 512)
            throw new ChannelParseError("Gmail page exceeds item cap");
          state.resume = body.nextPageToken === undefined ? "" : opaque(body.nextPageToken);
          if (state.resume && state.resume === state.page)
            throw new ChannelParseError("repeated Gmail page token");
          if (state.mode === "history") state.latest = historyId(body.historyId);
        }
        const items: InboundRawMessage[] = [];
        let bytes = 0;
        while (state.pending.length && items.length < maxItems) {
          const id = state.pending[0] as string;
          const response = await rest(`/messages/${id}?format=raw`, ref, tokens, "read");
          if (response.status === 404) {
            state.pending.shift();
            continue;
          }
          const body = await responseBody(response);
          const raw = rawMessage(body, id);
          if (bytes + raw.raw.byteLength > maxBytes) {
            if (!items.length) throw new RangeError("next item exceeds byte bound");
            break;
          }
          bytes += raw.raw.byteLength;
          items.push({ id, raw: raw.raw, native: body });
          state.pending.shift();
        }
        if (!state.pending.length) {
          if (state.resume) {
            state.page = state.resume;
            state.resume = "";
          } else {
            state = {
              ...state,
              mode: "history",
              start: state.mode === "list" ? state.start : state.latest,
              page: "",
            };
          }
        }
        return { items, next: JSON.stringify(state) };
      },
      parse(item) {
        return inspectEmail(item.raw, config).message;
      },
      threadKey(message) {
        return message.threadId;
      },
    },
  };
}
