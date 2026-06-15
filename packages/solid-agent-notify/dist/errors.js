// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Typed domain errors for solid-agent-notify. The SSRF/guard-layer errors
 * (`SsrfError`, `GuardedFetchError`, `BodyTooLargeError`) are re-exported from
 * the security layer; these are the higher-level send/discover/read errors.
 */
/** Base class for every error this package throws (besides the guard-layer ones). */
export class AgentNotifyError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = "AgentNotifyError";
    }
}
/** A recipient's profile advertises no `ldp:inbox` we can deliver to. */
export class NoInboxError extends AgentNotifyError {
    webId;
    constructor(webId) {
        super(`This agent's profile does not advertise an inbox to deliver to (${webId}).`);
        this.name = "NoInboxError";
        this.webId = webId;
    }
}
/** A cross-pod notification POST was rejected by the recipient's inbox. */
export class NotificationSendError extends AgentNotifyError {
    inbox;
    /** HTTP status the recipient inbox answered with (0 for a guard refusal / network error). */
    status;
    constructor(inbox, status, options) {
        super(`Could not deliver the notification (${status}) to ${inbox}.`, options);
        this.name = "NotificationSendError";
        this.inbox = inbox;
        this.status = status;
    }
}
/**
 * A URL is outside the inbox container it is supposed to belong to (confused-deputy
 * guard for the read/manage path — we never dereference a member the listing
 * advertises but that is not actually a direct child of the inbox).
 */
export class InboxScopeError extends AgentNotifyError {
    url;
    container;
    constructor(url, container) {
        super(`Refusing to act on a resource outside the inbox container: ${url}`);
        this.name = "InboxScopeError";
        this.url = url;
        this.container = container;
    }
}
//# sourceMappingURL=errors.js.map