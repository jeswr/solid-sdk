// AUTHORED-BY Claude Opus 5.5
// Session liveness proof: a learned read that only answers with data in a live session.
import { createHash } from "node:crypto";
import type { Extraction } from "@jeswr/site-model";
import { attribute, elementText, jsonPointer, parseHtml, selectElements } from "./dom.js";
import { isHtmlInputType } from "./html-controls.js";
import {
  elementChildren,
  jsonEnvelope,
  mainDocumentText,
  responsePageError,
} from "./response-evidence.js";

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
   * Learned proof that the read depends on the credentials: an anonymous replay of the exact
   * bound URL was refused for lack of authentication (the kind recorded here), and the learned
   * login routes a refusal redirect may lead to. Without it the deletion stays Uncertain.
   */
  anonymous: { refusal: AuthenticationRefusal; loginRoutes: string[] };
}

/** How a site refuses a read without credentials. */
export type AuthenticationRefusal = "login-redirect" | "authentication-status" | "login-page";
export const AUTHENTICATION_REFUSALS: readonly AuthenticationRefusal[] = [
  "login-redirect",
  "authentication-status",
  "login-page",
];

/** One answer to a read sent without credentials or cookies. */
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

/** Same-origin URL whose path is one of the learned login routes. */
function loginRoute(
  target: string,
  base: string,
  loginRoutes: readonly string[],
  origin: string,
): boolean {
  try {
    const url = new URL(target, base);
    return (
      url.origin === origin &&
      loginRoutes.some((route) => {
        const learned = new URL(route);
        return learned.origin === origin && learned.pathname === url.pathname;
      })
    );
  } catch {
    return false;
  }
}

const isHtml = (contentType: string | undefined, body: string) =>
  /html/i.test(contentType ?? "") || /^\s*</.test(body);

/** A login page: a password control, or a form posting to a learned login route. */
function loginPage(answer: AnonymousAnswer, loginRoutes: readonly string[], origin: string) {
  if (!answer.body || !isHtml(answer.contentType, answer.body)) return false;
  const doc = parseHtml(answer.body);
  return (
    selectElements("input", doc).some((el) => isHtmlInputType(el, "password")) ||
    selectElements("form", doc).some((el) => {
      const action = attribute(el, "action");
      return !!action?.trim() && loginRoute(action, answer.url, loginRoutes, origin);
    })
  );
}

/** Authentication wording in a refusal body: JSON strings, document text or plain text. */
function refusalText(body: string, contentType: string | undefined): boolean {
  if (!body.trim()) return false;
  if (/json/i.test(contentType ?? "") || /^\s*[[{]/.test(body)) {
    try {
      const strings: string[] = [];
      const walk = (value: unknown, depth: number): void => {
        if (strings.length >= 200 || depth > 16) return;
        if (typeof value === "string") strings.push(value);
        else if (value && typeof value === "object")
          for (const member of Object.values(value)) walk(member, depth + 1);
      };
      walk(JSON.parse(body), 0);
      return strings.some(refusalWords);
    } catch {
      /* Not JSON after all: read it as text. */
    }
  }
  if (isHtml(contentType, body)) {
    const doc = parseHtml(body);
    if (!elementChildren(doc)) return refusalWords(elementText(doc));
    return (
      selectElements("title, h1, h2, h3, h4, h5, h6, [role=heading]", doc).some((el) =>
        refusalWords(elementText(el)),
      ) || refusalWords(mainDocumentText(doc))
    );
  }
  return refusalWords(body);
}

/**
 * Classify an answer to a read sent without credentials or cookies. It is an authentication
 * refusal only when it is a redirect to a learned login route, a 401/403 carrying
 * WWW-Authenticate or authentication wording (or a login page), or a 2xx login page (a
 * password control or a form posting to a learned login route). Timeouts, network errors,
 * plain 403/5xx answers, other redirects and anything else are not.
 */
export function authenticationRefusal(
  answer: AnonymousAnswer,
  loginRoutes: readonly string[],
  origin: string,
): AuthenticationRefusal | undefined {
  if (!Number.isSafeInteger(answer.status)) return;
  if (REDIRECTS.has(answer.status))
    return answer.location !== undefined &&
      loginRoute(answer.location, answer.url, loginRoutes, origin)
      ? "login-redirect"
      : undefined;
  if (answer.status === 401 || answer.status === 403)
    return answer.challenge ||
      refusalText(answer.body, answer.contentType) ||
      loginPage(answer, loginRoutes, origin)
      ? "authentication-status"
      : undefined;
  if (answer.status >= 200 && answer.status < 300 && loginPage(answer, loginRoutes, origin))
    return "login-page";
  return;
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
