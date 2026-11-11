// AUTHORED-BY Codex GPT-6.1-Sol
import type { ShareCapabilities, ShareKind, ShareRole, SharingState } from "../share/types";

export { shareRoleRank } from "@jeswr/suite-ui/sharing";

export function shareSubtitle(state: SharingState): string {
  if (state.general.mode === "link")
    return state.general.role === "editor"
      ? "Anyone with the link can edit"
      : state.general.role === "commenter"
        ? "Anyone with the link can comment"
        : "Anyone with the link can view";
  if (state.general.mode === "signed-in") return "Anyone signed in has access";
  if (state.groups?.length) return "Shared with groups";
  // One owner represents the current account; additional controllers still count as people.
  const count =
    state.people.length - Number(state.people.some((person) => person.role === "owner"));
  return count ? `Shared with ${count} ${count === 1 ? "person" : "people"}` : "Only you";
}
export function shareRoleOptions(
  kind: ShareKind,
  caps: ShareCapabilities,
  canManage: boolean,
  supportsCommenter = true,
): ShareRole[] {
  return [
    "viewer" as const,
    ...(kind === "document" && supportsCommenter ? ["commenter" as const] : []),
    "editor" as const,
    ...(canManage && caps.managerRole ? ["manager" as const] : []),
  ];
}
export function generalAccessOptions(caps: ShareCapabilities) {
  return [
    { value: "restricted" as const, label: "Restricted", disabled: false },
    { value: "link" as const, label: "Anyone with the link", disabled: !caps.publicLinks },
    {
      value: "signed-in" as const,
      label: "Anyone signed in",
      disabled: !caps.authenticatedAgentGrants,
    },
  ];
}
export function grantExpires(
  duration: "until-revoked" | "day" | "month" | "year" | "custom",
  custom: string,
  now: Date,
): Date | undefined {
  if (duration === "until-revoked") return undefined;
  const date = new Date(now);
  if (duration === "day") date.setDate(date.getDate() + 1);
  if (duration === "month") date.setMonth(date.getMonth() + 1);
  if (duration === "year") date.setFullYear(date.getFullYear() + 1);
  const result = duration === "custom" ? new Date(`${custom}T23:59:59`) : date;
  if (!Number.isFinite(result.getTime()) || result <= now)
    throw new Error("Choose a future end date");
  return result;
}
