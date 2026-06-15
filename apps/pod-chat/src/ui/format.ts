// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pure presentation helpers for the Pod-Chat view. No React, no RDF — just the
// name/author/date formatting the view renders, plus the defensive "is this IRI
// safe to put in an href" guard. Kept separate so they are trivially
// unit-testable and reusable by both the room list and the message thread.
//
// Chat content (room names, message bodies, author + assignee IRIs, task
// titles) is UNTRUSTED — a room/message can be authored by ANY participant, and
// the actionable-task overlay can be set by a remote app. These helpers
// therefore never produce markup; they only ever return plain strings, and the
// view renders those as text (React escapes by default — there is NO
// dangerouslySetInnerHTML anywhere in this view). The one place a value reaches
// an attribute (an author/assignee `href`) is gated by {@link safeHref}, which
// admits only http(s)/mailto URLs so a `javascript:` (or `data:`, or other
// scheme) IRI can never become a clickable navigation.

/**
 * A room name for display, falling back to a friendly name derived from the
 * resource URL (then a generic "(untitled room)") when the descriptor carries
 * no `as:name` — so the list always renders a value rather than an empty cell.
 * Returns the raw string otherwise; the view renders it as text, so no escaping
 * is needed here.
 */
export function formatRoomName(name: string | undefined, fallback?: string): string {
  if (name !== undefined && name.length > 0) {
    return name;
  }
  if (fallback !== undefined && fallback.length > 0) {
    return fallback;
  }
  return "(untitled room)";
}

/**
 * A message body for display: the raw `as:content`, or "(no content)" when the
 * message carries an empty body. The view renders this as text inside a `<pre>`,
 * so embedded markup is shown literally rather than rendered.
 */
export function formatBody(content: string | undefined): string {
  if (content === undefined || content.length === 0) {
    return "(no content)";
  }
  return content;
}

/**
 * An author for display: the raw author IRI/string, or "(unknown sender)" when
 * absent. The view renders this as text; {@link safeHref} decides separately
 * whether it may also be a link.
 */
export function formatAuthor(author: string | undefined): string {
  if (author === undefined || author.length === 0) {
    return "(unknown sender)";
  }
  return author;
}

/**
 * ISO-date-time (`YYYY-MM-DD HH:MM`) for a message/room timestamp, or `"—"` when
 * absent OR invalid. Deliberately locale-independent (no `toLocaleString`) so
 * the rendered value is stable across environments and trivially assertable in
 * a test. A timestamp from the pod is UNTRUSTED RDF; an unparseable date literal
 * can surface as an `Invalid Date`, whose `toISOString()` throws
 * `RangeError: Invalid time value` and would crash the row render — so we guard
 * with `Number.isNaN(date.getTime())` and fall back to the same em-dash.
 */
export function formatDate(date: Date | undefined): string {
  if (date === undefined || Number.isNaN(date.getTime())) {
    return "—";
  }
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/**
 * The href to use for an author/assignee IRI, or `undefined` if the value is
 * not a URL we are willing to navigate to. ONLY `http:`, `https:` and `mailto:`
 * are admitted — everything else (notably `javascript:`, `data:`, a blank-node
 * id, or a bare token) is rejected so an untrusted IRI can never become an
 * active link. Returning `undefined` tells the view to render the value as plain
 * text.
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
 * A user-facing message for a thrown value. The data layer rejects with typed
 * errors (`RdfFetchError`, `PodChatError`), but a catch binds `unknown`; this
 * normalises both (an Error's `.message`, else the stringified value) into one
 * display string — kept here as a pure, directly-testable helper rather than an
 * inline ternary in the hook.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
