// AUTHORED-BY Codex GPT-6.1-Sol
import { isSafeAbsoluteIri } from "@jeswr/model-runtime";
import type { AccessGrant } from "@jeswr/pod-access";
import type { OdrlPolicy } from "@jeswr/solid-odrl";
import { NS } from "@jeswr/suite-vocab";
import type { LegacyContactData, LegacyPlanData } from "./generated/model.js";

export type LegacyContact = Omit<LegacyContactData, "mode" | "scope"> & {
  mode: "read";
  scope: "whole-pod" | "containers";
};
export type LegacyPlan = Omit<LegacyPlanData, "contactUrls"> & { contacts: LegacyContact[] };
export interface PlanEvaluation {
  state: "disabled" | "active" | "warning" | "due";
  /** 1 is the first warning; higher numbers mean a nearer deadline. */
  level?: number;
  nextCheck: Date | null;
  daysUntilDue: number | null;
  reason?: "invalid-plan";
}
export interface ProposedGrant {
  target: string;
  grant: AccessGrant;
  inherit: true;
  displayName: string;
}
export const DAY = 86_400_000;
const validDate = (value: unknown): value is Date =>
  value instanceof Date && Number.isFinite(value.getTime());

/** HTTPS only, with exact lexical identity retained for WebIDs. */
export function isWebId(value: unknown): value is string {
  if (typeof value !== "string" || !isSafeAbsoluteIri(value)) return false;
  const url = new URL(value); // isSafeAbsoluteIri already establishes URL parseability.
  return (
    value.startsWith("https://") && url.protocol === "https:" && !url.username && !url.password
  );
}
function container(value: unknown): value is string {
  if (!isWebId(value)) return false;
  const url = new URL(value);
  return (
    url.href === value &&
    !url.search &&
    !url.hash &&
    value.endsWith("/") &&
    !/%(?:2f|5c|25)/i.test(url.pathname)
  );
}
/** Add calendar months in UTC, clamping month-end dates rather than rolling into the next month. */
export function dueDate(plan: Pick<LegacyPlan, "lastActivity" | "inactivityMonths">): Date | null {
  if (
    !validDate(plan.lastActivity) ||
    !Number.isSafeInteger(plan.inactivityMonths) ||
    plan.inactivityMonths < 1 ||
    plan.inactivityMonths > 120000
  )
    return null;
  const date = new Date(plan.lastActivity);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + plan.inactivityMonths);
  const end = new Date(date);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, end.getUTCDate()));
  return validDate(date) ? date : null;
}
/** Domain policy beyond SHACL: exact in-pod scope, complete records and supported read-only intent. */
export function validPlan(plan: LegacyPlan): boolean {
  return (
    !!plan &&
    isWebId(plan.owner) &&
    container(plan.storage) &&
    typeof plan.enabled === "boolean" &&
    validDate(plan.created) &&
    validDate(plan.modified) &&
    validDate(plan.lastActivity) &&
    plan.modified >= plan.created &&
    plan.lastActivity >= plan.created &&
    dueDate(plan) !== null &&
    Array.isArray(plan.warningDays) &&
    plan.warningDays.length > 0 &&
    plan.warningDays.length <= 10 &&
    Array.from(plan.warningDays).every((d) => Number.isSafeInteger(d) && d > 0 && d <= 36600) &&
    Array.isArray(plan.notifyMeBy) &&
    plan.notifyMeBy.length > 0 &&
    plan.notifyMeBy.length <= 2 &&
    Array.from(plan.notifyMeBy).every((v) => v === "settings" || v === "tray") &&
    Array.isArray(plan.contacts) &&
    plan.contacts.length > 0 &&
    plan.contacts.length <= 50 &&
    Array.from(plan.contacts).every(
      (contact) =>
        !!contact &&
        isWebId(contact.webId) &&
        typeof contact.displayName === "string" &&
        contact.displayName.trim().length > 0 &&
        contact.mode === "read" &&
        Array.isArray(contact.targets) &&
        contact.targets.length > 0 &&
        contact.targets.length <= 100 &&
        Array.from(contact.targets).every(
          (target) =>
            container(target) &&
            new URL(target).origin === new URL(plan.storage).origin &&
            target.startsWith(plan.storage),
        ) &&
        (contact.scope === "whole-pod"
          ? contact.targets.length === 1 && contact.targets[0] === plan.storage
          : contact.scope === "containers" &&
            Array.from(contact.targets).every((t) => t !== plan.storage)),
    )
  );
}

/** No I/O and no enforcement. Invalid clocks or records are disabled, never due. */
export function evaluatePlan(plan: LegacyPlan, now: Date): PlanEvaluation {
  if (!validPlan(plan) || !validDate(now))
    return { state: "disabled", nextCheck: null, daysUntilDue: null, reason: "invalid-plan" };
  if (!plan.enabled) return { state: "disabled", nextCheck: null, daysUntilDue: null };
  const due = dueDate(plan) as Date;
  const daysUntilDue = Math.max(0, Math.ceil((due.getTime() - now.getTime()) / DAY));
  // A future activity timestamp delays the entire schedule; never shorten it to the local clock.
  if (now >= due) return { state: "due", nextCheck: null, daysUntilDue: 0 };
  const warnings = [...new Set(plan.warningDays)]
    .sort((a, b) => b - a)
    .map((days) => Math.max(plan.lastActivity.getTime(), due.getTime() - days * DAY));
  const level = warnings.filter((time) => now.getTime() >= time).length;
  const nextCheck = new Date(warnings.find((time) => time > now.getTime()) ?? due);
  return level
    ? { state: "warning", level, nextCheck, daysUntilDue }
    : { state: "active", nextCheck, daysUntilDue };
}

/** Descriptions only: intentionally no access client or mutation callback. Disabled plans can be previewed. */
export function proposedGrants(plan: LegacyPlan): ProposedGrant[] {
  if (!validPlan(plan)) return [];
  return plan.contacts.flatMap((contact) =>
    [...new Set(contact.targets)].map((target) => ({
      target,
      grant: { agent: contact.webId, modes: ["read"] },
      inherit: true,
      displayName: contact.displayName,
    })),
  );
}
/** At least 24 hours between records; future timestamps and malformed plans stay untouched. */
export function recordActivity(plan: LegacyPlan, now: Date): LegacyPlan {
  if (
    !validPlan(plan) ||
    !validDate(now) ||
    now.getTime() - plan.lastActivity.getTime() < DAY ||
    now < plan.modified
  )
    return plan;
  return { ...plan, lastActivity: new Date(now), modified: new Date(now) };
}
/** An advisory policy snapshot. Calendar inactivity is lowered to an absolute standard dateTime threshold. */
export function planPolicy(plan: LegacyPlan, id: string): OdrlPolicy {
  if (!isWebId(id)) throw new TypeError("A safe HTTPS policy IRI is required");
  return {
    id,
    type: "Set",
    conflict: "prohibit",
    permissions:
      validPlan(plan) && plan.enabled
        ? proposedGrants(plan).map(({ target, grant }) => ({
            type: "permission",
            action: "read",
            target,
            assignee: grant.agent as string,
            assigner: plan.owner,
            constraints: [
              {
                leftOperand: "dateTime",
                operator: "gteq",
                rightOperand: (dueDate(plan) as Date).toISOString(),
                datatype: `${NS.XSD}dateTime`,
              },
            ],
          }))
        : [],
  };
}
