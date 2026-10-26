// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The CHANNEL-SENDER seam — the ONLY place send-scope tokens live (§7). The outbox executor
 * holds a map of per-channel senders; each sender is a deterministic function that transmits
 * a fully-assembled {@link OutboundMessage} (human prose + the §5.2 machine-readable carrier)
 * and returns a receipt. Send tokens (e.g. `gmail.send`) are captured in the sender closure —
 * NEVER in any LLM context, never in the pod, never in a proposal. M1 ships the seam + a
 * hermetic {@link RecordingSender} test double; a live SMTP/Gmail/Slack sender is a follow-up.
 */

/** A single MIME part (mirrors the bridge's `MimePart`). */
export interface MimePart {
  readonly contentType: string;
  readonly body: string;
}

/** A fully-assembled outbound message, ready to transmit. */
export interface OutboundMessage {
  /** The channel to send on (`"email"`, …). */
  readonly channel: string;
  /** The recipient handle in the channel namespace. */
  readonly to: string;
  /** The subject line, when the channel has one. */
  readonly subject?: string;
  /** The human-readable plain-text body (prose + optional onboarding block). */
  readonly textBody: string;
  /** The HTML body carrying the inline JSON-LD structured metadata. */
  readonly htmlBody?: string;
  /** Carrier headers (`X-Agentic-Reply` → the pod copy), safe single-line values. */
  readonly headers: Readonly<Record<string, string>>;
  /** The `multipart/alternative` parts (text, html, and the `application/ld+json` carrier). */
  readonly mimeParts: readonly MimePart[];
  /** The inbound message id this reply answers, when applicable. */
  readonly inReplyToId?: string;
}

/** The outcome of a transmit. */
export interface SendReceipt {
  /** The channel's id for the transmitted message, when it returns one. */
  readonly channelMessageId?: string;
  /** When the message was transmitted (ISO-8601). */
  readonly sentAt: string;
}

/** A per-channel sender. Holds the channel's send-scope token in its closure. */
export type ChannelSender = (message: OutboundMessage) => Promise<SendReceipt>;

/**
 * A hermetic recording sender for tests + dry-runs. It transmits NOTHING — it records the
 * messages it was asked to send on {@link sent} and returns a deterministic receipt.
 */
export class RecordingSender {
  /** Messages captured, in order. */
  readonly sent: OutboundMessage[] = [];
  private counter = 0;

  constructor(private readonly clock: () => Date = () => new Date()) {}

  /** The {@link ChannelSender} bound to this recorder. */
  readonly send: ChannelSender = async (message) => {
    this.sent.push(message);
    this.counter += 1;
    return { channelMessageId: `recorded-${this.counter}`, sentAt: this.clock().toISOString() };
  };
}
