/**
 * Typed domain errors for solid-agent-notify. The SSRF/guard-layer errors
 * (`SsrfError`, `GuardedFetchError`, `BodyTooLargeError`) are re-exported from
 * the security layer; these are the higher-level send/discover/read errors.
 */
/** Base class for every error this package throws (besides the guard-layer ones). */
export declare class AgentNotifyError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
/** A recipient's profile advertises no `ldp:inbox` we can deliver to. */
export declare class NoInboxError extends AgentNotifyError {
    readonly webId: string;
    constructor(webId: string);
}
/** A cross-pod notification POST was rejected by the recipient's inbox. */
export declare class NotificationSendError extends AgentNotifyError {
    readonly inbox: string;
    /** HTTP status the recipient inbox answered with (0 for a guard refusal / network error). */
    readonly status: number;
    constructor(inbox: string, status: number, options?: {
        cause?: unknown;
    });
}
/**
 * A URL is outside the inbox container it is supposed to belong to (confused-deputy
 * guard for the read/manage path — we never dereference a member the listing
 * advertises but that is not actually a direct child of the inbox).
 */
export declare class InboxScopeError extends AgentNotifyError {
    readonly url: string;
    readonly container: string;
    constructor(url: string, container: string);
}
//# sourceMappingURL=errors.d.ts.map