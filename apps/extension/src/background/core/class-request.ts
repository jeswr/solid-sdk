// AUTHORED-BY Claude Opus 4.8
/**
 * PURE parsing + validation of a `requestAccess({classes, modes, purpose, duration})` payload
 * (design §4.2). The page can send anything — this normalises the untrusted input into a
 * bounded, well-formed grant specification, or an error. Fail-closed:
 *   - a data class must be an `https:` (or dev-loopback `http:`) IRI; a non-IRI class is dropped,
 *     and a request with NO valid class is rejected;
 *   - modes must include at least one recognised mode;
 *   - a bounded `duration` is REQUIRED — a grant with no expiry can never be minted (design
 *     item 3, "expiry enforced"); an unparseable/absent/zero/negative duration is rejected;
 *   - the duration is capped at {@link MAX_GRANT_MS} so a page cannot request an effectively
 *     unbounded grant.
 *
 * No `chrome.*` / `fetch` / storage here — this is exhaustively unit-testable.
 */

import { type GrantMode, normaliseModes } from './class-grant';

/** The hard ceiling on a grant's lifetime: 365 days. A longer request is clamped to this. */
export const MAX_GRANT_MS = 365 * 24 * 60 * 60 * 1000;

/** The raw, untrusted request payload as it arrives from the page bridge. */
export interface RawAccessRequest {
  readonly classes?: unknown;
  readonly modes?: unknown;
  readonly purpose?: unknown;
  readonly duration?: unknown;
}

/** A validated, bounded grant specification derived from a raw request. */
export interface AccessRequestSpec {
  /** The valid, deduped data-class IRIs requested. */
  readonly classes: readonly string[];
  /** The recognised, deduped modes requested. */
  readonly modes: readonly GrantMode[];
  /** The declared purpose (kept verbatim as an audit anchor), or `null`. */
  readonly purpose: string | null;
  /** Absolute expiry for a grant minted now, epoch ms (`now + clamped(duration)`). */
  readonly expiresAt: number;
  /** The (clamped) grant lifetime in ms — surfaced in the consent UI. */
  readonly durationMs: number;
}

function isHttpIri(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  return u.protocol === 'https:' || u.protocol === 'http:';
}

/**
 * Parse an ISO-8601 duration to milliseconds, or `null` if it is not a positive, bounded
 * duration. Supports the date part `P[nY][nM][nW][nD]` and the time part `T[nH][nM][nS]`
 * (fractional seconds allowed). Year/month are approximated (Y = 365d, month = 30d) — a
 * documented imprecision acceptable for an access-grant TTL — and any such approximation is in
 * any case clamped by {@link MAX_GRANT_MS} at the caller. Returns `null` for `P`/empty/zero/
 * negative/NaN (fail-closed — the caller then rejects the request).
 */
export function parseIso8601DurationMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m =
    /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      value.trim(),
    );
  if (!m) return null;
  const [, y, mo, w, d, h, min, s] = m;
  // Require at least ONE component present (a bare "P" / "PT" is meaningless → reject).
  if ([y, mo, w, d, h, min, s].every((p) => p === undefined)) return null;
  const num = (p: string | undefined): number => (p === undefined ? 0 : Number.parseFloat(p));
  const ms =
    num(y) * 365 * 24 * 60 * 60 * 1000 +
    num(mo) * 30 * 24 * 60 * 60 * 1000 +
    num(w) * 7 * 24 * 60 * 60 * 1000 +
    num(d) * 24 * 60 * 60 * 1000 +
    num(h) * 60 * 60 * 1000 +
    num(min) * 60 * 1000 +
    num(s) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms;
}

/**
 * Normalise + validate a raw `requestAccess` payload against `now`. Returns the bounded spec,
 * or `{ error }` describing the first fatal problem. Fail-closed on every axis (see file note).
 */
export function normaliseAccessRequest(
  raw: RawAccessRequest,
  now: number,
): AccessRequestSpec | { error: string } {
  const rawClasses = Array.isArray(raw.classes) ? raw.classes : [];
  const classes: string[] = [];
  for (const c of rawClasses) {
    if (isHttpIri(c) && !classes.includes(c)) classes.push(c);
  }
  if (classes.length === 0) {
    return { error: 'requestAccess: at least one https: data-class IRI is required.' };
  }

  const modes = normaliseModes(raw.modes);
  if (modes.length === 0) {
    return { error: 'requestAccess: at least one of read/append/write modes is required.' };
  }

  const durationMs = parseIso8601DurationMs(raw.duration);
  if (durationMs === null) {
    return { error: 'requestAccess: a positive ISO-8601 duration (e.g. "P30D") is required.' };
  }
  const clamped = Math.min(durationMs, MAX_GRANT_MS);

  const purpose =
    typeof raw.purpose === 'string' && raw.purpose.trim().length > 0 ? raw.purpose.trim() : null;

  return { classes, modes, purpose, expiresAt: now + clamped, durationMs: clamped };
}
