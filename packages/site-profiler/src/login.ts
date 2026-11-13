// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// Step 8: login route. Signs in once with the credentials the user gave (the only non-GET the
// profiler sends outside a demonstration), notes which cookies the site set, and finds a probe URL
// that answers 200 only when signed in. Bearer token endpoints found in scripts become refresh info.

import type { LoginRoute } from "@jeswr/site-model";
import type { BrowserContext, Cookie } from "playwright";
import { parseForms } from "./forms.js";
import { attr, descendants, parseHtml, text } from "./html.js";
import type { Recorder } from "./recorder.js";
import type { EndpointCandidate, FormInfo } from "./types.js";
import { normaliseUrl, sameOrigin } from "./util.js";

export interface LoginObservation {
  success: boolean;
  loginPageUrl: string;
  form?: FormInfo;
  /** Page the browser landed on after submitting. */
  landedOn?: string;
  /** Every cookie set or changed by the login response. */
  sessionCookies: string[];
  error?: string;
}

/** The link on a page most likely to lead to a sign-in form. */
export function findLoginLink(html: string, pageUrl: string): string | undefined {
  const doc = parseHtml(html);
  for (const a of descendants(doc)) {
    if (a.name !== "a") continue;
    const href = attr(a, "href") ?? "";
    if (/sign\s?in|log\s?in/i.test(text(a)) || /\/(login|log-in|signin|sign-in)\b/i.test(href)) {
      const url = normaliseUrl(href, pageUrl);
      if (url && sameOrigin(url, pageUrl)) return url;
    }
  }
  return undefined;
}

/** Treat a non-root start path as the application base, including after redirects. */
export function loginFallbackUrl(startUrl: string): string {
  const base = new URL(startUrl);
  base.search = "";
  base.hash = "";
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return new URL("login", base).href;
}

/** The username field of a password form: an email/text field named like a user, else the first visible text field. */
export function usernameField(form: FormInfo): string | undefined {
  const visible = form.fields.filter((f) => !f.hidden && ["text", "email", "tel"].includes(f.type));
  return (visible.find((f) => /user|email|login|account|name/i.test(f.name)) ?? visible[0])?.name;
}

function cssString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function changedCookies(before: Cookie[], after: Cookie[]): Cookie[] {
  return after.filter(
    (c) => !before.some((b) => b.name === c.name && b.value === c.value && b.domain === c.domain),
  );
}

export async function performLogin(
  context: BrowserContext,
  recorder: Recorder,
  startUrl: string,
  credentials: { username: string; password: string },
): Promise<LoginObservation> {
  const page = await context.newPage();
  const prevPhase = recorder.phase;
  recorder.phase = "login";

  try {
    await page.goto(startUrl, { waitUntil: "load" });
    let loginPageUrl = page.url();
    let html = await page.content();
    let form = parseForms(html, loginPageUrl).find((f) => f.hasPassword);
    if (!form) {
      const target = findLoginLink(html, loginPageUrl) ?? loginFallbackUrl(loginPageUrl);
      await page.goto(target, { waitUntil: "load" });
      loginPageUrl = page.url();
      html = await page.content();
      form = parseForms(html, loginPageUrl).find((f) => f.hasPassword);
    }
    if (!form)
      return { success: false, loginPageUrl, sessionCookies: [], error: "no password form found" };
    if (!sameOrigin(form.action, startUrl))
      return {
        success: false,
        loginPageUrl,
        sessionCookies: [],
        error: "password form leaves the site",
      };
    recorder.loginTarget = form.action;
    const user = usernameField(form);
    const pass = form.fields.find((f) => f.type === "password")?.name;
    if (!user || !pass)
      return { success: false, loginPageUrl, form, sessionCookies: [], error: "no username field" };
    const scope = page.locator(form.selector).first();
    await scope.locator(`[name=${cssString(user)}]`).fill(credentials.username);
    await scope.locator(`[name=${cssString(pass)}]`).fill(credentials.password);
    const before = await context.cookies(loginPageUrl);
    const navigated = page
      .waitForEvent("framenavigated", { predicate: (f) => f === page.mainFrame(), timeout: 15_000 })
      .catch(() => undefined);
    const submit = scope
      .locator('button[type="submit"], button:not([type]), input[type="submit"]')
      .first();
    if (await submit.count()) await submit.click();
    else await scope.evaluate((f) => (f as HTMLFormElement).requestSubmit());
    await navigated;
    await page.waitForLoadState("load").catch(() => undefined);
    await recorder.flush();
    const after = await context.cookies(page.url());
    const changed = changedCookies(before, after);
    const stillForm = parseForms(await page.content(), page.url()).some((f) => f.hasPassword);
    const success = changed.length > 0 && !stillForm;
    const obs: LoginObservation = {
      success,
      loginPageUrl,
      form,
      landedOn: page.url(),
      sessionCookies: [
        ...new Set([
          ...changed.map((c) => c.name),
          ...recorder.trace
            .filter((r) => r.phase === "login" && r.method === "POST" && r.url === form.action)
            .flatMap((r) => r.setCookieNames ?? []),
        ]),
      ],
    };
    if (!success) obs.error = "the site did not accept the sign-in";
    return obs;
  } finally {
    recorder.phase = prevPhase;
    recorder.loginTarget = undefined;
    await page.close();
  }
}

/** Probe URL candidates: where the login landed, then account-like pages seen in the crawl. */
export function probeCandidates(
  obs: LoginObservation | undefined,
  pageUrls: string[],
  verifiedSignedInReads: string[] = [],
): string[] {
  const out: string[] = [];
  const add = (u: string | undefined) => {
    if (!u) return;
    const clean = u.replace(/#.*$/, "");
    if (new URL(clean).pathname === "/" || out.includes(clean)) return;
    out.push(clean);
  };
  add(obs?.landedOn);
  for (const u of pageUrls)
    if (
      /\/(account|profile|me|dashboard|settings|my|preferences|notifications|messages|inbox|compose|submit)(\/|$|\?)/i.test(
        u,
      )
    )
      add(u);
  for (const url of verifiedSignedInReads) add(url);
  return out;
}

/**
 * Bearer token refresh info from candidates: an endpoint taking refresh_token. Pointers default to
 * the RFC 6749 names, or follow a sampled response's keys when there is one.
 */
export function refreshInfo(candidates: EndpointCandidate[]): LoginRoute["refresh"] | undefined {
  const c = candidates.find(
    (x) => x.method === "POST" && x.params.some((p) => /^refresh_?token$/i.test(p.name)),
  );
  if (!c) return undefined;
  let tokenPointer = "/access_token";
  let expiresInPointer = "/expires_in";
  const sample = c.samples.find((s) => s.bodySample)?.bodySample;
  if (sample) {
    try {
      const parsed = JSON.parse(sample) as Record<string, unknown>;
      const tk = Object.keys(parsed).find((k) => /^access_?token$/i.test(k));
      const ex = Object.keys(parsed).find((k) => /^expires_?in$/i.test(k));
      if (tk) tokenPointer = `/${tk}`;
      if (ex) expiresInPointer = `/${ex}`;
    } catch {
      // keep defaults
    }
  }
  return { urlTemplate: c.urlTemplate, tokenPointer, expiresInPointer };
}
