// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
// Shared negative evidence; callers still need positive resource/success evidence.
import { createHash } from "node:crypto";
import type { Extraction, Operation } from "@jeswr/site-model";
import { endpointItemType, SCHEMA } from "@jeswr/site-model";
import { compileOperation } from "./compile.js";
import { attribute, elementText, jsonPointer, parseHtml, selectElements } from "./dom.js";
import { isHtmlInputType } from "./html-controls.js";
import { effectiveWireFields } from "./wire.js";

/** Include compound keys such as http_status, errorCode, failureReason, err and errMsg. */
export const isDiscriminatorKey = (key: string): boolean =>
  /status|code|error|type|reason|^errs?$|^err[a-z]|[a-z]err$/.test(
    key.toLowerCase().replace(/[^a-z0-9]/g, ""),
  );
/** Separator-insensitive tokens ("log in", "please log in" and "access denied" reduce to them). */
const authenticationMarker = (value: string) =>
  /auth|login|signin|credential|token|forbidden|permission|denied|unauthor|unauthenticated|notauthenticated|restricted|notprovided/.test(
    value.toLowerCase().replace(/[^a-z0-9]/g, ""),
  );
/**
 * The same tokens for prose (message-like values, element-less documents, main document text):
 * whole words, so "No such blog in this forum" is not "login". Round 19 adds "logged in/out",
 * "session expired/ended/timed out", "members only", "private", "sign up" and "register"
 * (defence in depth: this list can never be complete, and it only ever rejects). A single-token
 * value such as "AccessDenied" or "auth_required" also gets the separator-insensitive rule.
 */
const AUTHENTICATION_WORDS =
  /\b(?:auth|authentica\w*|authori[sz]\w*|unauthori[sz]\w*|unauthenticated|not[\s_-]*authenticated|log[\s_-]*(?:in|on)|logged[\s_-]*(?:in|on|out)|sign[\s_-]*(?:in|on|up)|sso|credentials?|tokens?|forbidden|permissions?|denied|restricted|not[\s_-]*provided|session[\s_-]+(?:has[\s_-]+)?(?:expired|ended|timed[\s_-]*out)|members?[\s_-]*only|private|register)\b/i;
export function authenticationText(value: string): boolean {
  const text = value.trim();
  return AUTHENTICATION_WORDS.test(text) || (!/\s/.test(text) && authenticationMarker(text));
}
/** Message-like members (title, detail, message, msg, description, error_description, ...). */
export const isMessageKey = (key: string): boolean =>
  /message|msg|detail|description|title|summary|hint|reason|cause|notice/.test(
    key.toLowerCase().replace(/[^a-z0-9]/g, ""),
  );
/** Not-found context only: an authentication phrase in a message-like string at this level. */
function jsonAuthenticationMessage(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).some(
      ([key, member]) =>
        isMessageKey(key) &&
        (Array.isArray(member) ? member : [member]).some(
          (text) => typeof text === "string" && authenticationText(text),
        ),
    )
  );
}
const authenticationDiscriminator = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.some(authenticationDiscriminator)
    : (typeof value === "string" || typeof value === "number") &&
      (authenticationMarker(String(value)) || [401, 403, 407, 419, 440].includes(Number(value)));

/**
 * Scalars outside every object member: the document root itself and, for an array root, its
 * (nested) elements. They carry no key, so they are always treated as discriminators.
 */
const rootScalars = (doc: unknown): unknown[] =>
  Array.isArray(doc)
    ? doc.flatMap(rootScalars)
    : doc === null || typeof doc !== "object"
      ? [doc]
      : [];

/** A scalar JSON root (or array-root element) carrying an authentication token or status. */
export function jsonRootFailure(doc: unknown): boolean {
  return rootScalars(doc).some(authenticationDiscriminator);
}

export function jsonFailure(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).some(
      ([key, member]) =>
        (isDiscriminatorKey(key) && authenticationDiscriminator(member)) ||
        (/^(?:errors?|validationErrors|exception|redirect|ajaxRedirect)$/i.test(key) &&
          member !== false &&
          member != null &&
          member !== "" &&
          JSON.stringify(member) !== "[]") ||
        (/^(?:message|detail|reason)$/i.test(key) &&
          typeof member === "string" &&
          /\b(?:unauthenticated|unauthorized|please (?:(?:sign|log)[ -]?in|authenticate)|(?:authentication|authorization|sign[ -]?in|log[ -]?in) (?:required|failed)|session (?:has )?expired)\b/i.test(
            member,
          )) ||
        (/^(?:success|ok|authenticated|authorized|loggedIn)$/i.test(key) && member === false) ||
        (/^(?:status|statusCode|code)$/i.test(key) &&
          ["string", "number"].includes(typeof member) &&
          /^(?:error|fail|failed|failure)$/i.test(String(member).trim())),
    )
  );
}

/** Every object on the path to the collection, excluding collection contents. */
export function jsonEnvelope(doc: unknown, pointer = ""): { failed: boolean; keys?: string[][] } {
  const keys: string[][] = [];
  const parts = pointer.split("/");
  let failed = false;
  for (let i = 1; i < parts.length; i++) {
    const ancestor = jsonPointer(doc, parts.slice(0, i).join("/"));
    if (!ancestor || typeof ancestor !== "object" || Array.isArray(ancestor))
      return { failed: true };
    failed ||= jsonFailure(ancestor);
    keys.push(Object.keys(ancestor).sort());
  }
  // An object root is the main item; an array root has no envelope ancestors.
  if (!pointer && !Array.isArray(doc)) failed ||= jsonFailure(doc);
  return { failed, keys };
}

const FLASH_SELECTOR =
  '[aria-invalid]:not([aria-invalid="false"]), [role~="alert"], [aria-live="assertive"], .error, .errors, .form-error-message, .form-errors, .error-message, .validation-error, .validation-errors, .invalid-feedback, .alert-danger, .message-error';

const FAILURE_SELECTOR =
  '[aria-invalid]:not([aria-invalid="false"]), .error, .errors, .form-error-message, .form-errors, .error-message, .validation-error, .validation-errors, .invalid-feedback, .alert-danger, .message-error';

/** Opaque equality evidence only: page text is never interpreted as an instruction. */
export function responseFlash(body: string, contentType: string | undefined): string[] {
  if (!/html/i.test(contentType ?? "")) return [];
  return selectElements(FLASH_SELECTOR, parseHtml(body))
    .map((el) =>
      createHash("sha256")
        .update(
          JSON.stringify([
            attribute(el, "role") ?? "",
            attribute(el, "aria-live") ?? "",
            (attribute(el, "class") ?? "").split(/\s+/).filter(Boolean).sort(),
            elementText(el).replace(/\s+/g, " ").trim(),
          ]),
        )
        .digest("hex"),
    )
    .sort();
}

export function responsePageError(
  body: string,
  contentType: string | undefined,
  includeAlerts = true,
  allowNotFound = false,
): boolean {
  if (!body) return false;
  if (/json/i.test(contentType ?? "") || /^\s*[[{]/.test(body)) {
    try {
      const doc: unknown = JSON.parse(body);
      const walk = (value: unknown): boolean =>
        jsonFailure(value) ||
        (allowNotFound && jsonAuthenticationMessage(value)) ||
        (value !== null && typeof value === "object" && Object.values(value).some(walk));
      return jsonRootFailure(doc) || walk(doc);
    } catch {
      return true;
    }
  }
  if (!/html/i.test(contentType ?? "") && !/^\s*</.test(body)) return false;
  const doc = parseHtml(body);
  // Not-found context: an element-less document is one scalar text, and authentication
  // phrases in the main text (outside nav, header and footer) reject too. Neither verifies.
  if (allowNotFound) {
    if (!elementChildren(doc)) {
      const text = elementText(doc);
      if (authenticationDiscriminator(text) || authenticationText(text)) return true;
    } else if (AUTHENTICATION_WORDS.test(mainDocumentText(doc))) return true;
  }
  if (
    selectElements("title, h1, h2, h3, h4, h5, h6, [role=heading]", doc).some((el) =>
      authenticationMarker(elementText(el)),
    ) ||
    selectElements("input", doc).some((el) => isHtmlInputType(el, "password")) ||
    selectElements("form", doc).some((el) =>
      /(?:^|[/_-])(?:oauth2?|saml|openid|sso|login|signin|sign-in|auth|authenticate|authentication|signon|logon)(?:[/_?#-]|$)/i.test(
        attribute(el, "action") ?? "",
      ),
    ) ||
    selectElements("title, h1, h2, form, [role=heading], button", doc).some((el) =>
      /\b(?:log[ -]?in|sign[ -]?in|single[ -]?sign[ -]?on|sso|authentication required|session expired)\b/i.test(
        el.name === "form" ? (attribute(el, "action") ?? "") : elementText(el),
      ),
    ) ||
    selectElements(FAILURE_SELECTOR, doc).length ||
    selectElements('[role~="alert"], [aria-live="assertive"]', doc).some((el) =>
      /(?:^|[\s_-])(?:error|danger|warning)(?:$|[\s_-])/i.test(attribute(el, "class") ?? ""),
    ) ||
    (includeAlerts && selectElements(FLASH_SELECTOR, doc).length)
  )
    return true;
  return selectElements("title, h1", doc).some(
    (el) =>
      /\b(error|invalid|validation|forbidden|not found|access denied)\b/i.test(elementText(el)) &&
      !(
        allowNotFound &&
        /^(?:\d{3}\s*[-:]?\s*)?(?:page |resource |item )?(?:not found|gone)[.!]?$/i.test(
          elementText(el).trim(),
        )
      ),
  );
}

/** True when the parsed document has an element (doctype, comments and text are not elements). */
export function elementChildren(doc: ReturnType<typeof parseHtml>): boolean {
  return doc.children.some((node) => "name" in node && "attribs" in node);
}

const NON_MAIN = new Set([
  "head",
  "nav",
  "header",
  "footer",
  "script",
  "style",
  "template",
  "noscript",
]);
/** Headings and body text, excluding navigation chrome and non-rendered content. */
export function mainDocumentText(doc: ReturnType<typeof parseHtml>): string {
  const parts: string[] = [];
  const visit = (nodes: ReturnType<typeof parseHtml>["children"]) => {
    for (const node of nodes) {
      if ("name" in node && "attribs" in node) {
        if (!NON_MAIN.has(node.name.toLowerCase())) visit(node.children);
      } else if (node.type === "text" && "data" in node) parts.push(String(node.data));
    }
  };
  visit(doc.children);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** An array or a repeated-item selector always denotes a collection, even with one row. */
export function landingItemValues(ex: Extraction, body: string): Map<string, string[]> | undefined {
  const values = new Map<string, string[]>();
  let count = 0;
  const bounded = (scalars: string[]) => {
    count += scalars.length;
    return scalars.length <= 100 && count <= 1000 && scalars.every((value) => value.length <= 4000);
  };
  if (ex.format === "json") {
    let doc: unknown;
    try {
      doc = JSON.parse(body);
    } catch {
      return;
    }
    if (jsonEnvelope(doc, ex.itemPath).failed) return;
    const item = jsonPointer(doc, ex.itemPath ?? "");
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    for (const f of ex.fields) {
      const value = jsonPointer(item, f.path);
      if (Array.isArray(value) && value.length > 100) return;
      const scalars = (Array.isArray(value) ? value : [value])
        .filter((v) => ["string", "number", "boolean"].includes(typeof v))
        .map(String);
      if (!bounded(scalars)) return;
      values.set(f.property, [...(values.get(f.property) ?? []), ...scalars]);
    }
  } else {
    if (ex.itemPath) return;
    const doc = parseHtml(body);
    for (const f of ex.fields) {
      const elements = selectElements(f.path, doc, 101);
      if (elements.length > 100) return;
      const scalars = elements.flatMap((el) => {
        const value = f.attribute ? attribute(el, f.attribute) : elementText(el);
        return value === undefined ? [] : [value];
      });
      if (!bounded(scalars)) return;
      values.set(f.property, [...(values.get(f.property) ?? []), ...scalars]);
    }
  }
  return values;
}

/** Object class from the operation's typed object, semantic inputs or endpoint-owned noun. */
export function createdObjectType(op: Operation): string | undefined {
  const typed = op.inputs.find(
    (p) => p.path.length === 1 && p.path[0] === `${SCHEMA}object` && p.range.startsWith(SCHEMA),
  );
  if (typed) return typed.range;
  if (op.actionType === `${SCHEMA}CommentAction`) return `${SCHEMA}Comment`;
  if (op.inputs.some((p) => p.path.at(-1) === `${SCHEMA}headline`))
    return `${SCHEMA}DiscussionForumPosting`;
  if (
    ["PayAction", "OrderAction", "BuyAction"].some((type) => op.actionType === `${SCHEMA}${type}`)
  )
    return `${SCHEMA}Order`;
  return endpointItemType(op.request.urlTemplate)?.itemType;
}

/** Read the whole submitted input from the concrete wire inventory, excluding unused inputs. */
export function sentInputValue(
  op: Operation,
  inputs: Record<string, string>,
  input: string,
  origin: string,
): string | undefined {
  if (!op.inputs.some((p) => p.name === input) || inputs[input] === undefined) return;
  try {
    const actual = effectiveWireFields(compileOperation(op, inputs, origin));
    let marker = "sab_success_input_marker";
    while (actual.some((field) => field.value.includes(marker))) marker += "_x";
    const probe = effectiveWireFields(
      compileOperation(op, { ...inputs, [input]: marker }, origin, {
        placeholders: new Set([input]),
      }),
    );
    const values = probe
      .filter((f) => f.value === marker && !f.sessionToken)
      .flatMap((f) =>
        actual
          .filter((a) => a.location === f.location && a.name === f.name && !a.sessionToken)
          .map((a) => a.value),
      );
    return values.length && values.every((v) => v === values[0]) ? values[0] : undefined;
  } catch {
    return;
  }
}

/** Opaque structural evidence for a witnessed missing resource, never a generic HTTP-status rule. */
export function notFoundSignature(
  status: number,
  contentType: string | undefined,
  body: string,
): { status: 404 | 410; contentType: string; structure: string } | undefined {
  if (status !== 404 && status !== 410) return;
  const media = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const detected = /^\s*</.test(body)
    ? "text/html"
    : /^\s*[[{]/.test(body)
      ? "application/json"
      : media;
  if (responsePageError(body, detected, false, true)) return;
  let structure: unknown;
  try {
    if (/json/i.test(detected)) {
      const shape = (value: unknown, discriminator = false): unknown => {
        if (Array.isArray(value)) return ["array", value.map((v) => shape(v, discriminator))];
        if (value && typeof value === "object")
          return Object.keys(value)
            .sort()
            .map((key) => [
              key,
              shape((value as Record<string, unknown>)[key], isDiscriminatorKey(key)),
            ]);
        return discriminator ? [typeof value, value] : value === null ? "null" : typeof value;
      };
      // Root scalars keep their exact value: "not_found" never matches another scalar.
      structure = shape(JSON.parse(body), true);
    } else if (/html/i.test(detected) && elementChildren(parseHtml(body))) {
      const shape = (nodes: ReturnType<typeof parseHtml>["children"]): unknown =>
        nodes.flatMap((node): unknown[] =>
          "name" in node && "attribs" in node && "children" in node
            ? [[node.name, Object.keys(node.attribs).sort(), shape(node.children)]]
            : [],
        );
      const doc = parseHtml(body);
      structure = [
        shape(doc.children),
        selectElements("title, h1, h2, h3, h4, h5, h6, [role=heading]", doc).map((el) =>
          elementText(el),
        ),
        // Text beside the top-level elements keeps its exact normalised value.
        doc.children.flatMap((node) =>
          node.type === "text" && "data" in node && String(node.data).trim()
            ? [String(node.data).replace(/\s+/g, " ").trim()]
            : [],
        ),
      ];
    } else {
      // A non-JSON, non-HTML body, or an HTML document without elements (empty, bare text,
      // doctype plus text), is one scalar text document: its exact normalised text is the
      // structure and the same token/status rules apply.
      const text = /html/i.test(detected) ? elementText(parseHtml(body)) : body.trim();
      let scalar: unknown = text;
      try {
        scalar = JSON.parse(text);
      } catch {
        /* Plain text stays the scalar value. */
      }
      if (jsonRootFailure(scalar) || authenticationDiscriminator(text) || authenticationText(text))
        return;
      structure = text;
    }
    return {
      status,
      contentType: media,
      structure: createHash("sha256").update(JSON.stringify(structure)).digest("hex"),
    };
  } catch {
    return;
  }
}

/** Cache-hit metadata invalidates effect evidence even when the transport ignored no-store. */
export function staleVerificationResponse(
  headers: Headers | Readonly<Record<string, string>>,
): boolean {
  // Playwright joins repeated Set-Cookie with newlines. Preserve its response
  // metadata without constructing Fetch Headers, which rejects those values.
  const entries =
    headers instanceof Headers
      ? [...headers]
      : Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value] as const);
  const ages = entries.filter(([name]) => name === "age").map(([, value]) => value);
  const age = ages.length ? ages.join(", ") : null;
  return (
    (age !== null && (!/^\s*\d+\s*$/.test(age) || Number(age) > 0)) ||
    entries.some(
      ([name, value]) =>
        (/(?:cache|cached|varnish)/i.test(name) &&
          /(?:^|[^a-z])(?:hit|stale|cached|true)(?:[^a-z]|$)/i.test(value)) ||
        (/cache.hits?$/i.test(name) && Number(value) > 0),
    )
  );
}
