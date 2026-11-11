// AUTHORED-BY Codex GPT-6.1-Sol
import type { DisabledReason, SharingRole } from "./role-select.js";

/** Adapters can block grants while keeping removal and downgrades available. */
export interface SharingGrantRestrictions {
  grantDisabledReason?: string;
  /** Related resources may still need attention after a change. */
  updateWarning?: string;
}

export interface SharingGeneralAccess {
  mode: "restricted" | "link" | "signed-in";
  role?: "viewer" | "commenter" | "editor";
}

export const shareRoleRank = { viewer: 0, commenter: 1, editor: 2, manager: 3, owner: 4 } as const;

/** Use the same rules for disabled options and event handlers, including delayed Undo. */
export function sharingGrantPolicy(state: SharingGrantRestrictions = {}) {
  const reason = state.grantDisabledReason;
  const disabled = !!reason;
  const allowsPerson = (current: SharingRole | "owner" | undefined, next: SharingRole | null) =>
    !disabled ||
    next === null ||
    (current !== undefined && shareRoleRank[next] <= shareRoleRank[current]);
  const allowsGeneral = (current: SharingGeneralAccess, next: SharingGeneralAccess) =>
    !disabled ||
    next.mode === "restricted" ||
    (next.mode === current.mode &&
      shareRoleRank[next.role ?? "viewer"] <= shareRoleRank[current.role ?? "viewer"]);
  return {
    disabled,
    allowsPerson,
    allowsGeneral,
    roleOptions(current: SharingRole | "owner") {
      const options: Partial<Record<SharingRole, DisabledReason>> = {};
      for (const role of ["viewer", "commenter", "editor", "manager"] as const)
        if (!allowsPerson(current, role))
          options[role] = { disabled: true, reason: reason as string };
      return options;
    },
  };
}
