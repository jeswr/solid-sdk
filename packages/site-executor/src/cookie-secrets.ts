// AUTHORED-BY Codex GPT-6.1-Sol
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
