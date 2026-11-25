// AUTHORED-BY Claude Opus 5.5
/** Owner-side mandate reductions: each result grants no more than its source. */
import { solidOdrlEngine } from "./policy.js";
import type { Mandate, Rule } from "./types.js";

/** Fresh record identity, retaining expiry, every ban, limit and policy condition. */
export function reissueMandate(m: Mandate, id: string, now = new Date()): Mandate {
  return {
    ...m,
    id,
    // Never move validFrom earlier: a reissued record can't authorise past actions.
    validFrom: new Date(Math.max(Date.parse(m.validFrom), now.getTime())).toISOString(),
    autonomous: { ...m.autonomous, id: `${id}/autonomous` },
    withApproval: { ...m.withApproval, id: `${id}/with-approval` },
  };
}

export interface RemovePermissionOptions {
  /** Action IRIs the caller can describe; any other rule must be edited in full instead. */
  readonly knownActions: readonly string[];
  readonly now?: Date;
}

/**
 * Turn one permission off. An automatic rule becomes ask-first; an ask-first rule becomes a
 * ban at the same scope, because removing it alone would leave the action asking first
 * (unmatched actions are confirm-required). Automatic rules for the same action are demoted
 * or dropped so they can't defeat the reduction. Every other rule, ban and limit is kept.
 */
export async function removePermission(
  m: Mandate,
  set: "autonomous" | "withApproval",
  index: number,
  id: string,
  { knownActions, now = new Date() }: RemovePermissionOptions,
): Promise<Mandate> {
  const rules = m[set].permissions ?? [];
  if (!Number.isInteger(index) || !rules[index]) throw new Error("This permission has changed.");
  const selected = rules[index];
  const automatic = m.autonomous.permissions ?? [];
  const overlapping = automatic.filter((rule) => rule.action === selected.action);
  // Removing an unsupported rule can erase an indeterminate result and unblock unrelated actions.
  // Ask the shared engine about an unrelated action to detect that global blocker first.
  for (const rule of [selected, ...overlapping]) {
    if (
      !knownActions.includes(rule.action) ||
      (
        await solidOdrlEngine.evaluate(
          { id: "urn:permission-removal-check", permissions: [rule] },
          {
            agent: m.subject,
            action: "urn:permission-removal-check:unrelated",
            target: m.subject,
            at: now.toISOString(),
          },
        )
      ).effect !== "not-applicable"
    )
      throw new Error("Edit this rule in agent permissions first.");
  }
  const next = reissueMandate(m, id, now);
  const remaining = rules.filter((_, i) => i !== index);
  const { id: _ruleId, ...scope } = selected;
  const ban: Rule = { ...scope, type: "prohibition" };
  return {
    ...next,
    autonomous: {
      ...next.autonomous,
      permissions: automatic.filter((rule) => rule.action !== selected.action),
    },
    withApproval: {
      ...next.withApproval,
      permissions: [
        ...(set === "withApproval" ? remaining : (m.withApproval.permissions ?? [])),
        ...(set === "autonomous" ? overlapping : []),
      ],
    },
    prohibitions: set === "withApproval" ? [...m.prohibitions, ban] : m.prohibitions,
  };
}
