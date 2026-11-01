// AUTHORED-BY Codex GPT-6.1-Sol
import { canonicalJson, parseBoundedJson } from "@jeswr/agent-model";
import type { ChannelBinding } from "./binding.js";
import type { InboundRawMessage } from "./channel.js";
import { accountId } from "./direct/shared.js";
import { ChannelParseError } from "./errors.js";
import { parseRecord, rawId, type Source } from "./mastodon/records.js";
import {
  DEFAULT_INSTANCE,
  id,
  instanceOrigin,
  JSON_LIMITS,
  MAX_RECORD_BYTES,
  mastodonRest,
  record,
  responseJson,
} from "./mastodon/rest.js";
import type { OriginFetchOptions } from "./origins.js";
import { MASTODON_FOOTER } from "./profiles.js";
import type { TokenProvider } from "./types.js";

/** Default instance only; configured bindings expose their own snapshotted origins. */
export const ORIGINS: ReadonlySet<string> = new Set([DEFAULT_INSTANCE]);
/** Register the OAuth app on the configured instance; obtain distinct read/send grants. */
export const MASTODON_SCOPES = Object.freeze({
  read: Object.freeze(["read:notifications", "read:statuses"]),
  send: Object.freeze(["write:statuses"]),
});
export interface MastodonReaderOptions {
  readonly instance?: string;
  readonly tokens: TokenProvider;
  readonly transport?: OriginFetchOptions;
}
const sources = ["notifications", "conversations"] as const;
const start = (source: Source) => `/api/v1/${source}?limit=1`;
interface State {
  account: string;
  instance: string;
  source: number;
  path: string;
}
/** Follow only pagination parameters on this exact endpoint; never trust a remote URL with a grant. */
function pagePath(value: string, origin: string, source: Source): string {
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    throw new ChannelParseError("invalid Mastodon page URL");
  }
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== `/api/v1/${source}`
  )
    throw new ChannelParseError("Mastodon page outside configured endpoint");
  for (const key of url.searchParams.keys()) {
    const values = url.searchParams.getAll(key);
    if (values.length !== 1 || !["limit", "min_id", "max_id", "since_id"].includes(key))
      throw new ChannelParseError("invalid Mastodon page parameters");
    id(values[0]);
  }
  // One provider record at a time avoids buffering or dropping over-budget records.
  url.searchParams.set("limit", "1");
  return `${url.pathname}?${url.searchParams}`;
}
function nextPath(response: Response, origin: string, source: Source): string | undefined {
  const link = response.headers.get("link");
  if (!link) return undefined;
  const next = /<([^>]+)>\s*;\s*rel="next"/.exec(link);
  return next ? pagePath(next[1] as string, origin, source) : undefined;
}
/** Read-only instance binding. Re-pulls use stable IDs; conversation snapshots may repeat. */
export function createMastodonReader(options: MastodonReaderOptions): ChannelBinding {
  const origin = instanceOrigin(options.instance ?? DEFAULT_INSTANCE);
  const tokens = options.tokens;
  const rest = mastodonRest(origin, options.transport);
  return {
    id: "mastodon",
    carriage: MASTODON_FOOTER,
    origins: new Set([origin]),
    describe(state) {
      return {
        type: "channel-capability",
        id: "urn:agent:binding:mastodon",
        channel: "mastodon",
        binding: "mastodon",
        carriage: MASTODON_FOOTER.id,
        structuredPayload: false,
        endToEndEncrypted: false,
        federated: true,
        deliveryReceipts: false,
        historyWindow: "P0D",
        maxMessageBytes: MASTODON_FOOTER.maxBytes,
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
        let state: State = {
          account: ref.id,
          instance: origin,
          source: 0,
          path: start("notifications"),
        };
        if (cursor !== undefined) {
          const saved = record(parseBoundedJson(cursor, JSON_LIMITS));
          if (
            Object.keys(saved).sort().join() !== "account,instance,path,source" ||
            saved.account !== ref.id ||
            saved.instance !== origin ||
            (saved.source !== 0 && saved.source !== 1) ||
            typeof saved.path !== "string"
          )
            throw new ChannelParseError("invalid Mastodon account cursor");
          state = {
            account: ref.id,
            instance: origin,
            source: saved.source,
            path: pagePath(saved.path, origin, sources[saved.source] as Source),
          };
        }
        const items: InboundRawMessage[] = [];
        let bytes = 0;
        for (let pages = 0; pages < 80 && items.length < maxItems; pages++) {
          const source = sources[state.source] as Source;
          const response = await rest(state.path, ref, tokens, "read");
          const rows = await responseJson(response);
          if (!Array.isArray(rows) || rows.length > 1)
            throw new ChannelParseError("invalid Mastodon page");
          const next = nextPath(response, origin, source);
          if (next === state.path)
            throw new ChannelParseError("Mastodon pagination did not advance");
          if (rows.length) {
            const row = record(rows[0]);
            id(row.id);
            // Deleting the latest status can leave a conversation without a last_status.
            if (source === "notifications" || row.last_status != null) {
              const raw = canonicalJson({ source, row });
              const size = Buffer.byteLength(raw);
              if (size > MAX_RECORD_BYTES)
                throw new ChannelParseError("Mastodon record exceeds cap");
              if (bytes + size > maxBytes) {
                if (!items.length) throw new RangeError("next Mastodon record exceeds byte bound");
                break;
              }
              items.push({ id: rawId(origin, source, row), raw });
              bytes += size;
            }
          }
          if (next) state.path = next;
          else if (state.source === 0)
            state = { ...state, source: 1, path: start("conversations") };
          else {
            state = { ...state, source: 0, path: start("notifications") };
            break;
          }
        }
        return { items, next: canonicalJson(state) };
      },
      parse: (item) => parseRecord(origin, item),
      threadKey: (message) => message.threadId,
    },
  };
}
