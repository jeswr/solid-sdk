// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// Records every same-origin request a browser context makes, without credentials, and enforces the
// learning rule: outside a demonstration (or the user-authorised login) no non-GET request leaves
// the browser. Blocked requests are kept in the trace as evidence of candidate writes.

import { parseSetCookie, type SecretCookie } from "@jeswr/site-executor";
import type { BrowserContext, Request, Response } from "playwright";
import { formFields } from "./form-body.js";
import { isCsrfFieldName } from "./forms.js";
import { responseFlash, responsePageError } from "./response-evidence.js";
import type { Phase, RecordedRequest } from "./types.js";
import { isDangerousLink, isStatic, truncate } from "./util.js";

export const BODY_LIMIT = 256 * 1024;

const SENSITIVE_FIELD =
  /pass(word)?|pwd|secret|token|csrf|xsrf|otp|cvv|cvc|card-?number|cardnumber|form[_-]?key|pin$/i;
const SENSITIVE_HEADER = /csrf|xsrf|token|api-?key|secret|session/i;
const TEXT_TYPES = /text\/|json|javascript|xml|x-www-form-urlencoded/i;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function parseCookieHeader(header: string | undefined): Array<[string, string]> {
  if (!header) return [];
  return header
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf("=");
      return (i > 0 ? [p.slice(0, i), p.slice(i + 1)] : [p, ""]) as [string, string];
    });
}

/** Replace the values of credential-like fields in a form or JSON body. */
export function redactBody(
  body: string | undefined,
  contentType: string | undefined,
): string | undefined {
  if (body === undefined) return undefined;
  if (/multipart\/form-data/i.test(contentType ?? "")) {
    const fields = formFields(body, contentType ?? "");
    if (!fields) return "[omitted: unsupported multipart]";
    const boundary = /\bboundary=(?:"([^"\r\n]+)"|([^;\s]+))/i.exec(contentType ?? "");
    const marker = boundary?.[1] ?? boundary?.[2];
    return `${fields
      .map(
        ([name, value]) =>
          `--${marker}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${SENSITIVE_FIELD.test(name) ? "[redacted]" : value}\r\n`,
      )
      .join("")}--${marker}--\r\n`;
  }
  if (/json/i.test(contentType ?? "") || /^\s*\{/.test(body)) {
    try {
      const parsed = JSON.parse(body) as unknown;
      const walk = (v: unknown): unknown => {
        if (Array.isArray(v)) return v.map(walk);
        if (v !== null && typeof v === "object") {
          return Object.fromEntries(
            Object.entries(v).map(([k, x]) => [
              k,
              SENSITIVE_FIELD.test(k) ? "[redacted]" : walk(x),
            ]),
          );
        }
        return v;
      };
      return JSON.stringify(walk(parsed));
    } catch {
      // fall through to form handling
    }
  }
  if (/x-www-form-urlencoded/i.test(contentType ?? "") || /^[^\s=&]+=[^\s]*$/.test(body)) {
    const params = new URLSearchParams(body);
    const out = new URLSearchParams();
    for (const [k, v] of params) out.append(k, SENSITIVE_FIELD.test(k) ? "[redacted]" : v);
    return out.toString();
  }
  return body;
}

/** Strip credentials from request headers; report cookie names, auth scheme and cookie-copied headers. */
export function sanitiseHeaders(headers: Record<string, string>): {
  requestHeaders: Record<string, string>;
  cookieNames: string[];
  authScheme?: string;
  headersFromCookies: Record<string, string>;
} {
  const cookies = parseCookieHeader(headers.cookie);
  const requestHeaders: Record<string, string> = {};
  const headersFromCookies: Record<string, string> = {};
  let authScheme: string | undefined;
  for (const [rawName, value] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (name === "cookie" || name === "proxy-authorization") continue;
    if (name === "authorization") {
      authScheme = /^(\S+)/.exec(value)?.[1];
      continue;
    }
    const fromCookie = value.length >= 8 ? cookies.find(([, v]) => v === value)?.[0] : undefined;
    if (fromCookie) headersFromCookies[name] = fromCookie;
    requestHeaders[name] = fromCookie || SENSITIVE_HEADER.test(name) ? "[redacted]" : value;
  }
  const out: ReturnType<typeof sanitiseHeaders> = {
    requestHeaders,
    cookieNames: cookies.map(([n]) => n),
    headersFromCookies,
  };
  if (authScheme) out.authScheme = authScheme;
  return out;
}

export class Recorder {
  phase: Phase = "crawl";
  /** Only the chosen password form may send a write during login. */
  loginTarget: string | undefined;
  demonstration: string | undefined;
  readonly trace: RecordedRequest[] = [];
  private seq = 0;
  private readonly pending = new Set<Promise<void>>();
  private readonly entries = new Map<Request, RecordedRequest>();
  private readonly blocked = new WeakSet<Request>();

  constructor(
    readonly siteOrigin: string,
    private readonly onCookie?: (cookie: SecretCookie, loginResponse: boolean) => void,
  ) {}

  /** Register raw cookie intake without retaining it in the returned trace. */
  rememberCookies(cookies: readonly SecretCookie[]): void {
    for (const cookie of cookies) this.onCookie?.(cookie, false);
  }

  rememberSetCookies(lines: readonly string[], url: string, loginResponse = false): void {
    for (const line of lines) {
      const cookie = parseSetCookie(line, new URL(url), new Date());
      if (cookie) this.onCookie?.(cookie, loginResponse);
    }
  }

  /** True while non-GET requests may leave the browser. */
  writesAllowed(): boolean {
    return this.phase === "demonstration" || this.phase === "login";
  }

  async attach(context: BrowserContext): Promise<void> {
    await context.route("**/*", async (route) => {
      const req = route.request();
      const unsafeGet =
        req.method() === "GET" &&
        ["document", "xhr", "fetch"].includes(req.resourceType()) &&
        !isStatic(req.url(), req.resourceType()) &&
        isDangerousLink(req.url());
      const allowedWrite =
        this.phase === "demonstration" ||
        (this.phase === "login" && req.method() === "POST" && req.url() === this.loginTarget);
      if (
        (unsafeGet && !this.writesAllowed()) ||
        (!SAFE_METHODS.has(req.method().toUpperCase()) && !allowedWrite)
      ) {
        this.blocked.add(req);
        const entry = this.entries.get(req);
        if (entry) entry.blocked = true;
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    context.on("request", (req) => this.track(this.onRequest(req)));
    context.on("response", (res) => this.track(this.onResponse(res)));
    context.on("requestfailed", (req) => {
      const entry = this.entries.get(req);
      if (entry && this.blocked.has(req)) entry.blocked = true;
    });
  }

  private track(p: Promise<void>): void {
    this.pending.add(p);
    p.finally(() => this.pending.delete(p)).catch(() => undefined);
  }

  /** Wait for every in-flight request and response body to be recorded. */
  async flush(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  private stamp(): Pick<RecordedRequest, "seq" | "phase" | "demonstration"> {
    const base: Pick<RecordedRequest, "seq" | "phase" | "demonstration"> = {
      seq: this.seq++,
      phase: this.phase,
    };
    if (this.phase === "demonstration" && this.demonstration)
      base.demonstration = this.demonstration;
    return base;
  }

  private async onRequest(req: Request): Promise<void> {
    let origin: string;
    try {
      origin = new URL(req.url()).origin;
    } catch {
      return;
    }
    if (origin !== this.siteOrigin) return;
    const entry: RecordedRequest = {
      ...this.stamp(),
      method: req.method().toUpperCase(),
      url: req.url(),
      resourceType: req.resourceType(),
      requestHeaders: {},
      cookieNames: [],
    };
    if (this.blocked.has(req)) entry.blocked = true;
    const previous = req.redirectedFrom();
    const parent = previous && this.entries.get(previous);
    if (parent) entry.redirectedFrom = parent.seq;
    this.entries.set(req, entry);
    this.trace.push(entry);
    const headers = await req.allHeaders().catch(() => req.headers());
    for (const [name, value] of parseCookieHeader(headers.cookie))
      this.onCookie?.({ name, value }, false);
    const clean = sanitiseHeaders(headers);
    entry.requestHeaders = clean.requestHeaders;
    entry.cookieNames = clean.cookieNames;
    if (clean.authScheme) entry.authScheme = clean.authScheme;
    if (Object.keys(clean.headersFromCookies).length)
      entry.headersFromCookies = clean.headersFromCookies;
    const post = req.postData();
    if (post !== null) {
      if (Buffer.byteLength(post) > BODY_LIMIT) {
        entry.postDataTruncated = true;
      } else {
        const type = headers["content-type"] ?? "";
        const fields = formFields(post, type);
        if (/multipart\/form-data/i.test(type) && !fields) entry.postDataUnsupported = true;
        const bodyFromCookies: Record<string, string> = {};
        for (const [key, value] of fields ?? []) {
          if (!isCsrfFieldName(key)) continue;
          const cookie = parseCookieHeader(headers.cookie).find(
            ([, v]) => v === value && value !== "",
          );
          if (cookie) bodyFromCookies[key] = cookie[0];
        }
        if (Object.keys(bodyFromCookies).length) entry.bodyFromCookies = bodyFromCookies;
        const redacted = redactBody(post, type);
        if (redacted !== undefined) entry.postData = redacted;
      }
    }
  }

  private async onResponse(res: Response): Promise<void> {
    const entry = this.entries.get(res.request());
    if (!entry) return;
    entry.status = res.status();
    const headers = await res.allHeaders().catch(() => res.headers());
    if (headers["content-type"]) entry.contentType = headers["content-type"];
    if (headers.location) entry.redirectedTo = new URL(headers.location, entry.url).toString();
    const setCookies = (await res.headersArray().catch(() => []))
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => {
        this.rememberSetCookies(
          [h.value],
          entry.url,
          entry.phase === "login" && entry.method === "POST" && entry.url === this.loginTarget,
        );
        return h.value.split("=")[0]?.trim() ?? "";
      })
      .filter(Boolean);
    if (setCookies.length) entry.setCookieNames = setCookies;
    if (entry.status >= 300 && entry.status < 400) return;
    if (!TEXT_TYPES.test(entry.contentType ?? "")) return;
    try {
      const body = await res.text();
      if (entry.phase === "demonstration" && /html|json/i.test(entry.contentType ?? "")) {
        entry.responsePageError = responsePageError(body, entry.contentType);
        entry.responsePageFailure = responsePageError(body, entry.contentType, false);
        entry.responseFlash = responseFlash(body, entry.contentType);
      }
      const t = truncate(body, BODY_LIMIT);
      entry.bodySample = t.text;
      if (t.truncated) entry.bodyTruncated = true;
    } catch {
      // Bodies of pages that navigated away are not always available; the request still counts.
    }
  }

  /** Record a request the profiler made itself (probe or verification replay). */
  recordReplay(
    entry: Omit<RecordedRequest, "seq" | "phase" | "requestHeaders" | "cookieNames"> & {
      cookieNames?: string[];
      requestHeaders?: Record<string, string>;
    },
  ): RecordedRequest {
    const full: RecordedRequest = {
      ...this.stamp(),
      cookieNames: entry.cookieNames ?? [],
      ...entry,
      requestHeaders: sanitiseHeaders(entry.requestHeaders ?? {}).requestHeaders,
    };
    if (full.bodySample !== undefined) {
      const t = truncate(full.bodySample, BODY_LIMIT);
      full.bodySample = t.text;
      if (t.truncated) full.bodyTruncated = true;
    }
    this.trace.push(full);
    return full;
  }
}
