// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import type { SiteModel } from "@jeswr/site-model";
import {
  cookieSecrets,
  MIN_REDACTION_LENGTH,
  normaliseSecretText,
  registerSecret,
} from "./secrets.js";

export interface CookieSecretContext {
  model?: Pick<SiteModel, "login" | "operations">;
  /** Credential cookie names explicitly declared by the vault or learned login. */
  declaredNames?: readonly string[];
  loginCookieNames?: readonly string[];
}
export type SecretCookie = { name: string; value: string; httpOnly?: boolean };

/** One policy for every session intake and learning boundary. Names are conservative;
 * declaration matching is exact because cookie names are case-sensitive on the wire. */
export function isSessionCredentialCookie(
  cookie: SecretCookie,
  context: CookieSecretContext = {},
): boolean {
  return !!(
    cookie.httpOnly ||
    /session|sess|(?:^|[_.-])sid(?:$|[_.-])|auth|token|jwt|remember|csrf|xsrf|phpsessid|form[_-]?key|(?:^|[_.-])connect\.sid$/i.test(
      cookie.name,
    ) ||
    context.declaredNames?.includes(cookie.name) ||
    context.loginCookieNames?.includes(cookie.name) ||
    context.model?.login?.some((route) => route.sessionCookies?.includes(cookie.name)) ||
    context.model?.operations.some((op) =>
      op.csrf?.some((rule) => rule.source.kind === "cookie" && rule.source.name === cookie.name),
    )
  );
}

/**
 * Positive login evidence only (round 21): a cookie the vault or host declared as a credential,
 * one the demonstrated login set or changed (`loginCookieNames`), or a learned login route's
 * `sessionCookies`. The credentials-only liveness control drops exactly these. It never uses the
 * redaction heuristic above (`httpOnly`, credential-like names, CSRF cookie sources), which
 * deliberately over-includes: a gate cookie classed as a credential would be dropped from the
 * control while an expired session still carries it, and the gate would pass for a refusal. An
 * unclassified credential is kept, the control renders, and the result is Uncertain.
 */
export function isLoginCredentialCookie(
  cookie: Pick<SecretCookie, "name">,
  context: CookieSecretContext = {},
): boolean {
  return !!(
    context.declaredNames?.includes(cookie.name) ||
    context.loginCookieNames?.includes(cookie.name) ||
    context.model?.login?.some((route) => route.sessionCookies?.includes(cookie.name))
  );
}

/** Register transport and logical payloads together, retaining the heuristic floor
 * for preferences (including short payloads disguised by quotes/percent encoding). */
export function registerCookieSecrets(
  secrets: Set<string>,
  cookie: SecretCookie,
  context: CookieSecretContext = {},
): void {
  const forms = cookieSecrets(cookie.value).filter(Boolean);
  const minimum = isSessionCredentialCookie(cookie, context) ? MIN_REDACTION_LENGTH : 8;
  if (forms.some((v) => Array.from(normaliseSecretText(v).replace(/^"|"$/g, "")).length < minimum))
    return;
  for (const value of forms) registerSecret(secrets, value);
}
