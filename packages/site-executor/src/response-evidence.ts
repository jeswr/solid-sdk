// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
// Shared negative evidence; callers still need positive resource/success evidence.
import { createHash } from "node:crypto";
import type { Extraction, Operation } from "@jeswr/site-model";
import { endpointItemType, SCHEMA } from "@jeswr/site-model";
import { compileOperation } from "./compile.js";
import { attribute, elementText, jsonPointer, parseHtml, selectElements } from "./dom.js";
import { effectiveWireFields } from "./wire.js";

export function jsonFailure(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).some(
      ([key, member]) =>
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
          /^(?:error|fail|failed|failure|unauthenticated|unauthorized|401|403)$/i.test(
            String(member).trim(),
          )),
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
        (value !== null && typeof value === "object" && Object.values(value).some(walk));
      return walk(doc);
    } catch {
      return true;
    }
  }
  if (!/html/i.test(contentType ?? "") && !/^\s*</.test(body)) return false;
  const doc = parseHtml(body);
  if (
    selectElements('input[type="password"]', doc).length ||
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
      const shape = (value: unknown): unknown => {
        if (Array.isArray(value)) return ["array", value.map(shape)];
        if (value && typeof value === "object")
          return Object.keys(value)
            .sort()
            .map((key) => [key, shape((value as Record<string, unknown>)[key])]);
        return value === null ? "null" : typeof value;
      };
      structure = shape(JSON.parse(body));
    } else if (/html/i.test(detected)) {
      const shape = (nodes: ReturnType<typeof parseHtml>["children"]): unknown =>
        nodes.flatMap((node): unknown[] =>
          "name" in node && "attribs" in node && "children" in node
            ? [[node.name, Object.keys(node.attribs).sort(), shape(node.children)]]
            : [],
        );
      structure = shape(parseHtml(body).children);
    } else structure = body.trim();
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
