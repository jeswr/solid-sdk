// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// feedback-core — the pure, DOM-free, unit-testable helpers behind
// <jeswr-feedback-button>. Reimplemented HERE (not imported from
// @jeswr/app-shell) so this package has no hard dependency on app-shell
// internals, exactly per the suite contract. The shapes + label scheme MATCH
// app-shell's `feedback.tsx` so issues filed by either are consistent.
/** Per-category presentation. The GitHub label is the category id itself. */
export const FEEDBACK_CATEGORIES = [
    { value: "bug", label: "Bug", emoji: "🐛", titlePrefix: "[Bug]" },
    { value: "feedback", label: "Feedback", emoji: "💡", titlePrefix: "[Feedback]" },
    { value: "help", label: "Help", emoji: "❓", titlePrefix: "[Help]" },
];
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
export function buildIssueUrl(args) {
    const { repo, title, body, labels } = args;
    if (!isValidRepo(repo)) {
        throw new Error(`Invalid GitHub repo "${repo}" — expected "owner/repo" (alphanumerics, ., _, -).`);
    }
    const params = new URLSearchParams();
    params.set("title", title);
    params.set("body", body);
    if (labels.length > 0)
        params.set("labels", labels.join(","));
    // `repo` is validated to the strict owner/repo grammar above (no "/", "..",
    // "@", ":" beyond the single separator), so the host cannot be hijacked.
    return `https://github.com/${repo}/issues/new?${params.toString()}`;
}
/**
 * Validate an "owner/repo" string against GitHub's naming grammar. Owners and
 * repo names allow alphanumerics, hyphen, underscore, and dot; exactly ONE "/"
 * separator; no leading/trailing dot games beyond what GitHub itself permits.
 * Exported for tests. Used to fail closed before any URL is constructed.
 *
 * SECURITY: the repo segment is additionally rejected if it is exactly "." or
 * ".." — those are valid against the character class but are URL dot-segments
 * that would let `buildIssueUrl` emit a path like `github.com/owner/../issues/new`
 * (which normalises to a DIFFERENT host path), defeating the fail-closed guard.
 */
export function isValidRepo(repo) {
    if (typeof repo !== "string")
        return false;
    // owner: 1–39 chars of [A-Za-z0-9-]; repo: 1–100 chars of [A-Za-z0-9._-].
    // (GitHub's real rules are a touch looser on owners, but this strict subset is
    // safe and covers every @jeswr suite repo.)
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/.test(repo)) {
        return false;
    }
    // Reject dot-only repo segments ("." / "..") — path-traversal dot-segments.
    // (GitHub itself disallows a repo literally named "." or "..".)
    const repoSegment = repo.slice(repo.indexOf("/") + 1);
    return repoSegment !== "." && repoSegment !== "..";
}
/**
 * Compose the issue body: the user's description, then a diagnostics block. The
 * WebID line is emitted ONLY when `diagnostics.webId` is set (i.e. consent was
 * given). PURE + exported for unit tests. Never include tokens/secrets here.
 */
export function composeIssueBody(description, diagnostics) {
    const lines = [];
    lines.push(description.trim());
    lines.push("");
    lines.push("---");
    const version = diagnostics.appVersion ? ` ${diagnostics.appVersion}` : "";
    lines.push(`App: ${diagnostics.appName}${version}`);
    if (diagnostics.pageUrl)
        lines.push(`Page: ${diagnostics.pageUrl}`);
    if (diagnostics.userAgent)
        lines.push(`UA: ${diagnostics.userAgent}`);
    // PRIVACY: only present when the reporter consented (caller sets webId only then).
    if (diagnostics.webId)
        lines.push(`Reporter WebID: ${diagnostics.webId}`);
    return lines.join("\n");
}
/** The category-prefixed title: "<prefix> <first non-empty line of description>". */
export function composeIssueTitle(category, description) {
    const meta = FEEDBACK_CATEGORIES.find((c) => c.value === category) ?? FEEDBACK_CATEGORIES[0];
    const firstLine = description
        .split("\n")
        .map((l) => l.trim())
        .find(Boolean) ?? "";
    const MAX = 80;
    const trimmed = firstLine.length > MAX ? `${firstLine.slice(0, MAX - 1)}…` : firstLine;
    return trimmed ? `${meta.titlePrefix} ${trimmed}` : meta.titlePrefix;
}
/** The GitHub labels for a category: always `user-feedback` + the category id. */
export function feedbackLabels(category) {
    return ["user-feedback", category];
}
