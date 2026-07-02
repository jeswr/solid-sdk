/** The three feedback categories. The value doubles as the GitHub label. */
export type FeedbackCategory = "bug" | "feedback" | "help";
/** The payload a `submit` hook receives (and the shape `composeIssueBody` reads). */
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
    /** Diagnostics that were appended to the body (for the proxy to re-validate). */
    diagnostics: FeedbackDiagnostics;
}
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
/** The result a `submit` hook resolves with: the created issue's URL + number. */
export interface FeedbackSubmitResult {
    url: string;
    number: number;
}
/**
 * Build the GitHub prefilled new-issue URL. PURE + exported so the URL encoding
 * is unit-testable without a DOM. GitHub reads `title`, `body`, and a
 * comma-separated `labels` query param on `/issues/new`.
 */
export declare function buildIssueUrl(args: {
    repo: string;
    title: string;
    body: string;
    labels: string[];
}): string;
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
