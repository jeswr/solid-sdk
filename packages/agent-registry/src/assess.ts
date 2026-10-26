// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { Account, Restrictions, Settings, WorkflowPolicy } from "./model.js";

/** Inventory evidence is not current provider health. */
export function connectionStatus(
  account: Account,
  now: Date,
): {
  state: "inventory" | "setup-required" | "error" | "disabled";
  stale: boolean;
  identityConflict: boolean;
} {
  const observed = Date.parse(account.inventory.lastTested ?? account.inventory.observedAt ?? "");
  const age = now.getTime() - observed;
  return {
    state:
      account.bindingState === "error" || account.bindingState === "disabled"
        ? account.bindingState
        : account.bindingState === "setup-required"
          ? "setup-required"
          : "inventory",
    stale: !Number.isFinite(age) || age < 0 || age > 7 * 86_400_000,
    identityConflict: account.identityConflicts.length > 0,
  };
}
/** Independent provider/owner/policy layers, ported from the pilot's default-deny assessment. */
export function effectiveCapability(
  account: Account,
  capability: keyof Restrictions,
  policy: WorkflowPolicy | null,
): { allowed: boolean; provider: boolean; owner: boolean; policy: boolean } {
  const action = {
    read: "read_via_approved_workflow",
    triage: "classify",
    draft: "draft",
    send: "send",
  }[capability];
  // This importer never verifies provider access or signed mandates. No inventory can grant it.
  return {
    allowed: false,
    provider: false,
    owner: capability === "send" ? false : account.restrictions[capability] === true,
    policy: capability === "send" ? false : policy?.defaultAllowed.includes(action) === true,
  };
}
/** Settings capability table; send remains unavailable without the executor's mandate gate. */
export function capabilityMatrix(settings: Settings) {
  return settings.connections.map((account) => ({
    id: account.id,
    capabilities: (["read", "triage", "draft", "send"] as const).map((capability) => ({
      capability,
      ...effectiveCapability(account, capability, settings.workflowPolicy),
    })),
  }));
}
