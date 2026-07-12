// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// feedback-core — the PURE, framework-free core of the feedback control.
//
// This module holds ONLY plain-data logic: the issue title/body/label/URL
// composition and the payload/diagnostics types. It imports NO React, NO
// lucide, and reaches for NO DOM/browser global — so the load-bearing rules a
// reviewer most cares about (the PRIVACY gate on the WebID line, the URL
// encoding, the label set) are readable in isolation as a spec, verifiable
// without a DOM. `feedback.tsx` (the React adapter) composes these with the
// dialog UI; the package barrel re-exports the public helpers unchanged.
//
// `URLSearchParams` is a cross-platform standard global (Node + browser), not a
// DOM API, so `buildIssueUrl` stays pure.

// ── Types ─────────────────────────────────────────────────────────────────────

/** The three feedback categories. The value doubles as the GitHub label. */
export type FeedbackCategory = "bug" | "feedback" | "help";

/**
 * Short prefix prepended to the issue title, per category. An exhaustive
 * `Record<FeedbackCategory, string>` so the lookup in `composeIssueTitle` is
 * index-safe (a key of the closed union always resolves a value).
 */
const TITLE_PREFIX: Record<FeedbackCategory, string> = {
  bug: "[Bug]",
  feedback: "[Feedback]",
  help: "[Help]",
};

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
  appVersion?: string | undefined;
  /** The page the feedback was raised from (`location.href`). */
  pageUrl?: string | undefined;
  /** The browser user-agent. */
  userAgent?: string | undefined;
  /** Present ONLY when the reporter consented to share their WebID (`undefined` = absent). */
  webId?: string | undefined;
}

/** The result a `submit` hook resolves with: the created issue's URL + number. */
export interface FeedbackSubmitResult {
  url: string;
  number: number;
}

// ── Pure, unit-testable helpers ────────────────────────────────────────────────

/**
 * Build the GitHub prefilled new-issue URL. PURE + exported so the URL encoding
 * is unit-testable without a DOM. GitHub reads `title`, `body`, and a
 * comma-separated `labels` query param on `/issues/new`.
 */
export function buildIssueUrl(args: {
  repo: string;
  title: string;
  body: string;
  labels: string[];
}): string {
  const { repo, title, body, labels } = args;
  const params = new URLSearchParams();
  params.set("title", title);
  params.set("body", body);
  if (labels.length > 0) params.set("labels", labels.join(","));
  return `https://github.com/${repo}/issues/new?${params.toString()}`;
}

/**
 * Compose the issue body: the user's description, then a diagnostics block. The
 * WebID line is emitted ONLY when `diagnostics.webId` is set (i.e. consent was
 * given). PURE + exported for unit tests. Never include tokens/secrets here.
 */
export function composeIssueBody(description: string, diagnostics: FeedbackDiagnostics): string {
  const lines: string[] = [];
  lines.push(description.trim());
  lines.push("");
  lines.push("---");
  const version = diagnostics.appVersion ? ` ${diagnostics.appVersion}` : "";
  lines.push(`App: ${diagnostics.appName}${version}`);
  if (diagnostics.pageUrl) lines.push(`Page: ${diagnostics.pageUrl}`);
  if (diagnostics.userAgent) lines.push(`UA: ${diagnostics.userAgent}`);
  // PRIVACY: only present when the reporter consented (caller sets webId only then).
  if (diagnostics.webId) lines.push(`Reporter WebID: ${diagnostics.webId}`);
  return lines.join("\n");
}

/** The category-prefixed title: "<prefix> <first non-empty line of description>". */
export function composeIssueTitle(category: FeedbackCategory, description: string): string {
  // `category` is a closed union and TITLE_PREFIX covers every member, so the
  // lookup never misses at runtime; `?? TITLE_PREFIX.bug` keeps it provably total.
  const prefix = TITLE_PREFIX[category] ?? TITLE_PREFIX.bug;
  const firstLine =
    description
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  const MAX = 80;
  const trimmed = firstLine.length > MAX ? `${firstLine.slice(0, MAX - 1)}…` : firstLine;
  return trimmed ? `${prefix} ${trimmed}` : prefix;
}

/** The GitHub labels for a category: always `user-feedback` + the category id. */
export function feedbackLabels(category: FeedbackCategory): string[] {
  return ["user-feedback", category];
}
