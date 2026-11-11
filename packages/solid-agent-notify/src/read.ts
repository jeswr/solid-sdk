// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * read.ts — read + parse the notifications in an LDN inbox.
 *
 * SECURITY (confused-deputy guard). The inbox container's `ldp:contains` listing
 * is attacker-influenced: a hostile/compromised inbox could list a member URL on
 * a DIFFERENT origin or outside the container to steer an authenticated GET
 * off-target. So before dereferencing ANY member we assert it is a direct child of
 * the inbox container ({@link isDirectChild}); members that fail are skipped. Every
 * GET (the container listing AND each member) goes through the DNS-pinned
 * {@link guardedFetch} chokepoint. A single unreadable / non-AS2.0 member resolves
 * to `undefined` (skipped) rather than failing the whole listing.
 */
import { parseRdf } from "@jeswr/fetch-rdf";
import { MAX_BYTES_INBOX } from "./config.js";
import {
  containerMembers,
  type InboxNotification,
  parseInboxNotification,
  sortInboxNotifications,
} from "./inbox.js";

export type { InboxNotification } from "./inbox.js";
export { findActivitySubject, isDirectChild, parseInboxNotification } from "./inbox.js";

import type { NotifyOptions } from "./discover.js";
import { type GuardedFetchResult, guardedFetch } from "./security/guardedFetch.js";

/**
 * List + parse the notifications in an LDN inbox.
 *
 * @param inboxUrl the inbox container URL (e.g. from {@link discoverInbox}).
 * @returns the parsed notifications, newest first (undated last, stable by URL). A
 *   missing inbox (404/403) or an unreadable/SSRF-refused container lists as empty.
 */
export async function readInbox(
  inboxUrl: string,
  opts: NotifyOptions = {},
): Promise<InboxNotification[]> {
  const fetcher = opts.fetchImpl ?? guardedFetch;
  const getOpts = {
    method: "GET" as const,
    maxBytes: MAX_BYTES_INBOX,
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.allowLoopback !== undefined ? { allowLoopback: opts.allowLoopback } : {}),
    ...(opts.dnsLookup !== undefined ? { dnsLookup: opts.dnsLookup } : {}),
  };

  let listing: GuardedFetchResult;
  try {
    listing = await fetcher(inboxUrl, getOpts);
  } catch {
    return []; // unreadable / SSRF-refused container → empty
  }
  if (listing.status < 200 || listing.status >= 300) return [];

  let containerDataset: import("@rdfjs/types").DatasetCore;
  try {
    containerDataset = await parseRdf(listing.text, listing.contentType || null, {
      baseIRI: listing.finalUrl,
    });
  } catch {
    return [];
  }

  const members = containerMembers(listing.finalUrl, containerDataset);
  const parsed = await Promise.all(
    members.map(async (memberUrl) => {
      try {
        const r = await fetcher(memberUrl, getOpts);
        if (r.status < 200 || r.status >= 300) return undefined;
        const ds = await parseRdf(r.text, r.contentType || null, {
          baseIRI: r.finalUrl,
        });
        return parseInboxNotification(memberUrl, ds);
      } catch {
        return undefined;
      }
    }),
  );

  const notifications = parsed.filter((n): n is InboxNotification => n !== undefined);
  return sortInboxNotifications(notifications);
}
