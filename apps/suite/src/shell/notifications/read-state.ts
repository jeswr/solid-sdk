// AUTHORED-BY Codex GPT-6.1-Sol
import { type AccountIdSet, createAccountIdSet } from "../../lib/account-id-set";

export type NotificationReadState = AccountIdSet;
/** Newest receipts kept per account; older notifications have long left the tray. */
export const MAX_READ_RECEIPTS = 500;

export function createNotificationReadState(
  accountId: string,
  storage?: Pick<Storage, "getItem" | "setItem">,
): NotificationReadState {
  return createAccountIdSet(
    `suite:notification-reads:${accountId}`,
    accountId,
    MAX_READ_RECEIPTS,
    storage,
  );
}
