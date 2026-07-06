import { type OdrlActionName } from "@jeswr/solid-odrl";
import type { DatasetCore } from "@rdfjs/types";
/** The proposal lifecycle. A proposal is NEVER sent until it reaches `confirmed`. */
export type ProposalStatus = "pending" | "confirmed" | "executed" | "failed" | "rejected";
/** Graduated-confirmation friction (§7). */
export type ConfirmFriction = "low" | "high";
/** A single proposed meeting time (a `schema:Event`). */
export interface OfferedTime {
    /** Start — a valid ISO-8601 datetime (canonicalised to UTC; invalid → dropped). */
    readonly startTime: string;
    /** End — an optional ISO-8601 datetime. */
    readonly endTime?: string;
    /** Event name (control-stripped, capped). */
    readonly name?: string;
}
/** An outbound action the Actor proposes and the outbox executor may execute. */
export interface ActionProposal {
    /** A stable, url-slug-safe proposal id (keys the in-pod resource). */
    readonly id: string;
    /** The send channel (`"email"`, `"slack"`, …). */
    readonly channel: string;
    /** The recipient handle in the channel namespace (an email addr-spec for email). */
    readonly recipient: string;
    /**
     * The ODRL action short-name this outbound intent performs (e.g. `"distribute"`).
     * The outbox executor evaluates it against the owner's signed ODRL mandate — this
     * is the machine-checkable statement of WHAT the agent is about to do. Fail-closed:
     * a proposal whose `odrlAction` is not a valid ODRL action never parses.
     */
    readonly odrlAction: OdrlActionName;
    /** The DPV/agentic purpose IRI the action is performed for (the `purpose` constraint input). */
    readonly purpose?: string;
    /** The declared spend for the action (the `count` constraint input; default 0). */
    readonly spend?: number;
    /** The lifecycle status. */
    readonly status: ProposalStatus;
    /** The confirmation friction (drives how strong the human confirm must be). */
    readonly friction: ConfirmFriction;
    /** The human prose body to send. */
    readonly bodyText: string;
    /** Optional subject line. */
    readonly subject?: string;
    /** The raw-message anchor (`urn:agentic:raw:…`) this answers, when a reply. */
    readonly inReplyTo?: string;
    /** What this proposal was derived from (`prov:wasDerivedFrom`) — an http(s)/urn IRI. */
    readonly derivedFrom?: string;
    /** Proposed meeting times (each carried into the §5.2 reply as a `schema:Event`). */
    readonly offeredTimes?: readonly OfferedTime[];
    /** When the proposal was created (ISO-8601). */
    readonly proposedAt: string;
    /** When the proposal was confirmed (ISO-8601), once confirmed. */
    readonly confirmedAt?: string;
    /** When the proposal was executed (ISO-8601), once executed. */
    readonly executedAt?: string;
    /** A control-stripped human note (e.g. a send-failure reason). */
    readonly note?: string;
}
/** Fold a proposal id into a url-safe resource slug (rejecting an unsafe id). */
export declare function proposalSlug(id: unknown): string | undefined;
/** The in-pod resource URL for a proposal id within a container. */
export declare function proposalUrl(container: string, id: string): string | undefined;
/** Options for {@link serializeProposal}. */
export interface SerializeProposalOptions {
    /** The absolute URL of the resource this proposal is written to (its `#it` subject base). */
    readonly resourceUrl: string;
}
/**
 * Serialise an {@link ActionProposal} to Turtle. Throws (fail-closed) if a load-bearing
 * field (channel / recipient / body) is missing or unsafe — a proposal that cannot be
 * represented safely is never written.
 */
export declare function serializeProposal(proposal: ActionProposal, options: SerializeProposalOptions): Promise<string>;
/**
 * Parse the single {@link ActionProposal} out of a store, or `undefined` if the store
 * carries no well-formed proposal. Fail-closed: an unknown status IRI reads as
 * `pending` (never `confirmed`), so a tampered status can never make the executor send.
 */
export declare function parseProposal(store: DatasetCore): ActionProposal | undefined;
//# sourceMappingURL=proposals.d.ts.map