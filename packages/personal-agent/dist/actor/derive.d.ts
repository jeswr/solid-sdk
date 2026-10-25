import type { ActionProposal } from "../pod/proposals.js";
import { type InboundContext, type ReadInterpretation } from "./interpretations.js";
/** Context for {@link deriveProposals}. */
export interface DeriveContext {
    /** The inbound message context (sender + raw anchor). */
    readonly inbound: InboundContext;
    /** A stable, url-slug-safe id base (the inbox resource slug) → deterministic proposal ids. */
    readonly idPrefix: string;
    /** "Now" (proposal creation time). */
    readonly now: Date;
    /** The minimum confidence a deterministic signal must carry (default 0.9). */
    readonly minConfidence?: number;
}
/**
 * Derive deterministic proposals from landed interpretations. Returns `[]` when there is no
 * deterministic, high-confidence, actionable signal (or no sender to reply to).
 */
export declare function deriveProposals(interps: readonly ReadInterpretation[], context: DeriveContext): ActionProposal[];
//# sourceMappingURL=derive.d.ts.map