// AUTHORED-BY Claude Opus 4.8
//
// Pure presentation helpers for the inbox view. No React, no RDF — just the
// date/sender/subject formatting the view renders, plus the defensive
// "is this IRI safe to put in an href" guard. Kept separate so they are
// trivially unit-testable and reusable by any future view (a list AND a
// reading pane).
//
// Message content (subject, body, sender) is UNTRUSTED — it may have been
// ingested from arbitrary external mail. These helpers therefore never produce
// markup; they only ever return plain strings, and the view renders those as
// text (React escapes by default). The one place a value reaches an attribute
// (a sender `href`) is gated by {@link safeHref}, which admits only http(s)/
// mailto URLs so a `javascript:` (or other scheme) sender IRI can never become
// a clickable navigation.

/**
 * A subject line for display, falling back to a conventional "(no subject)"
 * when the message carries none — so the list/heading always renders a value
 * rather than an empty cell. Returns the raw string otherwise; the view renders
 * it as text, so no escaping is needed here.
 */
export function formatSubject(subject: string | undefined): string {
  if (subject === undefined || subject.length === 0) {
    return "(no subject)";
  }
  return subject;
}

/**
 * A sender for display: the raw sender IRI/string, or "(unknown sender)" when
 * absent. The view renders this as text; {@link safeHref} decides separately
 * whether it may also be a link.
 */
export function formatSender(sender: string | undefined): string {
  if (sender === undefined || sender.length === 0) {
    return "(unknown sender)";
  }
  return sender;
}

/**
 * ISO-date-time (`YYYY-MM-DD HH:MM`) for a message timestamp, or `"—"` when
 * absent. Deliberately locale-independent (no `toLocaleString`) so the rendered
 * value is stable across environments and trivially assertable in a test.
 */
export function formatDate(date: Date | undefined): string {
  if (date === undefined) {
    return "—";
  }
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/**
 * The href to use for a sender, or `undefined` if the value is not a URL we are
 * willing to navigate to. ONLY `http:`, `https:` and `mailto:` are admitted —
 * everything else (notably `javascript:`, `data:`, a blank-node id, or a bare
 * token) is rejected so an untrusted sender value can never become an active
 * link. Returning `undefined` tells the view to render the sender as plain text.
 */
export function safeHref(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (
    parsed.protocol === "http:" ||
    parsed.protocol === "https:" ||
    parsed.protocol === "mailto:"
  ) {
    return value;
  }
  return undefined;
}

/**
 * A user-facing message for a thrown value. The store rejects with typed
 * `Error`s, but a catch binds `unknown`; this normalises both (an Error's
 * `.message`, else the stringified value) into one display string — kept here
 * as a pure, directly-testable helper rather than an inline ternary in the hook.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
