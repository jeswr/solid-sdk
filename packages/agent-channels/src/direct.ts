// AUTHORED-BY Codex GPT-6.1-Sol
import { digestBytes } from "@jeswr/agent-model";
import type { ChannelBinding } from "./binding.js";
import { accountId, assertGrant, type DirectMailbox, readEnvelope } from "./direct/shared.js";
import { ChannelParseError } from "./errors.js";
import { DIRECT } from "./profiles.js";
import type { TokenProvider } from "./types.js";

/** Direct is strictly local; it has no network origins. */
export const ORIGINS: ReadonlySet<string> = new Set<string>();
/** Create only the Reader half. The send implementation is a separate subpath. */
export function createDirectReader(mailbox: DirectMailbox, tokens: TokenProvider): ChannelBinding {
  return {
    id: "direct",
    carriage: DIRECT,
    origins: new Set(ORIGINS),
    describe(state) {
      return {
        type: "channel-capability",
        id: "urn:agent:binding:direct",
        channel: "direct",
        binding: "direct",
        carriage: DIRECT.id,
        structuredPayload: true,
        endToEndEncrypted: false,
        deliveryReceipts: false,
        historyWindow: "P0D",
        maxMessageBytes: DIRECT.maxBytes,
        sendSupported: true,
        costPerMessage: 0,
        rateLimit: { perRecipient: 0, perDay: 0 },
        credentialState: state,
      };
    },
    ingest: {
      async list(account, cursor, limits) {
        const id = accountId(account);
        const accountRef = Object.freeze({ id });
        const { maxItems, maxBytes } = limits;
        if (
          !Number.isSafeInteger(maxItems) ||
          maxItems <= 0 ||
          !Number.isSafeInteger(maxBytes) ||
          maxBytes <= 0
        )
          throw new RangeError("list bounds must be positive safe integers");
        let offset = 0;
        if (cursor !== undefined) {
          const parsed = JSON.parse(cursor) as { account: string; offset: number };
          if (parsed?.account !== id || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0)
            throw new TypeError("invalid account cursor");
          offset = parsed.offset;
        }
        const messages = mailbox.inboxes.get(id) ?? [];
        if (offset > messages.length) throw new TypeError("cursor exceeds inbox");
        assertGrant(await tokens.read(accountRef), "read");
        const items = [];
        let bytes = 0;
        for (const item of messages.slice(offset, offset + maxItems)) {
          const size = Buffer.byteLength(item.raw);
          if (bytes + size > maxBytes) {
            if (items.length === 0) throw new RangeError("next item exceeds byte bound");
            break;
          }
          bytes += size;
          items.push({ ...item });
        }
        return { items, next: JSON.stringify({ account: id, offset: offset + items.length }) };
      },
      parse(item) {
        const { text } = readEnvelope(item.raw);
        if (typeof item.id !== "string" || !item.id)
          throw new ChannelParseError("missing direct message id");
        return {
          channel: "direct",
          messageId: item.id,
          textBody: "",
          signals: {},
          rawSha256: digestBytes(item.raw).slice("sha-256:".length),
          rawByteLength: Buffer.byteLength(item.raw),
          rawMediaType: "application/ld+json",
          warnings: ["signature-unverified"],
          jsonLdBlocks: [text],
        };
      },
      threadKey(message) {
        return message.threadId;
      },
    },
  };
}
