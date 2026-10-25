// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
// AUTHORED-BY Codex GPT-6
/**
 * The ODRL evaluation the outbox executor runs against the owner's signed mandate for
 * EVERY outbound intent (the enforcement point, §5/§7). All policy logic is delegated to
 * `@jeswr/solid-odrl`'s pure `evaluate()` — we NEVER hand-roll policy matching. This
 * module only (a) projects an {@link ActionProposal} into an ODRL {@link RequestContext}
 * and (b) maps the library's `permit`/`deny`/`notApplicable` verdict onto the executor's
 * fail-closed {@link AutonomyDecision} (deny-by-default → confirm-required).
 */

import type { OdrlPolicy } from "@jeswr/solid-odrl";
import { evaluate, type RequestContext } from "@jeswr/solid-odrl";
import type { ActionProposal } from "../pod/proposals.js";
import type { AutonomyEvaluation } from "./types.js";

/** Options for {@link evaluateAutonomy}. */
export interface EvaluateAutonomyOptions {
  /** The agent's WebID (matched against the mandate's `assignee`). */
  readonly agentWebId?: string;
  /** "Now" for `dateTime` constraints (injectable → deterministic tests). */
  readonly now?: Date;
}

/**
 * Project an outbound proposal into an ODRL request context. The `purpose`, `recipient`,
 * and `count` (spend) attributes are the constrainable left-operands the mandate refines;
 * the `target` is the message the action derives from (its raw-anchor), when a reply.
 */
export function buildRequestContext(proposal: ActionProposal, agentWebId?: string): RequestContext {
  const attributes: Record<string, string | number> = {
    // `count` is the ODRL left-operand for the declared spend (default 0).
    count: proposal.spend ?? 0,
    recipient: proposal.recipient,
  };
  if (proposal.purpose) attributes.purpose = proposal.purpose;
  const target = proposal.inReplyTo ?? proposal.derivedFrom;
  return {
    ...(agentWebId ? { agent: agentWebId } : {}),
    // This executor only transmits messages, including scheduling replies. The concrete
    // operation is always ODRL distribute; an Actor-supplied label cannot change it.
    action: "distribute",
    ...(target ? { target } : {}),
    attributes,
  };
}

/**
 * Evaluate one outbound intent against the mandate policy, fail-closed:
 *  - a matching PERMIT with no outstanding duty → `permit` (autonomous);
 *  - a matching permit whose duties the request can't show fulfilled → `confirm-required`;
 *  - an explicit PROHIBITION → `prohibited` (never, even if confirmed);
 *  - anything else (no matching rule / deny-by-default) → `confirm-required`.
 */
export function evaluateAutonomy(
  policy: OdrlPolicy,
  proposal: ActionProposal,
  options: EvaluateAutonomyOptions = {},
): AutonomyEvaluation {
  const context = buildRequestContext(proposal, options.agentWebId);
  if (proposal.odrlAction !== context.action) {
    return {
      decision: "prohibited",
      reason: `proposal action mismatch: labelled ${proposal.odrlAction}; executor requires ${context.action} (send)`,
      outstandingDuties: [],
    };
  }
  const result = evaluate(policy, context, {
    requireDuties: false,
    ...(options.now ? { now: options.now } : {}),
  });

  if (result.decision === "permit") {
    const outstanding = result.duties.filter((duty) => !duty.fulfilled);
    if (outstanding.length === 0) {
      return {
        decision: "permit",
        reason: result.reason,
        ...(result.matchedPermissions[0] ? { permit: result.matchedPermissions[0] } : {}),
        outstandingDuties: [],
      };
    }
    return {
      decision: "confirm-required",
      reason: `permit contingent on unfulfilled duty (${outstanding
        .map((duty) => duty.action)
        .join(", ")})`,
      outstandingDuties: outstanding,
    };
  }

  if (result.decision === "deny" && result.matchedProhibitions.length > 0) {
    return { decision: "prohibited", reason: result.reason, outstandingDuties: [] };
  }

  // notApplicable, or a deny with no explicit prohibition → deny-by-default.
  return { decision: "confirm-required", reason: result.reason, outstandingDuties: [] };
}
