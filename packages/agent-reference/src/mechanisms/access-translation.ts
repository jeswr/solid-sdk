// AUTHORED-BY Codex GPT-6
import type { OdrlPolicy, OdrlRule } from "@jeswr/solid-odrl";
import type { AccessMode } from "../model/solid-storage.js";

export interface TranslatedRule {
  resource: string;
  agent: string;
  modes: readonly AccessMode[];
  until: string;
  policies: readonly string[];
}

export interface TranslationTerms {
  supplier: OdrlPolicy;
  grant: OdrlPolicy;
  mandate: OdrlRule;
  item: string;
  resource: string;
  agent: string;
  recipient: string;
  purpose: string;
  mandateTarget: string;
  at: string;
  until: string;
}

const readable = new Set(["read", "use", "distribute"]);
function scopeMatches(rule: OdrlRule, terms: TranslationTerms, target: string): boolean {
  if (!readable.has(rule.action) || rule.target !== target) return false;
  return (rule.constraints ?? []).every(({ leftOperand, operator, rightOperand }) => {
    if (leftOperand === "dateTime") {
      const instant = typeof rightOperand === "string" ? Date.parse(rightOperand) : NaN;
      if (!Number.isFinite(instant)) return false;
      const now = Date.parse(terms.at);
      if (operator === "lt" || operator === "lteq") return now < instant;
      if (operator === "gt") return now > instant;
      return operator === "gteq" && now >= instant;
    }
    const value =
      leftOperand === "purpose"
        ? terms.purpose
        : leftOperand === "recipient"
          ? terms.recipient
          : undefined;
    return (
      value !== undefined &&
      (operator === "eq"
        ? value === rightOperand
        : operator === "isAnyOf" && Array.isArray(rightOperand) && rightOperand.includes(value))
    );
  });
}

function governingPermissions(t: TranslationTerms) {
  const grantTarget = `${t.grant.id.replace(/#grant$/, "")}#evidence`;
  const policies = [
    [t.supplier, t.item],
    [t.grant, grantTarget],
  ] as const;
  if (t.grant.assignee !== t.recipient || !scopeMatches(t.mandate, t, t.mandateTarget))
    return undefined;
  const groups = policies.map(([policy, target]) => {
    const applies = (rule: OdrlRule) =>
      (!rule.assignee || rule.assignee === t.recipient) && scopeMatches(rule, t, target);
    if ((policy.prohibitions ?? []).some(applies)) return [];
    return (policy.permissions ?? []).filter(
      (rule) =>
        rule.id &&
        rule.type === "permission" &&
        applies(rule) &&
        // In supplier terms an unaddressed use permission belongs to the current holder.
        // A transfer rests on the share permission or a permission for this named reader.
        (policy !== t.supplier ||
          rule.action === "distribute" ||
          (rule.assignee ?? policy.assignee) === t.recipient),
    );
  });
  return groups.every((group) => group.length > 0) ? groups : undefined;
}

function endOf(t: TranslationTerms, permissions: readonly OdrlRule[]): string {
  let end = Date.parse(t.until);
  for (const rule of [...permissions, t.mandate])
    for (const c of rule.constraints ?? [])
      if (c.leftOperand === "dateTime" && (c.operator === "lt" || c.operator === "lteq"))
        end = Math.min(end, Date.parse(String(c.rightOperand)));
  return new Date(end).toISOString();
}

export function translateTerms(t: TranslationTerms): {
  rule?: TranslatedRule;
  remainder: readonly string[];
} {
  const permissions = governingPermissions(t)?.flat();
  return {
    rule: permissions && {
      resource: t.resource,
      agent: t.agent,
      modes: ["Read"],
      until: endOf(t, permissions),
      policies: [...new Set(permissions.map((r) => r.id as string))],
    },
    remainder: [
      "Purpose limits stay in the signed terms.",
      "Onward sharing limits stay in the signed terms.",
      "Storage, derivation and aggregation remain subject to the signed terms.",
      "The deletion duty stays in the signed terms.",
    ],
  };
}

/** The gate derives the envelope from the trusted inputs, without calling the translator. */
export function withinTerms(rule: TranslatedRule, t: TranslationTerms): boolean {
  const groups = governingPermissions(t);
  return (
    !!groups &&
    rule.resource === t.resource &&
    rule.agent === t.agent &&
    rule.modes.length === 1 &&
    rule.modes[0] === "Read" &&
    Date.parse(rule.until) > Date.parse(t.at) &&
    Date.parse(rule.until) <= Date.parse(endOf(t, groups.flat())) &&
    groups.every((group) => group.some((r) => r.id && rule.policies.includes(r.id))) &&
    rule.policies.every((id) => groups.some((group) => group.some((r) => r.id === id)))
  );
}
