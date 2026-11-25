// AUTHORED-BY Claude Opus 5.5
// Session liveness proof: a learned read that only answers with data in a live session.
import { createHash } from "node:crypto";
import type { Extraction } from "@jeswr/site-model";
import type { AnyNode, Element } from "domhandler";
import { attribute, elementText, jsonPointer, parseHtml, selectElements } from "./dom.js";
import { isHtmlInputType } from "./html-controls.js";
import { isMessageKey, jsonEnvelope, responsePageError } from "./response-evidence.js";

/** Status, media type and opaque structure of a learned read's success response. */
export interface LivenessSignature {
  status: number;
  contentType: string;
  structure: string;
}

/**
 * A learned read-gated GET, sent with the same session after a deletion's absence read. Every
 * input is a witnessed constant: nothing comes from the write, so the read never addresses the
 * deleted item.
 */
export interface LivenessRead {
  operation: string;
  bind: Record<string, { value: string }>;
  signature: LivenessSignature;
  /**
   * Learned proof that the read depends on the credentials: a credentials-only control replay
   * of the exact bound URL (the same request without the session credentials, every other
   * cookie kept) was refused for lack of authentication. `refusal` pins the kind, `route` the
   * learned login route a redirect or login envelope led to, and `loginRoutes` the learned
   * login routes. At runtime the control must give the same kind and route; without this
   * evidence the deletion stays Uncertain.
   */
  anonymous: {
    refusal: AuthenticationRefusal;
    loginRoutes: string[];
    route?: string;
    /** Login routes learned from verified redirect targets, with their evidence. */
    verifiedRoutes?: VerifiedLoginRoute[];
  };
}

/** How a site refuses a read without its session credentials. */
export type AuthenticationRefusal =
  | "login-redirect"
  | "authentication-status"
  | "login-page"
  | "login-envelope";
export const AUTHENTICATION_REFUSALS: readonly AuthenticationRefusal[] = [
  "login-redirect",
  "authentication-status",
  "login-page",
  "login-envelope",
];
/** Refusal kinds that lead to a learned login route, which is pinned with the kind. */
export const ROUTED_REFUSALS: readonly AuthenticationRefusal[] = [
  "login-redirect",
  "login-envelope",
];

/** A classified refusal: its kind and, for a redirect or login envelope, the login route. */
export interface RefusalEvidence {
  kind: AuthenticationRefusal;
  route?: string;
}

/** One answer to a read sent without the session credentials. */
export interface AnonymousAnswer {
  /** The URL that was requested. */
  url: string;
  status: number;
  contentType?: string;
  body: string;
  /** The Location of a redirect, absolute or relative to `url`. */
  location?: string;
  /** True when the response carried WWW-Authenticate or Proxy-Authenticate. */
  challenge?: boolean;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/**
 * Positive authentication wording for a 401/403 body. Stricter than the not-found markers,
 * because here a match helps a deletion complete: "forbidden", "denied", "permission",
 * "token" and "private" describe other refusals (a firewall, a CSRF check, an access rule).
 */
const REFUSAL_WORDS =
  /\b(?:authenticat\w*|unauthenticated|not authenticated|unauthori[sz]ed|log (?:in|on)|login|logon|logged (?:in|out)|sign (?:in|on)|signin|signon|sso|credentials?|session (?:has )?(?:expired|ended|timed ?out))\b/i;
const refusalWords = (text: string): boolean =>
  REFUSAL_WORDS.test(
    text
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[\s_-]+/g, " ")
      .trim(),
  );

/** The learned login route (origin plus path) a same-origin URL leads to, if any. */
function matchedLoginRoute(
  target: string,
  base: string,
  loginRoutes: readonly string[],
  origin: string,
): string | undefined {
  try {
    const url = new URL(target, base);
    if (url.origin !== origin) return;
    return loginRoutes.find((route) => {
      try {
        const learned = new URL(route);
        return learned.origin === origin && learned.pathname === url.pathname;
      } catch {
        return false;
      }
    });
  } catch {
    return;
  }
}

const isHtml = (contentType: string | undefined, body: string) =>
  /html/i.test(contentType ?? "") || /^\s*</.test(body);
const isJson = (contentType: string | undefined, body: string) =>
  /json/i.test(contentType ?? "") || /^\s*[[{]/.test(body);

/** Layout chrome: banners, menus, navigation, sidebars and footers, by element or role. */
const CHROME_TAGS = new Set(["header", "nav", "footer", "aside", "menu"]);
const CHROME_ROLES =
  /(?:^|\s)(?:banner|navigation|contentinfo|complementary|menu|menubar|toolbar)(?:\s|$)/i;
const NON_RENDERED = new Set(["head", "script", "style", "template", "noscript"]);
const isElement = (node: AnyNode | null): node is Element =>
  !!node && "name" in node && "attribs" in node;
function ancestry(node: AnyNode, test: (el: Element) => boolean): boolean {
  for (let at: AnyNode | null = node; at; at = at.parent)
    if (isElement(at) && test(at)) return true;
  return false;
}
const inChrome = (node: AnyNode) =>
  ancestry(
    node,
    (el) =>
      CHROME_TAGS.has(el.name.toLowerCase()) || CHROME_ROLES.test(attribute(el, "role") ?? ""),
  );
const nonRendered = (node: AnyNode) =>
  ancestry(node, (el) => NON_RENDERED.has(el.name.toLowerCase()));
const within = (outer: AnyNode, node: AnyNode) => ancestry(node, (el) => el === outer);

/**
 * The login controls of a document: forms holding a password control or posting to a learned
 * login route, and password controls outside any form.
 */
function loginRegions(
  doc: ReturnType<typeof parseHtml>,
  url: string,
  loginRoutes: readonly string[],
  origin: string,
): Element[] {
  const forms = selectElements("form", doc).filter(
    (form) =>
      !nonRendered(form) &&
      (selectElements("input", form).some((el) => isHtmlInputType(el, "password")) ||
        (() => {
          const action = attribute(form, "action");
          return (
            !!action?.trim() && matchedLoginRoute(action, url, loginRoutes, origin) !== undefined
          );
        })()),
  );
  const loose = selectElements("input", doc).filter(
    (el) =>
      isHtmlInputType(el, "password") &&
      !nonRendered(el) &&
      !forms.some((form) => within(form, el)) &&
      !ancestry(el, (a) => a.name.toLowerCase() === "form"),
  );
  return [...forms, ...loose];
}

/** Item rows: repeated records, table data rows and marked-up items. */
const ROW_SELECTOR =
  "tr, li, article, [role=row], [role=listitem], [role=article], [itemscope], [itemtype]";

/**
 * A login document: its login controls are the page's content, not a quick-login box beside
 * other content. Some login control sits outside layout chrome; when the page marks a main
 * region, a login control is inside it; and outside the login controls and chrome there are no
 * item rows (an article, a marked-up item, a table data row, a grid row) and no listing (three
 * or more list items). A page with item rows or a main listing is never a login page.
 */
export function isLoginDocument(
  body: string,
  url: string,
  loginRoutes: readonly string[] = [],
  origin = "",
): boolean {
  if (!body.trim()) return false;
  const doc = parseHtml(body);
  const regions = loginRegions(doc, url, loginRoutes, origin);
  const primary = regions.filter((region) => !inChrome(region));
  if (!primary.length) return false;
  const mains = selectElements("main, [role=main]", doc).filter((el) => !nonRendered(el));
  if (mains.length && !primary.some((region) => mains.some((main) => within(main, region))))
    return false;
  const rows = selectElements(ROW_SELECTOR, doc).filter(
    (el) =>
      !nonRendered(el) &&
      !inChrome(el) &&
      !regions.some((region) => within(region, el) || within(el, region)),
  );
  const item = (el: Element) => {
    const name = el.name.toLowerCase();
    return (
      name === "article" ||
      el.attribs.itemscope !== undefined ||
      el.attribs.itemtype !== undefined ||
      /^(?:row|article)$/i.test(attribute(el, "role")?.trim() ?? "") ||
      (name === "tr" && selectElements("td", el).length > 0)
    );
  };
  if (rows.some(item)) return false;
  return rows.filter((el) => !item(el)).length < 3;
}

/** A login page: a login document holding a password control or a learned-route login form. */
function loginPage(answer: AnonymousAnswer, loginRoutes: readonly string[], origin: string) {
  return (
    !!answer.body &&
    isHtml(answer.contentType, answer.body) &&
    isLoginDocument(answer.body, answer.url, loginRoutes, origin)
  );
}

/** Bounded message-like JSON strings (title, message, detail, error_description, ...). */
function messageStrings(doc: unknown): string[] {
  const strings: string[] = [];
  const walk = (value: unknown, depth: number, message: boolean): void => {
    if (strings.length >= 200 || depth > 16) return;
    if (typeof value === "string") {
      if (message) strings.push(value);
    } else if (Array.isArray(value)) {
      for (const member of value) walk(member, depth + 1, message);
    } else if (value && typeof value === "object")
      for (const [key, member] of Object.entries(value)) walk(member, depth + 1, isMessageKey(key));
  };
  walk(doc, 0, false);
  return strings;
}

/**
 * Authentication wording in a refusal body, read narrowly: message-like JSON values, the
 * document title, headings outside layout chrome, and the labels and buttons of the login form.
 * Body text, layout chrome (top bars, menus) wherever it sits, plain text and other JSON strings
 * are never read.
 */
function refusalText(
  answer: AnonymousAnswer,
  loginRoutes: readonly string[],
  origin: string,
): boolean {
  const { body, contentType } = answer;
  if (!body.trim()) return false;
  if (isJson(contentType, body)) {
    try {
      return messageStrings(JSON.parse(body)).some(refusalWords);
    } catch {
      /* Not JSON after all. */
    }
  }
  if (!isHtml(contentType, body)) return false;
  const doc = parseHtml(body);
  const title = selectElements("title", doc).some((el) => refusalWords(elementText(el)));
  const headings = selectElements("h1, h2, h3, h4, h5, h6, [role=heading]", doc).some(
    (el) => !nonRendered(el) && !inChrome(el) && refusalWords(elementText(el)),
  );
  const form = loginRegions(doc, answer.url, loginRoutes, origin)
    .filter((region) => region.name.toLowerCase() === "form" && !inChrome(region))
    .some((region) =>
      selectElements("label, legend, button, input", region).some((el) =>
        el.name.toLowerCase() === "input"
          ? (isHtmlInputType(el, "submit") || isHtmlInputType(el, "button")) &&
            refusalWords(attribute(el, "value") ?? "")
          : refusalWords(elementText(el)),
      ),
    );
  return title || headings || form;
}

const FLAG_TRUE =
  /^(?:ajaxexpired|expired|sessionexpired|sessiontimeout|sessiontimedout|authrequired|authenticationrequired|loginrequired|requireslogin|requiresauthentication|needslogin|unauthenticated|notauthenticated|reauthenticate|relogin)$/;
const FLAG_FALSE = /^(?:authenticated|isauthenticated|loggedin|isloggedin|signedin|issignedin)$/;
const REDIRECT_KEY =
  /^(?:ajaxredirect|redirect|redirecturl|redirecturi|redirectto|loginurl|loginuri|loginredirect|location)$/;
const keyName = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");
const truthy = (v: unknown) =>
  v === true || v === 1 || (typeof v === "string" && /^(?:1|true|yes)$/i.test(v.trim()));
const falsy = (v: unknown) =>
  v === false || v === 0 || (typeof v === "string" && /^(?:0|false|no)$/i.test(v.trim()));

/** The redirect values of a JSON envelope carrying an explicit expiry/authentication flag. */
function envelopeRedirects(answer: AnonymousAnswer): string[] | undefined {
  if (!isJson(answer.contentType, answer.body)) return;
  let doc: unknown;
  try {
    doc = JSON.parse(answer.body);
  } catch {
    return;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return;
  const entries = Object.entries(doc).map(([key, value]) => [keyName(key), value] as const);
  const flagged = entries.some(
    ([key, value]) =>
      (FLAG_TRUE.test(key) && truthy(value)) || (FLAG_FALSE.test(key) && falsy(value)),
  );
  if (!flagged) return;
  const redirects = entries.filter(([key]) => REDIRECT_KEY.test(key)).map(([, value]) => value);
  if (!redirects.length || redirects.some((value) => typeof value !== "string" || !value.trim()))
    return;
  return redirects as string[];
}

/**
 * The login route of a login JSON envelope, or undefined. The root object must carry an
 * explicit expiry or authentication flag (`ajaxExpired: 1`, `sessionExpired: true`,
 * `authenticated: false`, ...) AND redirect values (`ajaxRedirect`, `redirect`, `loginUrl`,
 * ...) that all resolve to one learned login route on the same origin.
 */
function loginEnvelope(
  answer: AnonymousAnswer,
  loginRoutes: readonly string[],
  origin: string,
): string | undefined {
  const redirects = envelopeRedirects(answer);
  if (!redirects) return;
  const routes = new Set(
    redirects.map((value) => matchedLoginRoute(value, answer.url, loginRoutes, origin)),
  );
  const [route] = routes;
  return routes.size === 1 && route !== undefined ? route : undefined;
}

/**
 * Where a refused answer sends the visitor, before any login route is known: the Location of
 * a redirect, or the redirect value of a flagged login envelope (all its redirect values must
 * resolve to one origin plus path). Only a same-origin URL (fragment removed) is returned, so
 * the profiler can verify it as a login route by fetching it as a credentials-only control.
 */
export function refusalTarget(answer: AnonymousAnswer, origin: string): string | undefined {
  const values = REDIRECTS.has(answer.status)
    ? answer.location !== undefined
      ? [answer.location]
      : undefined
    : (answer.status >= 200 && answer.status < 300) ||
        answer.status === 401 ||
        answer.status === 403
      ? envelopeRedirects(answer)
      : undefined;
  if (!values?.length) return;
  try {
    const urls = values.map((value) => new URL(value, answer.url));
    if (urls.some((url) => url.origin !== origin)) return;
    if (new Set(urls.map((url) => url.pathname)).size !== 1) return;
    const [first] = urls;
    if (!first) return;
    first.hash = "";
    return first.href;
  } catch {
    return;
  }
}

/**
 * Positive evidence that a redirect target is a login route: the profiler fetched `url`
 * as a credentials-only control (read gate first) and the answer, or the answer of one
 * same-origin hop `via` an already-learned login route, was a login document. `route` is the
 * target's origin plus path.
 */
export interface VerifiedLoginRoute {
  route: string;
  url: string;
  via?: string;
}

/**
 * Classify an answer to a read sent without its session credentials. It is an authentication
 * refusal only when it is
 * - `login-redirect`: a redirect to a learned login route (the route is returned);
 * - `login-envelope`: a 2xx/401/403 JSON envelope with an explicit expiry or authentication
 *   flag and a redirect value resolving to a learned login route (the route is returned);
 * - `authentication-status`: a 401/403 carrying WWW-Authenticate, narrow authentication
 *   wording or a login page;
 * - `login-page`: a 2xx login document (password control or learned-route login form, and no
 *   item rows or main listing beside it).
 * Timeouts, network errors, plain 403/5xx answers, other redirects and anything else are not.
 */
export function refusalEvidence(
  answer: AnonymousAnswer,
  loginRoutes: readonly string[],
  origin: string,
): RefusalEvidence | undefined {
  if (!Number.isSafeInteger(answer.status)) return;
  if (REDIRECTS.has(answer.status)) {
    const route =
      answer.location !== undefined
        ? matchedLoginRoute(answer.location, answer.url, loginRoutes, origin)
        : undefined;
    return route ? { kind: "login-redirect", route } : undefined;
  }
  const status2xx = answer.status >= 200 && answer.status < 300;
  const denied = answer.status === 401 || answer.status === 403;
  if (status2xx || denied) {
    const route = loginEnvelope(answer, loginRoutes, origin);
    if (route) return { kind: "login-envelope", route };
  }
  if (denied)
    return answer.challenge ||
      refusalText(answer, loginRoutes, origin) ||
      loginPage(answer, loginRoutes, origin)
      ? { kind: "authentication-status" }
      : undefined;
  if (status2xx && loginPage(answer, loginRoutes, origin)) return { kind: "login-page" };
  return;
}

/** The refusal kind of `refusalEvidence`, without the route. */
export function authenticationRefusal(
  answer: AnonymousAnswer,
  loginRoutes: readonly string[],
  origin: string,
): AuthenticationRefusal | undefined {
  return refusalEvidence(answer, loginRoutes, origin)?.kind;
}

/** True when a refusal reproduces the pinned kind and, for a routed kind, the pinned route. */
export function sameRefusal(
  pinned: { refusal: AuthenticationRefusal; route?: string },
  evidence: RefusalEvidence | undefined,
): boolean {
  if (!evidence || evidence.kind !== pinned.refusal) return false;
  if (!ROUTED_REFUSALS.includes(pinned.refusal)) return evidence.route === undefined;
  return pinned.route !== undefined && evidence.route === pinned.route;
}

/** True when the response reproduces the learned liveness signature. */
export function matchesLivenessSignature(
  learned: LivenessSignature,
  status: number,
  contentType: string | undefined,
  body: string,
  extraction: Extraction,
): boolean {
  if (status !== learned.status) return false;
  const signature = livenessSignature(status, contentType, body, extraction);
  return (
    !!signature &&
    signature.contentType === learned.contentType &&
    signature.structure === learned.structure
  );
}

/** Bounded rows inspected for item-level presence; the signature never depends on the count. */
const ROWS = 20;
const SELF = new Set(["", ".", ":scope"]);

const presentScalar = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.some(presentScalar)
    : (typeof value === "string" && value.trim() !== "") ||
      (typeof value === "number" && Number.isFinite(value)) ||
      typeof value === "boolean";

/**
 * Success evidence for a liveness read, or undefined. It needs a 2xx response of the
 * extraction's format without any failure or authentication marker (the shared page-error
 * predicate: authentication headings, password inputs, login/SSO forms, failure envelopes),
 * and at least one row carrying an item-level field. The structure is the JSON envelope
 * (ancestor keys of the collection, or the main item's keys) or the HTML document paths that
 * lead to the rows, so a login page, an empty envelope or a different document never matches.
 */
export function livenessSignature(
  status: number,
  contentType: string | undefined,
  body: string,
  extraction: Extraction,
): LivenessSignature | undefined {
  if (!Number.isSafeInteger(status) || status < 200 || status >= 300 || !body.trim()) return;
  const media = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (extraction.format === "json" ? !/json/.test(media) : !/html/.test(media)) return;
  if (responsePageError(body, media, false)) return;
  let structure: unknown;
  try {
    if (extraction.format === "json") {
      const doc: unknown = JSON.parse(body);
      const envelope = jsonEnvelope(doc, extraction.itemPath);
      if (envelope.failed || !envelope.keys) return;
      const root = jsonPointer(doc, extraction.itemPath ?? "");
      const rows = Array.isArray(root) ? root : [root];
      if (!rows.every((row) => row !== null && typeof row === "object" && !Array.isArray(row)))
        return;
      const present = rows
        .slice(0, ROWS)
        .some((row) =>
          extraction.fields.some((field) => presentScalar(jsonPointer(row, field.path))),
        );
      if (!present) return;
      structure = [
        "json",
        envelope.keys,
        Array.isArray(root) ? "array" : Object.keys(root as object).sort(),
      ];
    } else {
      const doc = parseHtml(body);
      const roots = extraction.itemPath ? selectElements(extraction.itemPath, doc, ROWS) : [doc];
      const matched = roots.flatMap((root) =>
        extraction.fields.flatMap((field) =>
          (SELF.has(field.path.trim()) ? [root] : selectElements(field.path, root, ROWS)).filter(
            (el) => {
              const value =
                field.attribute && "attribs" in el
                  ? attribute(el, field.attribute)
                  : elementText(el);
              return value !== undefined && value.trim() !== "";
            },
          ),
        ),
      );
      if (!matched.length) return;
      const path = (node: (typeof matched)[number]) => {
        const names: string[] = [];
        for (let at: typeof node | null = node; at && "name" in at; at = at.parent as typeof at)
          names.unshift(at.name.toLowerCase());
        return names.join(">");
      };
      const rows = extraction.itemPath ? roots : matched;
      structure = ["html", [...new Set(rows.map(path))].sort()];
    }
  } catch {
    return;
  }
  return {
    status,
    contentType: media,
    structure: createHash("sha256").update(JSON.stringify(structure)).digest("hex"),
  };
}
