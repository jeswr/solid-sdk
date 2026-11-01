// AUTHORED-BY Codex GPT-6.1-Sol
import { parseBoundedJson } from "@jeswr/agent-model";
import { SsrfError } from "@jeswr/guarded-fetch";
import type { ChannelBinding } from "./binding.js";
import type { InboundRawMessage } from "./channel.js";
import { accountId } from "./direct/shared.js";
import { assertEmailAddress, assertFooter, type EmailConfig, inspectEmail } from "./email-mime.js";
import { ChannelParseError } from "./errors.js";
import {
  DELTA_INITIAL,
  deltaLink,
  expiredDeltaState,
  graphMailOrigins,
  graphMailRest,
  messageId,
  mimeBody,
  record,
  responseBody,
} from "./graph-mail/rest.js";
import type { OriginFetchOptions } from "./origins.js";
import { AGENT_FOOTER, EMAIL_MIME } from "./profiles.js";
import type { TokenProvider } from "./types.js";

export const ORIGINS: ReadonlySet<string> = graphMailOrigins();
export interface GraphMailReaderOptions extends EmailConfig {
  readonly tokens: TokenProvider;
  readonly transport?: OriginFetchOptions;
}
interface State {
  account: string;
  url: string;
  pending: string[];
  resume: string;
}
function cursorState(cursor: string, account: string): State {
  const value = record(parseBoundedJson(cursor));
  if (
    Object.keys(value).sort().join() !== "account,pending,resume,url" ||
    value.account !== account ||
    !Array.isArray(value.pending) ||
    value.pending.length > 512 ||
    value.pending.length > 0 !== (value.resume !== "")
  )
    throw new ChannelParseError("invalid account cursor");
  if (value.url !== DELTA_INITIAL) deltaLink(value.url, undefined);
  if (value.resume !== "") deltaLink(value.resume, undefined);
  value.pending.forEach(messageId);
  return value as unknown as State;
}
/** Read-only Graph mail binding; credentials and MIME parsing are injected. */
export function createGraphMailReader(options: GraphMailReaderOptions): ChannelBinding {
  const tokens = options.tokens;
  const footer = options.footer ?? AGENT_FOOTER;
  const config: EmailConfig = {
    parseEmail: options.parseEmail,
    recipient: options.recipient,
    ownAccounts: new Set([...options.ownAccounts]),
    footer,
  };
  assertEmailAddress(config.recipient);
  assertFooter(footer);
  const rest = graphMailRest(options.transport);
  const inboxIds = new Map<string, string>();
  return {
    id: "graph-mail",
    carriage: EMAIL_MIME,
    origins: graphMailOrigins(),
    describe(state) {
      return {
        type: "channel-capability",
        id: "urn:agent:binding:graph-mail",
        channel: "email",
        binding: "graph-mail",
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
      async list(account, cursor, { maxItems, maxBytes }) {
        const ref = Object.freeze({ id: accountId(account) });
        if (
          !Number.isSafeInteger(maxItems) ||
          maxItems <= 0 ||
          !Number.isSafeInteger(maxBytes) ||
          maxBytes <= 0
        )
          throw new RangeError("list bounds must be positive safe integers");
        let state: State =
          cursor === undefined
            ? { account: ref.id, url: DELTA_INITIAL, pending: [], resume: "" }
            : cursorState(cursor, ref.id);
        // Resolve the well-known folder independently of any untrusted cursor or page link.
        let inboxId = inboxIds.get(ref.id);
        if (inboxId === undefined) {
          inboxId = messageId(
            (await responseBody(await rest("/mailFolders/inbox?$select=id", ref, tokens, "read")))
              .id,
          );
          inboxIds.set(ref.id, inboxId);
        }
        if (state.url !== DELTA_INITIAL) deltaLink(state.url, inboxId);
        if (state.resume !== "") deltaLink(state.resume, inboxId);
        if (!state.pending.length) {
          let response = await rest(state.url, ref, tokens, "read");
          // Only an explicitly expired sync state starts a new inbox baseline.
          if (state.url !== DELTA_INITIAL && (await expiredDeltaState(response))) {
            state = { account: ref.id, url: DELTA_INITIAL, pending: [], resume: "" };
            response = await rest(state.url, ref, tokens, "read");
          }
          const body = await responseBody(response);
          if (!Array.isArray(body.value) || body.value.length > 512)
            throw new ChannelParseError("invalid Graph delta page");
          const next = body["@odata.nextLink"];
          const delta = body["@odata.deltaLink"];
          if ((next === undefined) === (delta === undefined))
            throw new ChannelParseError("Graph delta page requires one continuation");
          state.resume =
            next === undefined
              ? deltaLink(delta, inboxId, "$deltatoken")
              : deltaLink(next, inboxId, "$skiptoken");
          if (next !== undefined && state.resume === state.url)
            throw new ChannelParseError("repeated Graph delta link");
          const ids: string[] = [];
          for (const item of body.value) {
            const row = record(item);
            const id = messageId(row.id);
            if (row["@removed"] !== undefined) {
              if (record(row["@removed"]).reason !== "deleted")
                throw new ChannelParseError("invalid Graph tombstone");
              continue;
            }
            ids.push(id);
          }
          state.pending = [...new Set(ids)];
          // Refuse a page that could not be saved as a bounded resumable cursor.
          parseBoundedJson(JSON.stringify(state));
        }
        const items: InboundRawMessage[] = [];
        let bytes = 0;
        while (state.pending.length && items.length < maxItems) {
          const id = state.pending[0] as string;
          let raw: Uint8Array;
          try {
            const response = await rest(
              `/messages/${encodeURIComponent(id)}/$value`,
              ref,
              tokens,
              "read",
            );
            if (response.status === 404) {
              state.pending.shift();
              continue;
            }
            raw = await mimeBody(response);
          } catch (error) {
            // Definitive MIME size refusals skip one item; failed reads remain retryable.
            // The transport uses SsrfError for size caps as well as unrelated guard refusals.
            if (
              !(error instanceof ChannelParseError) &&
              !(
                error instanceof SsrfError &&
                /^Response body for .+ exceeds cap \(/.test(error.message)
              )
            )
              throw error;
            state.pending.shift();
            continue;
          }
          if (bytes + raw.byteLength > maxBytes) {
            if (!items.length) throw new RangeError("next item exceeds byte bound");
            break;
          }
          bytes += raw.byteLength;
          items.push({ id, raw });
          state.pending.shift();
        }
        if (!state.pending.length) {
          state.url = state.resume;
          state.resume = "";
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
