// AUTHORED-BY Codex GPT-6.1-Sol
import type { BridgeMessage } from "./message.js";

/** A MIME part (for `multipart/alternative`). */
export interface MimePart {
  readonly contentType: string;
  readonly body: string;
}

/** The assembled reply carrier. */
export interface BuiltReply {
  /** The JSON-LD credential (with a `proof` iff a signer was supplied). */
  readonly credential: Record<string, unknown>;
  /** True iff the credential carries a Data Integrity proof. */
  readonly signed: boolean;
  /** An HTML-safe `<script type="application/ld+json">…</script>` block for the body. */
  readonly inlineHtml: string;
  /** The `application/ld+json` fallback part for `multipart/alternative`. */
  readonly mimePart: MimePart;
  /** Reply headers (`X-Agentic-Reply` → the pod copy) — safe, single-line values only. */
  readonly headers: Readonly<Record<string, string>>;
  /**
   * The complete plain-text legacy-channel body: the answer, where available,
   * followed by the single upgrade recommendation. Absent only when neither was
   * supplied. Channel senders must use this as plain text, never as markup.
   */
  readonly humanText?: string;
  /** A plain-text onboarding block for the human body, when an onboarding URL was given. */
  readonly onboardingBlock?: string;
}

/** One raw inbound message pulled from a channel. */
export interface InboundRawMessage<Raw = unknown> {
  /**
   * A channel-scoped, STABLE id for this message (e.g. an email Message-ID, a Slack
   * ts). Folded (base64url) into the in-pod resource slug, so it must be stable
   * across re-pulls for idempotent re-sync. Untrusted — never used unescaped.
   */
  readonly id: string;
  /** The raw message bytes/text (verbatim — the byte-exact provenance anchor). */
  readonly raw: string | Uint8Array;
  /** Optional native provider record; untrusted. */
  readonly native?: Raw;
}

/** Where to send a structured reply. */
export interface ReplyTarget {
  /** The recipient handle in the channel's namespace (e.g. an email address). */
  readonly to: string;
  /** The inbound message id this reply answers, when applicable. */
  readonly inReplyToId?: string;
}

/**
 * A channel adapter: pull inbound messages, parse each into the channel-neutral
 * {@link BridgeMessage}, optionally send structured replies.
 */
export interface ChannelAdapter {
  /** The channel name (e.g. `"email"`) — written as `agentic:channel`. */
  readonly channel: string;
  /** Pull the batch of inbound messages to import. */
  pullInbound(): Promise<readonly InboundRawMessage[]>;
  /**
   * Parse one raw inbound message into the channel-neutral {@link BridgeMessage}
   * (M2-DESIGN.md §M2.0). MUST be a pure, hostile-input-hardened transform;
   * throws (a subclass of) `ChannelParseError` for a refused input, which
   * `importInbound` treats as skip-this-message.
   */
  parse(item: InboundRawMessage): BridgeMessage;
  /** Send a structured reply (optional — a read-only adapter omits it). */
  sendReply?(target: ReplyTarget, reply: BuiltReply): Promise<void>;
}

export class InMemoryChannelAdapter implements ChannelAdapter {
  readonly channel: string;
  /** Replies captured by {@link sendReply}, in order. */
  readonly sent: Array<{ target: ReplyTarget; reply: BuiltReply }> = [];
  private readonly messages: readonly InboundRawMessage[];
  private readonly parseFn: (item: InboundRawMessage) => BridgeMessage;

  constructor(
    channel: string,
    messages: readonly InboundRawMessage[],
    parse: (item: InboundRawMessage) => BridgeMessage,
  ) {
    this.channel = channel;
    this.messages = messages;
    this.parseFn = parse;
  }

  parse(item: InboundRawMessage): BridgeMessage {
    return this.parseFn(item);
  }

  pullInbound(): Promise<readonly InboundRawMessage[]> {
    return Promise.resolve(this.messages);
  }

  sendReply(target: ReplyTarget, reply: BuiltReply): Promise<void> {
    this.sent.push({ target, reply });
    return Promise.resolve();
  }
}
