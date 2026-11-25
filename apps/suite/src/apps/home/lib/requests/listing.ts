// AUTHORED-BY Claude Opus 5.5
/**
 * The Requests inbox listing. pod-access `listRequests` reports every inbox member, and every
 * member that isn't an access request is `unreadable`, deliberately. Share Announces are
 * ordinary notifications, not broken requests, so the members `@jeswr/suite-sdk/shared`
 * recognises as shares are returned beside the entries for the split to leave out.
 *
 * Cost: `listRequests` keeps the documents it read to itself, so its unreadable members are read
 * a second time (with the inbox container, and the profile unless the inbox is given), and only
 * when there are any. An inbox holding nothing but requests costs no extra request.
 */

import {
  type AccessRequestEntry,
  type ListRequestsOptions,
  listRequests,
} from "@jeswr/pod-access/requests-solid";
import { shareNotificationUrls } from "@jeswr/suite-sdk/shared";

export interface InboxListing {
  entries: AccessRequestEntry[];
  /** Unreadable entries' ids that are share notifications. */
  shares: ReadonlySet<string>;
}

export async function listInboxRequests(options: ListRequestsOptions): Promise<InboxListing> {
  const entries = await listRequests(options);
  const unreadable = entries.flatMap((entry) => (entry.status === "unreadable" ? [entry.id] : []));
  if (!unreadable.length) return { entries, shares: new Set() };
  const shares = await shareNotificationUrls(unreadable, {
    fetch: options.fetch,
    webId: options.webId,
    ...(options.inbox !== undefined && { inbox: options.inbox }),
    ...(options.signal && { signal: options.signal }),
  }).catch((): ReadonlySet<string> => {
    // Recognising shares only tidies the unreadable note: a failure leaves them counted.
    options.signal?.throwIfAborted();
    return new Set();
  });
  return { entries, shares };
}
