/** The three feedback categories. The value doubles as a GitHub label. */
export type FeedbackCategory = "bug" | "feedback" | "help";
/** Per-category presentation. The GitHub label is the category id itself. */
export declare const FEEDBACK_CATEGORIES: ReadonlyArray<{
    value: FeedbackCategory;
    label: string;
    emoji: string;
    /** Short prefix prepended to the issue title. */
    titlePrefix: string;
}>;
/** The diagnostics block, structured. The WebID is present ONLY with consent. */
export interface FeedbackDiagnostics {
    appName: string;
    appVersion?: string;
    /** The page the feedback was raised from (`location.href`). */
    pageUrl?: string;
    /** The browser user-agent. */
    userAgent?: string;
    /** Present ONLY when the reporter consented to share their WebID. */
    webId?: string;
}
/** The payload the `submit` hook receives / a `feedback-submit` event carries. */
export interface FeedbackPayload {
    /** "jeswr/pod-mail" — the OWNER/REPO the issue is filed against. */
    repo: string;
    /** The selected category (also the category GitHub label). */
    category: FeedbackCategory;
    /** The full issue title (category prefix + first line of the description). */
    title: string;
    /** The full issue body (the description + the diagnostics block). */
    body: string;
    /** The GitHub labels to apply: always `user-feedback` + the category. */
    labels: string[];
    /** The raw description the user typed (without the diagnostics block). */
    description: string;
    /** Diagnostics that were appended to the body (for a proxy to re-validate). */
    diagnostics: FeedbackDiagnostics;
}
/** The result a `submit` hook resolves with: the created issue's URL + number. */
export interface FeedbackSubmitResult {
    url: string;
    number: number;
}
/**
 * Build the GitHub prefilled new-issue URL. PURE + exported so the URL encoding
 * is unit-testable without a DOM. GitHub reads `title`, `body`, and a
 * comma-separated `labels` query param on `/issues/new`.
 *
 * SECURITY: `repo` is "owner/repo". We validate it against the GitHub owner/repo
 * grammar and reject anything else, so a malicious value can't smuggle a
 * different host, a path-traversal, or extra query string into the URL. The
 * title/body/labels are URL-encoded by URLSearchParams.
 */
export declare function buildIssueUrl(args: {
    repo: string;
    title: string;
    body: string;
    labels: string[];
}): string;
/**
 * Validate an "owner/repo" string against GitHub's naming grammar. Owners and
 * repo names allow alphanumerics, hyphen, underscore, and dot; exactly ONE "/"
 * separator; no leading/trailing dot games beyond what GitHub itself permits.
 * Exported for tests. Used to fail closed before any URL is constructed.
 */
export declare function isValidRepo(repo: string): boolean;
/**
 * Compose the issue body: the user's description, then a diagnostics block. The
 * WebID line is emitted ONLY when `diagnostics.webId` is set (i.e. consent was
 * given). PURE + exported for unit tests. Never include tokens/secrets here.
 */
export declare function composeIssueBody(description: string, diagnostics: FeedbackDiagnostics): string;
/** The category-prefixed title: "<prefix> <first non-empty line of description>". */
export declare function composeIssueTitle(category: FeedbackCategory, description: string): string;
/** The GitHub labels for a category: always `user-feedback` + the category id. */
export declare function feedbackLabels(category: FeedbackCategory): string[];
