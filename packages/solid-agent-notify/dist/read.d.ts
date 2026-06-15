import type { NotifyOptions } from "./discover.js";
/** A notification as a reader consumes it (plain, serialisable — no RDF terms). */
export interface InboxNotification {
    /** The notification resource URL (an inbox child). */
    url: string;
    /** `as:type` local name(s) joined (e.g. "Announce"), or "Notification". */
    type: string;
    /** `as:actor` — sender WebID, if present. */
    actor?: string;
    /** `as:object` IRI, if present. */
    object?: string;
    /** `as:target` IRI, if present. */
    target?: string;
    /** `as:summary`. */
    summary?: string;
    /** `as:content`. */
    content?: string;
    /** `as:published` as an ISO string (serialisable). */
    published?: string;
}
/**
 * True when `url` is a direct child resource of the `container` (same origin, path
 * is one segment deeper, no query/fragment, no encoded slash). Mirrors the Pod
 * Manager's `assertInInbox` scope guard so a crafted listing can never steer a GET
 * onto another origin or out of the container.
 */
export declare function isDirectChild(url: string, container: string): boolean;
/**
 * Locate the activity subject IRI within a notification dataset: the first subject
 * carrying an `as:` rdf:type, else the first with an `as:actor`. Falls back to the
 * conventional `${url}#it`. Pure.
 */
export declare function findActivitySubject(url: string, dataset: import("@rdfjs/types").DatasetCore): string | undefined;
/**
 * Parse a notification document into an {@link InboxNotification}, or `undefined`
 * if it carries no recognisable AS2.0 activity.
 */
export declare function parseInboxNotification(url: string, dataset: import("@rdfjs/types").DatasetCore): InboxNotification | undefined;
/**
 * List + parse the notifications in an LDN inbox.
 *
 * @param inboxUrl the inbox container URL (e.g. from {@link discoverInbox}).
 * @returns the parsed notifications, newest first (undated last, stable by URL). A
 *   missing inbox (404/403) or an unreadable/SSRF-refused container lists as empty.
 */
export declare function readInbox(inboxUrl: string, opts?: NotifyOptions): Promise<InboxNotification[]>;
//# sourceMappingURL=read.d.ts.map