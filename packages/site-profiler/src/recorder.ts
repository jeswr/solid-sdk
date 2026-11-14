// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// Records every same-origin request a browser context makes, without credentials, and enforces the
// learning rule: outside a demonstration (or the user-authorised login) no non-GET request leaves
// the browser. Blocked requests are kept in the trace as evidence of candidate writes.

import { createHmac, randomBytes } from "node:crypto";
import {
  parseSetCookie,
  registerSecret,
  type SecretCookie,
  staleVerificationResponse,
  VERIFICATION_EVIDENCE_LIMIT,
} from "@jeswr/site-executor";
import type { BrowserContext, Request, Response } from "playwright";
import { formFields } from "./form-body.js";
import { isCsrfFieldName } from "./forms.js";
import { responseFlash, responsePageError } from "./response-evidence.js";
import { discoverCredentialSources } from "./session-tokens.js";
import type { Phase, RecordedRequest } from "./types.js";
import { isDangerousLink, isStatic, truncate } from "./util.js";
import { captureVerificationEvidence } from "./verification-evidence.js";

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
  /** Explicit credentials from evidence-only bodies and replay preparation; never returned. */
  readonly secrets = new Set<string>();
  private readonly concreteSecrets = new Set<string>();
  private readonly selectorSecrets = new Map<string, Set<string>>();
  private seq = 0;
  private readonly contextKey = randomBytes(32);
  private readonly pending = new Set<Promise<void>>();
  private readonly entries = new Map<Request, RecordedRequest>();
  private readonly blocked = new WeakSet<Request>();

  constructor(
    readonly siteOrigin: string,
    private readonly onCookie?: (cookie: SecretCookie, loginResponse: boolean) => void,
  ) {}

  /** Opaque within this profiling run, with a random key preventing guesses of short credentials. */
  authenticationContext(
    headers: Record<string, string>,
    cookies?: readonly SecretCookie[],
  ): string {
    const h = new Headers(headers);
    const cookiePairs = cookies
      ? cookies.map((cookie) => [cookie.name, cookie.value])
      : parseCookieHeader(h.get("cookie") ?? undefined);
    const credentials = [...h].filter(
      ([name]) =>
        name === "authorization" ||
        name === "proxy-authorization" ||
        (SENSITIVE_HEADER.test(name) && !/csrf|xsrf|form.?key/i.test(name)),
    );
    return createHmac("sha256", this.contextKey)
      .update(JSON.stringify([cookiePairs.sort(), credentials.sort()]))
      .digest("hex");
  }

  /** Register raw cookie intake without retaining it in the returned trace. */
  rememberCookies(cookies: readonly SecretCookie[]): void {
    for (const cookie of cookies) this.onCookie?.(cookie, false);
  }

  rememberSecret(value: string): void {
    registerSecret(this.secrets, value);
    registerSecret(this.concreteSecrets, value);
  }

  /** Resolve possible selector credentials against the final page witnesses. Actual
   * credential values always remain secrets, even if they also name a valid selector. */
  finalSecrets(pages: Array<{ url: string; html: string }>): Set<string> {
    const candidates: RecordedRequest = {
      seq: -1,
      phase: this.phase,
      method: "GET",
      url: this.siteOrigin,
      resourceType: "credential-candidates",
      requestHeaders: {},
      cookieNames: [],
      contentType: "application/json",
      bodySample: JSON.stringify(
        [...this.selectorSecrets.keys()].map((value) => ({ tokenSelector: value })),
      ),
    };
    const resolved = discoverCredentialSources(
      pages,
      [],
      [...this.trace.filter((r) => /html/i.test(r.contentType ?? "")), candidates],
    ).secrets;
    return new Set([
      ...this.concreteSecrets,
      ...resolved,
      ...[...this.selectorSecrets].flatMap(([value, spellings]) =>
        resolved.has(value) ? [...spellings] : [],
      ),
    ]);
  }

  /** Every body passes here before sampling or evidence use. Retain discoveries only.
   * Oversized bodies still supply their bounded prefix for credential discovery. */
  responseBody(
    body: string | Uint8Array,
    metadata: Pick<RecordedRequest, "url" | "contentType" | "resourceType">,
  ): string {
    const bytes =
      typeof body === "string"
        ? Buffer.from(body)
        : Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    const prefix = bytes.subarray(0, VERIFICATION_EVIDENCE_LIMIT).toString("utf8");
    const contentType = /^\s*</.test(prefix)
      ? "text/html"
      : /^\s*[[{]/.test(prefix)
        ? "application/json"
        : metadata.contentType;
    const source: RecordedRequest = {
      seq: -1,
      phase: this.phase,
      method: "GET",
      requestHeaders: {},
      cookieNames: [],
      ...metadata,
      contentType,
      bodySample: prefix,
    };
    const discovered = discoverCredentialSources([], [], [source], {}, (value, sourceSpelling) => {
      const spellings = this.selectorSecrets.get(value) ?? new Set<string>();
      registerSecret(spellings, value);
      if (sourceSpelling !== undefined) registerSecret(spellings, sourceSpelling);
      if (spellings.size) this.selectorSecrets.set(value, spellings);
      for (const spelling of spellings) registerSecret(this.secrets, spelling);
    });
    for (const secret of discovered.secrets) this.rememberSecret(secret);
    if (bytes.byteLength > VERIFICATION_EVIDENCE_LIMIT)
      throw new Error("Profiler response byte limit exceeded");
    return prefix;
  }

  /** Bound Fetch streams; Playwright has already buffered its response body. Failed
   * streams supply credential discoveries from their prefix, never partial evidence. */
  async readResponseBody(
    response: globalThis.Response | { body(): Promise<Buffer> },
    metadata: Pick<RecordedRequest, "url" | "contentType" | "resourceType">,
  ): Promise<string> {
    if (typeof response.body === "function")
      return this.responseBody(await response.body(), metadata);
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          // One extra byte distinguishes an oversized body without retaining it.
          const prefix = value.subarray(0, VERIFICATION_EVIDENCE_LIMIT + 1 - size);
          chunks.push(prefix);
          size += prefix.byteLength;
          if (size > VERIFICATION_EVIDENCE_LIMIT)
            throw new Error("Profiler response byte limit exceeded");
        }
      }
      const body = this.responseBody(Buffer.concat(chunks), metadata);
      const headers = (response as globalThis.Response).headers;
      const length = headers.get("content-length");
      if (
        !headers.has("content-encoding") &&
        length !== null &&
        /^\d+$/.test(length) &&
        size !== Number(length)
      )
        throw new Error("Profiler response ended early");
      return body;
    } catch (error) {
      // Discover even when the stream is oversized or failed before completion.
      try {
        this.responseBody(Buffer.concat(chunks), metadata);
      } catch {
        // The bounded prefix was scanned before rejecting the oversized body.
      }
      await reader?.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader?.releaseLock();
    }
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
      this.complete(entry);
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
    entry.authenticationContext = this.authenticationContext(headers);
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

  /** Note when a response completed on the request clock, before any asynchronous work. */
  private complete(entry: RecordedRequest | undefined): void {
    if (entry && entry.completedAt === undefined) entry.completedAt = this.seq;
  }

  private async onResponse(res: Response): Promise<void> {
    const entry = this.entries.get(res.request());
    if (!entry) return;
    this.complete(entry);
    entry.status = res.status();
    const headers = await res.allHeaders().catch(() => res.headers());
    const authenticationFailure =
      headers["www-authenticate"] !== undefined || headers["proxy-authenticate"] !== undefined;
    const stale = staleVerificationResponse(headers);
    if (authenticationFailure || stale) entry.responsePageFailure = true;
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
    try {
      const body = await this.readResponseBody(res, entry);
      if (entry.status >= 300 && entry.status < 400) return;
      if (!TEXT_TYPES.test(entry.contentType ?? "")) return;
      if (entry.phase === "demonstration" && /html|json/i.test(entry.contentType ?? "")) {
        // A neutral success notice is a flash, not a page error. Creation still
        // rejects every flash via the complete inventory when learning policies.
        entry.responsePageError = responsePageError(body, entry.contentType, false);
        entry.responsePageFailure =
          authenticationFailure || stale || responsePageError(body, entry.contentType, false);
        entry.responseFlash = responseFlash(body, entry.contentType);
        captureVerificationEvidence(entry, body);
      }
      const t = truncate(body, BODY_LIMIT);
      entry.bodySample = t.text;
      if (t.truncated) entry.bodyTruncated = true;
    } catch {
      entry.responsePageFailure = true;
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
    const stamp = this.stamp();
    const full: RecordedRequest = {
      ...stamp,
      // A profiler replay is recorded after its response arrived.
      completedAt: stamp.seq + 1,
      cookieNames: entry.cookieNames ?? [],
      ...entry,
      requestHeaders: sanitiseHeaders(entry.requestHeaders ?? {}).requestHeaders,
    };
    if (full.bodySample !== undefined) {
      try {
        const body = this.responseBody(full.bodySample, full);
        const t = truncate(body, BODY_LIMIT);
        full.bodySample = t.text;
        if (t.truncated) full.bodyTruncated = true;
      } catch {
        delete full.bodySample;
        delete full.verificationEvidence;
        delete full.notFoundEvidence;
        delete full.formState;
        delete full.responseFlash;
        full.bodyTruncated = true;
        full.responsePageFailure = true;
      }
    }
    this.trace.push(full);
    return full;
  }
}
