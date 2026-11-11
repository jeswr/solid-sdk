// AUTHORED-BY Codex GPT-6.1-Sol
import { evaluatePlan, type LegacyPlan, proposedGrants } from "@jeswr/pod-legacy";
export function folderName(iri: string): string {
  const path = new URL(iri).pathname.split("/").filter(Boolean).at(-1) ?? "Whole pod";
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
export function grantPreview(plan: LegacyPlan): string[] {
  const grants = proposedGrants(plan);
  return plan.contacts.flatMap((contact) => {
    const targets = grants.filter((g) => g.grant.agent === contact.webId).map((g) => g.target);
    if (!targets.length) return [];
    const labels =
      contact.scope === "whole-pod"
        ? "your whole pod"
        : [...new Set(targets)].map(folderName).join(" and ");
    return [`If this happens, ${contact.displayName} would be able to read ${labels}.`];
  });
}
export function legacyWarning(plan: LegacyPlan, now: Date): string | null {
  const result = evaluatePlan(plan, now);
  if (result.state === "due")
    return "Your legacy plan is due. Nothing has been shared: automatic enforcement is not available.";
  if (result.state !== "warning") return null;
  const months = Math.max(
    0,
    (now.getUTCFullYear() - plan.lastActivity.getUTCFullYear()) * 12 +
      now.getUTCMonth() -
      plan.lastActivity.getUTCMonth() -
      (now.getUTCDate() < plan.lastActivity.getUTCDate() ? 1 : 0),
  );
  return `You haven't been active for ${months} months; your legacy plan becomes due in ${result.daysUntilDue} days. Nothing has been shared.`;
}
