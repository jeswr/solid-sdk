// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// internal/initials — the ONE avatar-fallback "initials from a person's display
// name" implementation, shared by the two PUBLIC helpers that wrap it:
//   • `initials(name)`   from <jeswr-account-menu> (name-only), and
//   • `initialsOf(value)` from <jeswr-login-panel> (URL-aware: it derives initials
//     from a WebID host, and falls back to THIS for a non-URL name).
//
// Both public helpers had a byte-identical copy of this name → initials logic
// (jscpd flagged it). It is genuinely-identical logic with the SAME change-reason
// (how the suite renders an avatar fallback), so it is consolidated to one reviewed
// place here. INTERNAL (not exported from any package entry) — the two public
// functions keep their existing names + import paths, so the public API is unchanged.

/**
 * Two-letter uppercase initials from a person's display name:
 *   - empty / whitespace-only → "?"
 *   - one word → its first two letters
 *   - several words → first letter of the FIRST + first letter of the LAST word
 */
export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
