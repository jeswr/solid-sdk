// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
// Cookie jar and session providers. The jar is a plain array of cookies (the shape
// Playwright's context.cookies() returns, so a profiler or fallback browser can
// hand its session over); matching follows RFC 6265 domain/path/secure rules.

import { randomUUID } from "node:crypto";
import { isLoopbackHost } from "./origin.js";

export interface Cookie {
  name: string;
  value: string;
  /** Host the cookie belongs to, without a leading dot. */
  domain: string;
  path: string;
  /** Expiry as Unix time in seconds; absent or negative = session cookie. */
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  /** True when the cookie was set without a Domain attribute (exact host only). */
  hostOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface SessionBundle {
  /** Opaque revision for compare-and-swap cookie updates. */
  revision?: string;
  cookies: Cookie[];
  /** Extra request headers (e.g. a bearer token from the vault). Sent only to the site origin. */
  headers?: Record<string, string>;
}

export interface SessionUpdate {
  accepted: boolean;
  revision?: string;
}

// biome-ignore lint/suspicious/noConfusingVoidType: Existing session providers return Promise<void>.
export type SessionUpdateResult = void | SessionUpdate;

export interface SessionProvider {
  get(site: string, persona?: string): Promise<SessionBundle | undefined>;
  update(
    site: string,
    persona: string | undefined,
    bundle: SessionBundle,
  ): Promise<SessionUpdateResult>;
}

function cloneBundle(bundle: SessionBundle): SessionBundle {
  return {
    ...(bundle.revision !== undefined ? { revision: bundle.revision } : {}),
    cookies: bundle.cookies.map((c) => ({ ...c })),
    ...(bundle.headers ? { headers: { ...bundle.headers } } : {}),
  };
}

/** An in-memory SessionProvider for tests and simple hosts. Keyed by site + persona. */
export class InMemorySessions implements SessionProvider {
  readonly #store = new Map<string, SessionBundle>();

  #key(site: string, persona?: string): string {
    return JSON.stringify([site, persona ?? null]);
  }

  async get(site: string, persona?: string): Promise<SessionBundle | undefined> {
    const bundle = this.#store.get(this.#key(site, persona));
    return bundle ? cloneBundle(bundle) : undefined;
  }

  async update(
    site: string,
    persona: string | undefined,
    bundle: SessionBundle,
  ): Promise<SessionUpdate> {
    const key = this.#key(site, persona);
    const current = this.#store.get(key);
    if (bundle.revision !== current?.revision) return { accepted: false };
    const revision = randomUUID();
    this.#store.set(key, { ...cloneBundle(bundle), revision });
    return { accepted: true, revision };
  }

  /** Seed a session (e.g. after the host signs in). */
  set(site: string, persona: string | undefined, bundle: SessionBundle): void {
    this.#store.set(this.#key(site, persona), { ...cloneBundle(bundle), revision: randomUUID() });
  }
}

function normaliseDomain(domain: string): string {
  return domain.replace(/^\./, "").toLowerCase();
}

/** RFC 6265 §5.1.3 domain-match. */
export function domainMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  const d = normaliseDomain(domain);
  if (h === d) return true;
  if (/^[\d.]+$/.test(h) || h.startsWith("[")) return false; // IP literals match exactly only
  return h.endsWith(`.${d}`);
}

/** RFC 6265 §5.1.4 path-match. */
export function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath.charAt(cookiePath.length) === "/";
}

function isExpired(cookie: Cookie, nowSeconds: number): boolean {
  return cookie.expires !== undefined && cookie.expires >= 0 && cookie.expires <= nowSeconds;
}

function isSecureTransport(url: URL): boolean {
  if (url.protocol === "https:") return true;
  // Browsers treat loopback as a secure context.
  return url.protocol === "http:" && isLoopbackHost(url.hostname);
}

/** Cookies from the jar that a browser would send to `url`. */
export function cookiesFor(jar: readonly Cookie[], url: URL, now: Date): Cookie[] {
  const nowSeconds = now.getTime() / 1000;
  const host = url.hostname;
  return jar.filter((c) => {
    if (isExpired(c, nowSeconds)) return false;
    if (
      c.hostOnly ? host.toLowerCase() !== normaliseDomain(c.domain) : !domainMatches(host, c.domain)
    ) {
      return false;
    }
    if (!pathMatches(url.pathname || "/", c.path || "/")) return false;
    if (c.secure && !isSecureTransport(url)) return false;
    return true;
  });
}

/** Serialise cookies into a Cookie request header value (longer paths first, per RFC 6265). */
export function cookieHeader(cookies: readonly Cookie[]): string {
  return [...cookies]
    .sort((a, b) => (b.path || "/").length - (a.path || "/").length)
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

function defaultPath(url: URL): string {
  const path = url.pathname;
  if (!path.startsWith("/")) return "/";
  const last = path.lastIndexOf("/");
  return last <= 0 ? "/" : path.slice(0, last);
}

/**
 * Parse one Set-Cookie header received from `url`. Returns undefined for a header
 * the user agent must ignore (bad syntax, or a Domain attribute that does not
 * domain-match the responding host).
 */
export function parseSetCookie(header: string, url: URL, now: Date): Cookie | undefined {
  const [pair, ...attrs] = header.split(";");
  if (pair === undefined) return undefined;
  const eq = pair.indexOf("=");
  if (eq <= 0) return undefined;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (name === "") return undefined;
  const cookie: Cookie = {
    name,
    value,
    domain: url.hostname.toLowerCase(),
    path: defaultPath(url),
    hostOnly: true,
  };
  let maxAge: number | undefined;
  for (const attr of attrs) {
    const i = attr.indexOf("=");
    const key = (i === -1 ? attr : attr.slice(0, i)).trim().toLowerCase();
    const val = i === -1 ? "" : attr.slice(i + 1).trim();
    switch (key) {
      case "domain": {
        if (val === "") break;
        const domain = normaliseDomain(val);
        if (!domainMatches(url.hostname, domain)) return undefined;
        cookie.domain = domain;
        cookie.hostOnly = false;
        break;
      }
      case "path":
        if (val.startsWith("/")) cookie.path = val;
        break;
      case "expires": {
        const t = Date.parse(val);
        if (!Number.isNaN(t)) cookie.expires = Math.floor(t / 1000);
        break;
      }
      case "max-age":
        if (/^-?\d+$/.test(val)) maxAge = Number(val);
        break;
      case "secure":
        cookie.secure = true;
        break;
      case "httponly":
        cookie.httpOnly = true;
        break;
      case "samesite": {
        const v = val.toLowerCase();
        if (v === "strict") cookie.sameSite = "Strict";
        else if (v === "lax") cookie.sameSite = "Lax";
        else if (v === "none") cookie.sameSite = "None";
        break;
      }
      default:
        break;
    }
  }
  if (maxAge !== undefined) {
    cookie.expires = maxAge <= 0 ? 0 : Math.floor(now.getTime() / 1000) + maxAge;
  }
  return cookie;
}

/**
 * Merge Set-Cookie headers into the jar (replacing same name/domain/path, removing
 * expired cookies). Returns the new jar and whether anything changed.
 */
export function applySetCookies(
  jar: readonly Cookie[],
  headers: readonly string[],
  url: URL,
  now: Date,
): { jar: Cookie[]; changed: boolean } {
  let next = jar.map((c) => ({ ...c }));
  let changed = false;
  const nowSeconds = now.getTime() / 1000;
  for (const header of headers) {
    const cookie = parseSetCookie(header, url, now);
    if (!cookie) continue;
    const same = (c: Cookie) =>
      c.name === cookie.name &&
      normaliseDomain(c.domain) === cookie.domain &&
      (c.path || "/") === cookie.path;
    next = next.filter((c) => !same(c));
    if (!isExpired(cookie, nowSeconds)) next.push(cookie);
    changed = true;
  }
  return { jar: next, changed };
}
