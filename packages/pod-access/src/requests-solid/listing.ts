// AUTHORED-BY Claude Opus 5.5
import { withRecordedChoices } from "./approval.js";
import { type AccessRequestEntry, type ListRequestsOptions, listInbox } from "./inbox.js";

/**
 * Discover ldp:inbox and list at most MAX_MEMBERS, each bounded to MAX_NOTIFICATION_BYTES, then
 * attach to each pending or Approving request the choices of an approval the owner's records
 * already pinned for it (read-only).
 */
export async function listRequests(options: ListRequestsOptions): Promise<AccessRequestEntry[]> {
  return withRecordedChoices(await listInbox(options), options);
}
