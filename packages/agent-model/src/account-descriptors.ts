// AUTHORED-BY Claude Opus 5.5
import type { Account, ChannelCapability } from "./records.js";

const CHANNEL_BINDINGS: Readonly<Record<string, string>> = {
  microsoft_teams: "graph-teams",
  phone_messages: "imessage",
  matrix_bot: "matrix",
  signal: "matrix",
  whatsapp: "matrix",
  github_notifications: "github",
};

/** The inventory stores provider names; descriptors and mandates use binding identifiers. */
export function accountBinding(account: Pick<Account, "channel" | "provider">): string {
  if (account.channel === "email") {
    if (["google", "google_workspace"].includes(account.provider)) return "gmail";
    if (account.provider === "microsoft") return "graph-mail";
  }
  return Object.hasOwn(CHANNEL_BINDINGS, account.channel)
    ? (CHANNEL_BINDINGS[account.channel] as string)
    : account.provider;
}

/**
 * The observations that describe one account: account-specific descriptors for its binding
 * when any exist, otherwise the binding-wide ones (no `account`). Another account's
 * descriptors are never returned, so its scopes or ingest time can't leak across accounts.
 */
export function accountDescriptorCandidates(
  account: Account,
  descriptors: readonly ChannelCapability[],
): ChannelCapability[] {
  const binding = accountBinding(account);
  const matching = descriptors.filter((descriptor) => descriptor.binding === binding);
  const specific = matching.filter((descriptor) => descriptor.account === account.id);
  return specific.length ? specific : matching.filter((d) => d.account === undefined);
}

/** The single descriptor for an account, or undefined when none or several apply. */
export function accountDescriptor(
  account: Account,
  descriptors: readonly ChannelCapability[],
): ChannelCapability | undefined {
  const candidates = accountDescriptorCandidates(account, descriptors);
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** True when several descriptors describe the account, so none is chosen silently. */
export function accountDescriptorConflict(
  account: Account,
  descriptors: readonly ChannelCapability[],
): boolean {
  return accountDescriptorCandidates(account, descriptors).length > 1;
}
