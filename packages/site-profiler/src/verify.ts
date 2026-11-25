// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// Step 9: verification. Replays each learned read with observed values, signed out and (when a
// session exists) signed in. Sets the session requirement and provenance counters, flags reads whose
// extraction finds nothing, and drops reads that fail both ways. Never replays a write.

import {
  type CookieSecretContext,
  guardUrl,
  isLoginCredentialCookie,
  jsonEnvelope,
  jsonFailure,
  jsonRootFailure,
} from "@jeswr/site-executor";
import type { CsrfRule, Operation, RequestTemplate } from "@jeswr/site-model";
import { applyExtraction } from "./extraction.js";
import { parseForms } from "./forms.js";
import { attr, attrValue, parseHtml, selectAll } from "./html.js";
import type { Recorder } from "./recorder.js";
import { matchRequest } from "./templates.js";
import type { RecordedRequest } from "./types.js";
import { expandTemplate, jsonPointer } from "./util.js";

export interface ReplayResponse {
  status: number;
  contentType?: string;
  body: string;
  location?: string;
  authenticationFailure?: boolean;
}

/** Sends GET requests for verification; signed-in replays carry the profiling session. */
export interface Replayer {
  get(
    url: string,
    opts: {
      signedIn: boolean;
      headers?: Record<string, string>;
      request?: RequestTemplate;
      csrf?: CsrfRule[];
      values?: Record<string, string>;
      /** Authorize each actual URL, including preparatory CSRF requests, before transmission. */
      authorize?: (url: string) => Promise<void>;
      /**
       * With `signedIn: false`: a credentials-only control. The request carries the signed-in
       * context's cookies minus those with positive login evidence (`isLoginCredentialCookie`:
       * cookies the login set or changed, and declared credentials), and no session headers,
       * so it differs from the signed-in read only by its credentials. With no such cookie to
       * drop it is not sent (the call rejects): without login evidence there is no control.
       */
      credentialsOnly?: boolean;
      /**
       * Marks a fetch that verifies a redirect target as a login route: the credentials-only
       * control (and its one hop), or the signed-in fetch showing how the signed-in context
       * is served that target.
       */
      loginRouteProbe?: { hopOf?: string };
    },
  ): Promise<ReplayResponse>;
}

const ok = (r: ReplayResponse | undefined) => r !== undefined && r.status >= 200 && r.status < 300;

/** Values to replay an operation with: its examples, then defaults. Undefined when a required value is missing. */
export function sampleValues(op: Operation): Record<string, string> | undefined {
  const values: Record<string, string> = {};
  for (const p of op.inputs) {
    const v = p.example ?? p.default;
    if (v !== undefined) values[p.name] = v;
    else if (p.required) return undefined;
  }
  return values;
}

export interface VerifyOptions {
  replayer: Replayer;
  now: () => Date;
  /** True when the profiler holds a signed-in session. */
  haveSession: boolean;
  /** Credential-redacted requests recorded before verification, used only for their own operation. */
  recordedRequests?: readonly RecordedRequest[];
}

/** Keep each successful request's values together; never build a tuple from independent pools. */
function recordedValues(
  op: Operation,
  requests: readonly RecordedRequest[],
): Record<string, string>[] {
  const values: Record<string, string>[] = [];
  const seenUrls = new Set<string>();
  const rank = (r: RecordedRequest) =>
    r.phase === "demonstration" ? 0 : r.phase === "crawl" ? 1 : 2;
  for (const r of [...requests].sort((a, b) => rank(a) - rank(b))) {
    if (
      r.blocked ||
      r.resourceType === "replay-anonymous" ||
      r.status === undefined ||
      r.status < 200 ||
      r.status >= 300
    )
      continue;
    const matched = matchRequest(op.request, r);
    if (!matched || op.inputs.some((p) => p.required && matched[p.name] === undefined)) continue;
    const tuple = Object.fromEntries(
      op.inputs.flatMap((p) =>
        matched[p.name] === undefined ? [] : [[p.name, matched[p.name] as string]],
      ),
    );
    const url = expandTemplate(op.request.urlTemplate, tuple);
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    values.push(tuple);
  }
  return values;
}

export async function verifyOperations(
  ops: Operation[],
  options: VerifyOptions,
): Promise<{ operations: Operation[]; warnings: string[] }> {
  const warnings: string[] = [];
  const out: Operation[] = [];
  for (const op of ops) {
    if (op.effect !== "read" || op.request.method !== "GET") {
      out.push(op);
      continue;
    }
    const recorded = recordedValues(op, options.recordedRequests ?? []);
    const values = recorded[0] ?? sampleValues(op);
    if (!values) {
      warnings.push(`verify: no sample values for ${op.label}; left unverified`);
      out.push(op);
      continue;
    }
    // One replay round tries anonymous and, if needed, authenticated access. After failure, one
    // more round uses another recorded success (or retries the sole recorded tuple).
    const replayValues = [values];
    const retry = recorded[1] ?? recorded[0];
    if (retry) replayValues.push(retry);
    let url = "";
    let anon: ReplayResponse | undefined;
    let auth: ReplayResponse | undefined;
    let good: ReplayResponse | undefined;
    let attempts = op.provenance.attempts ?? 0;
    for (const tuple of replayValues) {
      url = expandTemplate(op.request.urlTemplate, tuple);
      const replayOptions = {
        headers: {
          ...op.request.headers,
          accept:
            op.extraction?.format === "json"
              ? "application/json"
              : op.extraction?.format === "html"
                ? "text/html"
                : "*/*",
        },
        request: op.request,
        csrf: op.csrf,
        values: tuple,
      };
      anon = await options.replayer
        .get(url, { ...replayOptions, signedIn: false })
        .catch(() => undefined);
      auth =
        options.haveSession && !readable(op, anon)
          ? await options.replayer
              .get(url, { ...replayOptions, signedIn: true })
              .catch(() => undefined)
          : undefined;
      good = readable(op, anon) ? anon : readable(op, auth) ? auth : undefined;
      attempts++;
      if (good) break;
    }
    if (!good) {
      warnings.push(
        `verify: dropped ${op.label} (${url} answered ${anon?.status ?? "no response"}${auth ? ` / ${auth.status}` : ""})`,
      );
      continue;
    }
    const verified: Operation = {
      ...op,
      session: readable(op, anon) ? "none" : "signed-in",
      provenance: {
        ...op.provenance,
        attempts,
        successes: (op.provenance.successes ?? 0) + 1,
        lastVerified: options.now().toISOString(),
      },
    };
    if (op.extraction) {
      const items = applyExtraction(op.extraction, good.body, url);
      const filled = items.filter((i) => Object.keys(i).length > 0);
      if (filled.length === 0) {
        warnings.push(`verify: ${op.label} extraction found nothing on replay`);
        verified.provenance.confidence = Math.round(op.provenance.confidence * 50) / 100;
      }
    }
    out.push(verified);
  }
  return { operations: out, warnings };
}

/** The first candidate that answers 200 signed in and redirects or refuses signed out. */
export async function findProbeUrl(
  candidates: string[],
  replayer: Replayer,
): Promise<string | undefined> {
  for (const url of candidates) {
    const anon = await replayer.get(url, { signedIn: false }).catch(() => undefined);
    if (!anon) continue;
    const loginPage =
      /<form\b/i.test(anon.body) && parseForms(anon.body, url).some((f) => f.hasPassword);
    const refused =
      loginPage ||
      (anon.status >= 300 && anon.status < 400) ||
      anon.status === 401 ||
      anon.status === 403;
    if (!refused) continue;
    const auth = await replayer.get(url, { signedIn: true }).catch(() => undefined);
    if (ok(auth) && auth && !parseForms(auth.body, url).some((f) => f.hasPassword)) return url;
  }
  return undefined;
}

/**
 * A Replayer over a Playwright context (signed in) and plain fetch (signed out), recording into
 * the trace. `loginEvidence` gives the positive login evidence a credentials-only control drops
 * (the profile's login cookie names and learned model); without it no control can be sent.
 */
export function playwrightReplayer(
  context: import("playwright").BrowserContext,
  recorder: Recorder,
  phase: "probe" | "verify",
  loginEvidence: () => CookieSecretContext = () => ({}),
): Replayer {
  return {
    async get(
      url,
      {
        signedIn,
        headers: requestHeaders,
        request,
        csrf,
        values,
        authorize,
        credentialsOnly,
        loginRouteProbe,
      },
    ) {
      const prev = recorder.phase;
      recorder.phase = phase;
      try {
        url = guardUrl(url, recorder.siteOrigin).href;
        let res: ReplayResponse;
        let authenticationContext: string;
        let keptCookieNames: string[] = [];
        if (signedIn) {
          recorder.rememberCookies(await context.cookies(url));
          const bound = { ...values };
          const queryTokens: Array<[string, string]> = [];
          for (const rule of csrf ?? []) {
            if (rule.target.kind !== "query") continue;
            const source = rule.source;
            let token: string | undefined;
            if (source.kind === "cookie") {
              const cookies = await context.cookies(url);
              recorder.rememberCookies(cookies);
              token = cookies.find((c) => c.name === source.name)?.value;
            } else {
              const sourceUrl = guardUrl(
                expandTemplate(source.urlTemplate, bound),
                recorder.siteOrigin,
              ).href;
              await authorize?.(sourceUrl);
              const response = await context.request.get(sourceUrl, {
                maxRedirects: 0,
                timeout: 5000,
              });
              recorder.rememberSetCookies(
                response
                  .headersArray()
                  .filter((h) => h.name.toLowerCase() === "set-cookie")
                  .map((h) => h.value),
                response.url(),
              );
              const body = await recorder.readResponseBody(response, {
                url: sourceUrl,
                contentType: response.headers()["content-type"],
                resourceType: "csrf-preparation",
              });
              if (source.kind === "json") {
                const v = jsonPointer(JSON.parse(body), source.pointer);
                if (typeof v === "string") token = v;
              } else {
                const el = selectAll(
                  parseHtml(body),
                  source.kind === "meta" ? `meta[name=${attrValue(source.name)}]` : source.selector,
                )[0];
                if (el) token = attr(el, source.kind === "meta" ? "content" : source.attribute);
              }
            }
            if (!token) throw new Error("Missing session token for replay");
            recorder.rememberSecret(token);
            if (request?.urlTemplate.includes(`{${rule.target.name}}`))
              bound[rule.target.name] = token;
            else queryTokens.push([rule.target.name, token]);
          }
          if (request) url = expandTemplate(request.urlTemplate, bound);
          const decorated = new URL(url);
          for (const [name, token] of queryTokens) decorated.searchParams.set(name, token);
          url = decorated.href;
          url = guardUrl(url, recorder.siteOrigin).href;
          authenticationContext = recorder.authenticationContext(
            requestHeaders ?? {},
            await context.cookies(url),
          );
          await authorize?.(url);
          const r = await context.request.get(url, {
            headers: requestHeaders,
            maxRedirects: 0,
            failOnStatusCode: false,
            timeout: 5000,
          });
          recorder.rememberSetCookies(
            r
              .headersArray()
              .filter((h) => h.name.toLowerCase() === "set-cookie")
              .map((h) => h.value),
            url,
          );
          const headers = r.headers();
          res = {
            status: r.status(),
            body: await recorder.readResponseBody(r, {
              url,
              contentType: headers["content-type"],
              resourceType: "replay",
            }),
          };
          if (
            headers["www-authenticate"] !== undefined ||
            headers["proxy-authenticate"] !== undefined
          )
            res.authenticationFailure = true;
          if (headers["content-type"]) res.contentType = headers["content-type"];
          if (headers.location) res.location = headers.location;
        } else {
          // A credentials-only control drops only the cookies with positive login evidence and
          // keeps every other one (never the redaction heuristic: an HttpOnly or
          // credential-named gate cookie stays); a plain anonymous replay sends none.
          let kept: Awaited<ReturnType<typeof context.cookies>> = [];
          if (credentialsOnly) {
            const all = await context.cookies(url);
            recorder.rememberCookies(all);
            const evidence = loginEvidence();
            kept = all.filter((cookie) => !isLoginCredentialCookie(cookie, evidence));
            if (kept.length === all.length)
              throw new Error("No login evidence for a credentials-only control");
          }
          keptCookieNames = kept.map((cookie) => cookie.name);
          authenticationContext = recorder.authenticationContext(requestHeaders ?? {}, kept);
          const sent = new Headers(requestHeaders);
          sent.delete("cookie");
          if (kept.length)
            sent.set("cookie", kept.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "));
          await authorize?.(url);
          const r = await fetch(url, {
            headers: sent,
            redirect: "manual",
            signal: AbortSignal.timeout(5000),
          });
          recorder.rememberSetCookies(r.headers.getSetCookie(), url);
          res = {
            status: r.status,
            body: await recorder.readResponseBody(r, {
              url,
              contentType: r.headers.get("content-type") ?? undefined,
              resourceType: "replay-anonymous",
            }),
          };
          if (r.headers.has("www-authenticate") || r.headers.has("proxy-authenticate"))
            res.authenticationFailure = true;
          const ct = r.headers.get("content-type");
          if (ct) res.contentType = ct;
          const loc = r.headers.get("location");
          if (loc) res.location = loc;
        }
        const entry: Parameters<Recorder["recordReplay"]>[0] = {
          method: "GET",
          url,
          authenticationContext,
          resourceType: signedIn ? "replay" : "replay-anonymous",
          requestHeaders: requestHeaders ?? {},
          status: res.status,
          bodySample: res.body,
        };
        if (!signedIn && credentialsOnly) {
          entry.credentialsOnlyControl = true;
          entry.cookieNames = keptCookieNames;
        }
        if ((signedIn || credentialsOnly) && loginRouteProbe) {
          entry.loginRouteProbe = true;
          if (loginRouteProbe.hopOf !== undefined) entry.loginRouteHopOf = loginRouteProbe.hopOf;
        }
        if (res.authenticationFailure) {
          entry.responsePageFailure = true;
          entry.authenticationChallenge = true;
        }
        if (res.contentType) entry.contentType = res.contentType;
        if (res.location) entry.redirectedTo = new URL(res.location, url).toString();
        recorder.recordReplay(entry);
        return res;
      } finally {
        recorder.phase = prev;
      }
    },
  };
}

/** A login page or JSON redirect/error envelope is not a successful data read, even with HTTP 200. */
export function readable(op: Operation, response: ReplayResponse | undefined): boolean {
  if (!ok(response) || !response || response.authenticationFailure) return false;
  if (
    /html/i.test(response.contentType ?? "") &&
    parseForms(response.body, "https://fixture.test/").some((f) => f.hasPassword)
  )
    return false;
  if (op.extraction?.format === "json") {
    if (response.contentType && !/json/i.test(response.contentType)) return false;
    try {
      const doc: unknown = JSON.parse(response.body);
      if (
        jsonRootFailure(doc) ||
        jsonFailure(doc) ||
        jsonEnvelope(doc, op.extraction.itemPath).failed
      )
        return false;
    } catch {
      return false;
    }
  }
  return true;
}
