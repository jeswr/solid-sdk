// AUTHORED-BY Claude Opus 4.8
/**
 * Pure presentation helpers for the LDN inbox view (no React, unit-tested).
 *
 * Maps an AS2 activity type IRI to a short human label + a default summary, and
 * formats `as:published` timestamps. Kept out of the component so the labelling
 * (which a malformed/unknown type must degrade gracefully on) is testable.
 */

import { AS } from "./vocab";
import type { InboxNotification } from "./inbox";

/** A short, lower-cased label for an AS2 activity type IRI (`as:Announce` → "announced"). */
export function activityLabel(types: readonly string[]): string {
  // Pick the first recognised AS2 type; fall back to a generic "notification".
  for (const t of types) {
    const local = t.startsWith(AS) ? t.slice(AS.length) : t;
    switch (local) {
      case "Announce":
        return "announced";
      case "Add":
        return "added";
      case "Create":
        return "created";
      case "Update":
        return "updated";
      case "Remove":
        return "removed";
      case "Delete":
        return "deleted";
      case "Like":
        return "liked";
      case "Offer":
        return "offered";
      case "Invite":
        return "invited";
      case "Mention":
        return "mentioned you in";
      default:
        // A known AS namespace but an activity we don't special-case: show the
        // local name lower-cased rather than a raw IRI.
        if (t.startsWith(AS) && local) return local.toLowerCase();
    }
  }
  return "notification";
}

/**
 * The human title for a notification: its own `as:summary`/`content`/`name` when
 * present, else a derived "<actor host> <label> <object host>" sentence. Never
 * returns an empty string.
 */
export function notificationTitle(n: InboxNotification): string {
  if (n.summary && n.summary.trim()) return n.summary.trim();
  const label = activityLabel(n.types);
  const who = n.actor ? hostOf(n.actor) : "Someone";
  const what = n.object ? ` ${hostOf(n.object)}` : "";
  return `${who} ${label}${what}`.trim();
}

/** Host portion of a URL for compact display; the raw value if it doesn't parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Format an `as:published` ISO timestamp for display, or undefined when absent /
 * unparseable. Uses the locale date+time (the view shows it in a muted caption).
 */
export function formatPublished(published?: string): string | undefined {
  if (!published) return undefined;
  const ms = Date.parse(published);
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
