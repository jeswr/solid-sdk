/**
 * Shared provider-adapter plumbing: bounded HTTP, token acquisition with minimum-scope checks,
 * and time conversion. Every failure becomes a `SourceFailure` (fail closed), never data.
 */
import type { Slot } from "../../pilot/domains/scheduling.js";
import { localParts } from "../../pilot/domains/scheduling.js";
import { type AccessTokenProvider, CredentialError, type ProviderFamily } from "./credentials.js";

export const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 1024 * 1024;

/** How the process reaches providers: live (configured), fixture (synthetic) or not at all. */
export interface ProviderEnvironment {
  mode: "live" | "fixture" | "none";
  fetch: typeof fetch;
  tokens?: AccessTokenProvider;
}

export interface SourceSuccess {
  ok: true;
  busy: Slot[];
  /** The window the provider data demonstrably covers. */
  covered: Slot;
  fetchedAt: string;
  detail: string;
}
export interface SourceFailure {
  ok: false;
  status: "blocked" | "needs-setup";
  reason: string;
}
export type SourceResult = SourceSuccess | SourceFailure;

export const failure = (status: SourceFailure["status"], reason: string): SourceFailure => ({
  ok: false,
  status,
  reason,
});

export class ProviderCallError extends Error {
  constructor(
    readonly status: SourceFailure["status"],
    message: string,
  ) {
    super(message);
  }
}

/** Get a token for `connectionId` and check the granted scopes against the accepted ones. */
export async function tokenFor(
  env: ProviderEnvironment,
  provider: ProviderFamily,
  connectionId: string,
  minimum: readonly string[],
  accepted: readonly string[],
): Promise<string> {
  if (!env.tokens)
    throw new ProviderCallError("needs-setup", "no credential provider is configured");
  let t: Awaited<ReturnType<AccessTokenProvider["getAccessToken"]>>;
  try {
    t = await env.tokens.getAccessToken({ provider, connectionId, scopes: minimum });
  } catch (error) {
    if (error instanceof CredentialError)
      throw new ProviderCallError(
        error.code === "unavailable" ? "blocked" : "needs-setup",
        error.message,
      );
    throw new ProviderCallError("blocked", "the credential provider failed");
  }
  // The contract is enforced here too, whatever the credential provider checked.
  if (typeof t.token !== "string" || !/^[\x21-\x7e]{8,8192}$/.test(t.token))
    throw new ProviderCallError("blocked", "the credential provider returned an unusable token");
  if (t.expiresAt !== undefined) {
    const exp = parseRfc3339(t.expiresAt);
    if (exp === undefined)
      throw new ProviderCallError("blocked", "the credential provider returned an invalid expiry");
    if (exp <= Date.now())
      throw new ProviderCallError(
        "needs-setup",
        "the credential provider returned an expired token",
      );
  }
  if (t.grantedScopes) {
    const norm = (s: string) => s.replace(/^https:\/\/graph\.microsoft\.com\//, "").toLowerCase();
    const granted = new Set(t.grantedScopes.map(norm));
    if (!accepted.some((s) => granted.has(norm(s))))
      throw new ProviderCallError(
        "needs-setup",
        `the granted scopes do not include a calendar availability scope (${minimum.join(", ")})`,
      );
  }
  return t.token;
}

/** One bounded HTTP exchange; maps status codes to fail-closed reasons. */
export async function fetchJson(
  env: ProviderEnvironment,
  url: string,
  init: RequestInit,
  what: string,
): Promise<unknown> {
  let res: Response;
  try {
    res = await env.fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const name = (error as Error)?.name;
    throw new ProviderCallError(
      "blocked",
      name === "TimeoutError" || name === "AbortError"
        ? `${what}: no answer within ${REQUEST_TIMEOUT_MS / 1000} s`
        : `${what}: could not reach the provider`,
    );
  }
  if (res.status !== 200) {
    await res.body?.cancel();
    const reason =
      res.status === 401
        ? "access token rejected (expired or revoked)"
        : res.status === 403
          ? "access denied or insufficient scope"
          : res.status === 404
            ? "calendar not found or not shared with this account"
            : res.status === 429
              ? "rate limited"
              : `provider answered HTTP ${res.status}`;
    throw new ProviderCallError(
      res.status === 401 || res.status === 403 ? "needs-setup" : "blocked",
      `${what}: ${reason}`,
    );
  }
  if (!/^application\/json\b/i.test(res.headers.get("content-type") ?? "")) {
    await res.body?.cancel();
    throw new ProviderCallError("blocked", `${what}: the answer was not JSON`);
  }
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ProviderCallError("blocked", `${what}: answer too large`);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof ProviderCallError) throw error;
    throw new ProviderCallError("blocked", `${what}: the answer could not be read`);
  }
}

/** The UTC instant of a wall-clock time in an IANA zone (DST-aware; iterative on offsets). */
export function zonedToUtc(date: string, minutes: number, timeZone: string): number {
  const [y, m, d] = date.split("-").map((x) => Number.parseInt(x, 10)) as [number, number, number];
  const wanted = Date.UTC(y, m - 1, d) + minutes * 60_000;
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(guess), timeZone);
    const [py, pm, pd] = p.date.split("-").map((x) => Number.parseInt(x, 10)) as [
      number,
      number,
      number,
    ];
    const actual = Date.UTC(py, pm - 1, pd) + p.minutes * 60_000;
    if (actual === wanted) break;
    guess += wanted - actual;
  }
  return guess;
}

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** True for a real calendar date (no 31 February, no month 13). */
export function validDate(y: number, m: number, d: number): boolean {
  return y >= 1 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);
}

const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(?:Z|z|[+-](\d{2}):(\d{2}))$/;
/**
 * Strict RFC 3339 date-time (date, time and offset required; real calendar values only).
 * `Date.parse` alone accepts bare years and normalises impossible days, so it is not used alone.
 */
export function parseRfc3339(v: string): number | undefined {
  const m = RFC3339.exec(v);
  if (!m) return undefined;
  const n = m.slice(1).map((x) => (x === undefined ? 0 : Number.parseInt(x, 10)));
  const [y, mo, d, h, mi, s] = n as [number, number, number, number, number, number];
  const [oh, om] = [n[7] ?? 0, n[8] ?? 0];
  if (!validDate(y, mo, d) || h > 23 || mi > 59 || s > 59 || oh > 23 || om > 59) return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

/** A floating wall-clock value "YYYY-MM-DDTHH:MM[:SS[.fraction]]" with real components. */
export function parseWallClock(
  v: string,
): { date: string; minutes: number; ms: number } | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,7})?)?$/.exec(v);
  if (!m) return undefined;
  const [y, mo, d, h, mi] = m.slice(1, 6).map((x) => Number.parseInt(x as string, 10)) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const s = m[6] ? Number.parseInt(m[6], 10) : 0;
  if (!validDate(y, mo, d) || h > 23 || mi > 59 || s > 59) return undefined;
  const frac = m[7] ? Math.floor(Number(`0${m[7]}`) * 1000) : 0;
  return { date: v.slice(0, 10), minutes: h * 60 + mi, ms: s * 1000 + frac };
}

/**
 * The UTC instant of a wall-clock time in an IANA zone, CHECKED: a time that does not exist
 * (skipped by a DST change) gives undefined; an ambiguous time (repeated by a DST change) gives
 * the earliest or latest instant as asked — callers widen busy time with it.
 */
export function zonedToUtcChecked(
  date: string,
  minutes: number,
  timeZone: string,
  prefer: "earliest" | "latest",
): number | undefined {
  const matches = (t: number) => {
    const p = localParts(new Date(t), timeZone);
    return p.date === date && p.minutes === minutes;
  };
  const guess = zonedToUtc(date, minutes, timeZone);
  if (!matches(guess)) return undefined;
  const candidates = [guess - 3_600_000, guess, guess + 3_600_000].filter(matches);
  return prefer === "earliest" ? Math.min(...candidates) : Math.max(...candidates);
}

/** Next calendar date (YYYY-MM-DD). */
export function nextDate(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`) + 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Clip to a window and drop empty intervals. */
export function clip(busy: readonly Slot[], window: Slot): Slot[] {
  const a = Date.parse(window.start);
  const b = Date.parse(window.end);
  const out: Slot[] = [];
  for (const s of busy) {
    const x = Math.max(a, Date.parse(s.start));
    const y = Math.min(b, Date.parse(s.end));
    if (y > x) out.push({ start: new Date(x).toISOString(), end: new Date(y).toISOString() });
  }
  return out;
}
