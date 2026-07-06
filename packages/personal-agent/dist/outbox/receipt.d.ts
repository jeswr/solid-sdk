/** The outcome a receipt records — the unforgeable, Actor-unwritable "already handled" marker. */
export type ReceiptOutcome = "sent" | "rejected" | "failed";
/** The authorizing basis a send was performed under. */
export interface SendReceiptInput {
    /** The receipt resource URL (its `#receipt` subject base). */
    readonly resourceUrl: string;
    /** The executed proposal resource URL. */
    readonly proposalUrl: string;
    /** The outcome (`sent` / `rejected` / `failed`). */
    readonly outcome: ReceiptOutcome;
    /** The send channel. */
    readonly channel: string;
    /** The recipient handle. */
    readonly recipient: string;
    /** When the action happened (ISO-8601). */
    readonly executedAt: string;
    /** A control-stripped human note (e.g. a prohibition reason or a send-failure reason). */
    readonly note?: string;
    /** The acting agent's WebID (`prov:wasAttributedTo`), when known. */
    readonly agentWebId?: string;
    /** The raw-message anchor the action derived from (`prov:wasDerivedFrom`). */
    readonly derivedFrom?: string;
    /** The signed mandate credential IRI that governs the action. */
    readonly mandateId?: string;
    /** The ODRL permit rule IRI that authorized an AUTONOMOUS action (when it had one). */
    readonly permitId?: string;
    /** A human-readable permit label (the ODRL action) when the permit had no IRI. */
    readonly permitLabel?: string;
    /** True when the authorizing basis was an explicit owner confirmation (not autonomous). */
    readonly authorizedByConfirmation?: boolean;
    /** The channel's id for the sent message, when returned. */
    readonly channelMessageId?: string;
}
/** Serialise a send receipt to Turtle. */
export declare function serializeSendReceipt(input: SendReceiptInput): Promise<string>;
//# sourceMappingURL=receipt.d.ts.map