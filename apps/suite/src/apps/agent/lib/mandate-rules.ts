// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
import type { Mandate } from "@jeswr/agent-mandate";
import { defaultMandate, limitConstraint } from "@jeswr/agent-mandate/issue";
import { AGENT, evaluateIntent, solidOdrlEngine } from "@jeswr/agent-mandate/verify";
import type { Account, ActionProposal } from "@jeswr/agent-model";
import { z } from "zod";
import { accountBinding } from "./accounts";

export const DAY = 86400000;
export const MEMORY_CATEGORIES = [
  { id: "https://w3id.org/dpv/pd#Preference", label: "Preferences" },
  { id: "https://w3id.org/dpv/pd#Health", label: "Health" },
  { id: "https://w3id.org/dpv/pd#Financial", label: "Finances" },
] as const;
export const memoryScope = (m: Mandate): readonly string[] =>
  m.memoryScope ?? [MEMORY_CATEGORIES[0].id];
export const memoryCategoryLabel = (id: string): string =>
  MEMORY_CATEGORIES.find((category) => category.id === id)?.label ?? "Other saved information";
export const actionNames = {
  SendMessage: "send messages",
  BookAppointment: "book appointments",
  Remember: "remember information",
  Transfer: "move money",
  Sign: "sign documents",
};
export const editorSchema = z
  .object({
    bindings: z.array(z.string()).min(1, "Choose at least one channel"),
    recipients: z.array(z.string()).min(1, "Choose at least one account"),
    SendMessage: z.enum(["ask", "auto"]),
    BookAppointment: z.enum(["ask", "auto"]),
    Remember: z.enum(["ask", "auto"]),
    transfer: z.boolean(),
    sends: z.number().int().min(0).max(10000),
    perRecipient: z.number().int().min(0).max(1000),
    spend: z.number().finite().min(0).max(1000000),
    currency: z.string().regex(/^[A-Z]{3}$/, "Use a three-letter currency"),
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an expiry date"),
    confirm: z.string(),
    memoryScope: z.array(z.enum(MEMORY_CATEGORIES.map((category) => category.id))),
  })
  .superRefine((v, ctx) => {
    const date = Date.parse(`${v.until}T23:59:59.999Z`);
    if (
      !Number.isFinite(date) ||
      new Date(date).toISOString().slice(0, 10) !== v.until ||
      date <= Date.now() ||
      date > Date.now() + 365 * DAY
    )
      ctx.addIssue({
        code: "custom",
        path: ["until"],
        message: "Choose a future date within one year",
      });
    if (
      (v.transfer ||
        (v.spend > 0 && [v.SendMessage, v.BookAppointment, v.Remember].includes("auto"))) &&
      v.confirm !== "CONFIRM"
    )
      ctx.addIssue({ code: "custom", path: ["confirm"], message: "Type CONFIRM to allow this" });
  });
export type EditorValues = z.infer<typeof editorSchema>;
export function editorDefaults(now = new Date()): EditorValues {
  return {
    bindings: [],
    recipients: [],
    SendMessage: "ask",
    BookAppointment: "ask",
    Remember: "ask",
    transfer: false,
    sends: 10,
    perRecipient: 3,
    spend: 0,
    currency: "GBP",
    until: new Date(now.getTime() + 30 * DAY).toISOString().slice(0, 10),
    confirm: "",
    memoryScope: [MEMORY_CATEGORIES[0].id],
  };
}
export function testsTemplate(options: Parameters<typeof defaultMandate>[0]): Mandate {
  return defaultMandate(options);
}
export function replyTemplate(
  options: Parameters<typeof defaultMandate>[0],
  bindings: readonly string[],
): Mandate {
  const m = defaultMandate(options);
  return {
    ...m,
    withApproval: {
      ...m.withApproval,
      permissions: [
        {
          type: "permission",
          action: `${AGENT}SendMessage`,
          constraints: [
            {
              leftOperand: `${AGENT}recipientSet`,
              operator: "isAnyOf",
              rightOperand: [...options.recipientHashes],
            },
            { leftOperand: `${AGENT}binding`, operator: "isAnyOf", rightOperand: [...bindings] },
          ],
        },
      ],
    },
  };
}
export function buildEditorMandate(
  v: EditorValues,
  options: Parameters<typeof defaultMandate>[0],
): Mandate {
  const base = defaultMandate(options);
  const constraints = [
    {
      leftOperand: `${AGENT}recipientSet`,
      operator: "isAnyOf" as const,
      rightOperand: v.recipients,
    },
    { leftOperand: `${AGENT}binding`, operator: "isAnyOf" as const, rightOperand: v.bindings },
  ];
  const rules = Object.keys(actionNames)
    .filter((k) => k in v && k !== "Transfer" && k !== "Sign")
    .map((k) => ({
      type: "permission" as const,
      action: `${AGENT}${k}`,
      constraints: [
        ...constraints,
        ...(k === "BookAppointment"
          ? [
              {
                leftOperand: `${AGENT}costExceeds`,
                operator: "lteq" as const,
                rightOperand: v.spend,
              },
            ]
          : []),
      ],
    }));
  if (v.transfer) rules.push({ type: "permission", action: `${AGENT}Transfer`, constraints });
  return {
    ...base,
    // Signed with the agreement: the executor counts spend limits only in an authenticated currency.
    currency: v.currency,
    memoryScope: v.memoryScope,
    validUntil: new Date(`${v.until}T23:59:59.999Z`).toISOString(),
    autonomous: {
      ...base.autonomous,
      permissions: rules.filter((r) => v[r.action.slice(AGENT.length) as "SendMessage"] === "auto"),
    },
    withApproval: {
      ...base.withApproval,
      permissions: rules.filter((r) => v[r.action.slice(AGENT.length) as "SendMessage"] !== "auto"),
    },
    prohibitions: [
      ...base.prohibitions.filter(
        (r) =>
          !(v.transfer && r.action === `${AGENT}Transfer`) &&
          r.action !== `${AGENT}BookAppointment`,
      ),
      {
        type: "prohibition",
        action: `${AGENT}SendMessage`,
        constraints: [
          { leftOperand: `${AGENT}recipientSet`, operator: "isNoneOf", rightOperand: v.recipients },
        ],
      },
      {
        type: "prohibition",
        action: `${AGENT}BookAppointment`,
        constraints: [
          { leftOperand: `${AGENT}costExceeds`, operator: "gt", rightOperand: v.spend },
        ],
      },
    ],
    limits: [
      limitConstraint(`${AGENT}sendsPerDay`, v.sends, "hard"),
      limitConstraint(`${AGENT}perRecipientPerDay`, v.perRecipient, "hard"),
      limitConstraint(`${AGENT}spendPerDay`, v.spend, "hard"),
    ],
  };
}
/** Signed policy values pass through unchanged; only the evaluator decides authority. */
export async function describeMandate(
  m: Mandate,
  accounts: readonly Account[] = [],
  fallbackCurrency = "GBP",
  now = new Date(),
): Promise<string[]> {
  const currency = m.currency ?? fallbackCurrency;
  const rules: string[] = [];
  const own = accounts.filter((account) => account.channelHandleHash).slice(0, 32);
  const bindings = [...new Set(own.map(accountBinding))];
  if (
    m.prohibitions.some(
      (rule) =>
        rule.action === `${AGENT}BookAppointment` &&
        !rule.target &&
        !rule.assignee &&
        rule.constraints?.length === 1 &&
        rule.constraints.some(
          (constraint) =>
            constraint.leftOperand === `${AGENT}costExceeds` &&
            constraint.operator === "gt" &&
            constraint.rightOperand === 0,
        ),
    ) &&
    (
      await evaluateIntent(m, {
        agent: m.subject,
        action: `${AGENT}BookAppointment`,
        target: m.subject,
        at: now.toISOString(),
        attributes: { [`${AGENT}costExceeds`]: 1 },
      })
    ).decision === "prohibited"
  )
    rules.push("Never: book anything that costs money");
  for (const [action, label] of Object.entries(actionNames)) {
    let confirmed = false;
    for (const binding of bindings) {
      for (const recipient of own) {
        const decision = await evaluateIntent(
          m,
          accountIntent(m, binding, recipient, `${AGENT}${action}`, now),
        );
        const scope = ` for ${recipient.label ?? "another account"} on ${binding}`;
        if (decision.decision === "permit") {
          rules.push(`May ${label} without asking${scope} (at zero cost)`);
          confirmed = true;
        } else if (decision.decision === "prohibited") {
          rules.push(`Never: ${label}${scope} (at zero cost)`);
          confirmed = true;
        } else {
          rules.push(`Asks you first: ${label}${scope}`);
        }
      }
    }
    if (!confirmed && !own.length) rules.push(`Asks you first: ${label}`);
  }
  // Unknown actions and unprobed rule contexts cannot support a permission claim.
  const allRules = [
    ...(m.autonomous.permissions ?? []),
    ...(m.withApproval.permissions ?? []),
    ...m.prohibitions,
  ];
  if (
    allRules.some(
      (rule) => !Object.keys(actionNames).some((action) => rule.action === `${AGENT}${action}`),
    )
  )
    rules.push("Asks you first: another action");
  for (const l of m.limits) {
    if (l.leftOperand === `${AGENT}spendPerDay`)
      rules.push(
        m.currency
          ? `Daily limit: ${new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(l.rightOperand)}`
          : // The executor can't count spend without a signed currency, so it refuses these actions.
            "Daily spend limit has no signed currency, so your agent won't act under it. Save these permissions again to fix this.",
      );
    if (l.leftOperand === `${AGENT}sendsPerDay`) rules.push(`Daily send limit: ${l.rightOperand}`);
    if (l.leftOperand === `${AGENT}perRecipientPerDay`)
      rules.push(`Contact the same person at most ${l.rightOperand} times a day`);
  }
  if (!m.limits.some((limit) => limit.leftOperand === `${AGENT}spendPerDay`))
    rules.push("Daily spend limit: not set");
  if (!m.limits.some((limit) => limit.leftOperand === `${AGENT}perRecipientPerDay`))
    rules.push("Per-person limit: not set");
  rules.push("Must ask me before: anything else. Bans still apply.");
  rules.push(
    `Valid until ${new Date(m.validUntil).toLocaleDateString("en-GB", { timeZone: "UTC" })}`,
    `Memory it may use: ${memoryScope(m).map(memoryCategoryLabel).join(", ") || "none"}`,
  );
  return [...new Set(rules)];
}

/** Fresh record identity, retaining expiry, every ban, limit and policy condition. */
export function reissueMandate(m: Mandate, id: string, now = new Date()): Mandate {
  return {
    ...m,
    id,
    validFrom: now.toISOString(),
    autonomous: { ...m.autonomous, id: `${id}/autonomous` },
    withApproval: { ...m.withApproval, id: `${id}/with-approval` },
  };
}
export async function removePermission(
  m: Mandate,
  set: "autonomous" | "withApproval",
  index: number,
  id: string,
  now = new Date(),
): Promise<Mandate> {
  const rules = m[set].permissions ?? [];
  if (!Number.isInteger(index) || !rules[index]) throw new Error("This permission has changed.");
  const selected = rules[index];
  // Removing an unsupported rule can erase an indeterminate result and unblock unrelated actions.
  // Ask the shared engine about an unrelated action to detect that global blocker first.
  if (
    !Object.keys(actionNames).some((action) => selected.action === `${AGENT}${action}`) ||
    (
      await solidOdrlEngine.evaluate(
        { id: "urn:permission-removal-check", permissions: [selected] },
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
  const next = reissueMandate(m, id, now);
  const remaining = rules.filter((_, i) => i !== index);
  const autonomous = set === "autonomous" ? remaining : (m.autonomous.permissions ?? []);
  return {
    ...next,
    // An overlapping automatic rule must not defeat the promised ask-first consequence.
    autonomous: {
      ...next.autonomous,
      permissions: autonomous.filter((rule) => rule.action !== selected.action),
    },
    withApproval: {
      ...next.withApproval,
      permissions: [
        ...(set === "withApproval" ? remaining : (m.withApproval.permissions ?? [])),
        ...autonomous.filter((rule) => rule.action === selected.action),
      ],
    },
  };
}

function accountIntent(m: Mandate, binding: string, recipient: Account, action: string, now: Date) {
  return {
    agent: m.subject,
    action,
    target: recipient.id,
    at: now.toISOString(),
    attributes: {
      [`${AGENT}binding`]: binding,
      [`${AGENT}recipientSet`]: recipient.channelHandleHash as string,
      [`${AGENT}costExceeds`]: 0,
    },
  };
}

/** Policy boundaries supplement the five-second clock, including short-lived allowances. */
export function mandateBoundaries(m: Mandate | undefined): number[] {
  if (!m) return [];
  return [
    Date.parse(m.validFrom),
    Date.parse(m.validUntil),
    ...[
      ...(m.autonomous.permissions ?? []),
      ...(m.withApproval.permissions ?? []),
      ...(m.autonomous.prohibitions ?? []),
      ...(m.withApproval.prohibitions ?? []),
      ...m.prohibitions,
    ]
      .flatMap((rule) => rule.constraints ?? [])
      .filter((constraint) => constraint.leftOperand === "dateTime")
      .flatMap((constraint) =>
        Array.isArray(constraint.rightOperand)
          ? constraint.rightOperand
          : [constraint.rightOperand],
      )
      .map((value) => Date.parse(String(value))),
  ];
}
export function proposalIntent(proposal: ActionProposal, agent: string, now = new Date()) {
  return {
    agent,
    action: proposal.intent.action,
    target: proposal.intent.target,
    at: now.toISOString(),
    attributes: {
      [`${AGENT}binding`]: proposal.intent.binding,
      [`${AGENT}recipientSet`]: proposal.intent.recipientHash,
      [`${AGENT}costExceeds`]: proposal.intent.amount.value,
    },
  };
}
export async function proposalBadge(
  m: Mandate | undefined,
  p: ActionProposal,
  now = new Date(),
): Promise<"Never" | "Allowed" | "Ask first"> {
  const decision = await evaluateIntent(m, proposalIntent(p, m?.subject ?? "", now));
  return decision.decision === "prohibited"
    ? "Never"
    : decision.decision === "permit"
      ? "Allowed"
      : "Ask first";
}
export function allowSimilar(m: Mandate, p: ActionProposal, id: string, now = new Date()): Mandate {
  const intent = proposalIntent(p, m.subject, now);
  return {
    ...m,
    id,
    validFrom: now.toISOString(),
    autonomous: {
      ...m.autonomous,
      id: `${id}/autonomous`,
      permissions: [
        ...(m.autonomous.permissions ?? []),
        {
          type: "permission",
          action: intent.action,
          target: intent.target,
          constraints: [
            { leftOperand: `${AGENT}binding`, operator: "eq", rightOperand: p.intent.binding },
            {
              leftOperand: `${AGENT}recipientSet`,
              operator: "eq",
              rightOperand: p.intent.recipientHash,
            },
            {
              leftOperand: `${AGENT}costExceeds`,
              operator: "lteq",
              rightOperand: p.intent.amount.value,
            },
            { leftOperand: "dateTime", operator: "gteq", rightOperand: now.toISOString() },
            {
              leftOperand: "dateTime",
              operator: "lt",
              rightOperand: new Date(now.getTime() + 7 * DAY).toISOString(),
            },
          ],
        },
      ],
    },
  };
}
/** Probe a real own-account recipient, never a value invented from a policy constraint. */
export async function mandateNamesBinding(
  m: Mandate | undefined,
  account: Account,
  now = new Date(),
): Promise<boolean> {
  if (!m || !account.channelHandleHash) return false;
  const decision = await evaluateIntent(
    m,
    accountIntent(m, accountBinding(account), account, `${AGENT}SendMessage`, now),
  );
  return decision.decision === "permit" || decision.reason === "owner-approval";
}

/** Confirm the proposed allowance actually grants this exact intent before offering/signing it. */
export async function canAllowSimilar(
  m: Mandate | undefined,
  p: ActionProposal,
  now = new Date(),
): Promise<boolean> {
  if (!m) return false;
  const candidate = allowSimilar(m, p, m.id, now);
  return (await evaluateIntent(candidate, proposalIntent(p, m.subject, now))).decision === "permit";
}
