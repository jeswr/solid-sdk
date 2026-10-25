// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The CHANNEL-SENDER seam — the ONLY place send-scope tokens live (§7). The outbox executor
 * holds a map of per-channel senders; each sender is a deterministic function that transmits
 * a fully-assembled {@link OutboundMessage} (human prose + the §5.2 machine-readable carrier)
 * and returns a receipt. Send tokens (e.g. `gmail.send`) are captured in the sender closure —
 * NEVER in any LLM context, never in the pod, never in a proposal. M1 ships the seam + a
 * hermetic {@link RecordingSender} test double; a live SMTP/Gmail/Slack sender is a follow-up.
 */
/**
 * A hermetic recording sender for tests + dry-runs. It transmits NOTHING — it records the
 * messages it was asked to send on {@link sent} and returns a deterministic receipt.
 */
export class RecordingSender {
    clock;
    /** Messages captured, in order. */
    sent = [];
    counter = 0;
    constructor(clock = () => new Date()) {
        this.clock = clock;
    }
    /** The {@link ChannelSender} bound to this recorder. */
    send = async (message) => {
        this.sent.push(message);
        this.counter += 1;
        return { channelMessageId: `recorded-${this.counter}`, sentAt: this.clock().toISOString() };
    };
}
//# sourceMappingURL=sender.js.map