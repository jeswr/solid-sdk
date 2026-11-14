// AUTHORED-BY Claude Opus 5.5
// The one HTML form-control classifier. Every input-type decision (credential discovery,
// selector witnessing, password detection, form learning) uses these helpers so that
// type="HIDDEN", type="HiDdEn" and type="Password" mean exactly what a browser takes them to mean.

import { isTag } from "domhandler";
import { parseDocument } from "htmlparser2";

/** Any parsed element shape: domhandler elements and plain { name, attribs } records. */
export interface HtmlControlElement {
  readonly name: string;
  readonly attribs: Readonly<Record<string, string>>;
}

const INPUT_TYPES = new Set([
  "hidden",
  "text",
  "search",
  "tel",
  "url",
  "email",
  "password",
  "date",
  "month",
  "week",
  "time",
  "datetime-local",
  "number",
  "range",
  "color",
  "checkbox",
  "radio",
  "file",
  "submit",
  "image",
  "reset",
  "button",
]);
const BUTTON_TYPES = new Set(["submit", "reset", "button"]);

/** ASCII lowercase only: Unicode folding (e.g. U+212A KELVIN SIGN to "k") is not HTML matching. */
export function asciiLowerCase(value: string): string {
  return value.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
}

/**
 * An attribute value looked up with an ASCII-case-insensitive name. HTML parsers lower-case
 * names already; other producers may not, and the first attribute in source order wins.
 */
export function htmlAttribute(el: HtmlControlElement, name: string): string | undefined {
  const wanted = asciiLowerCase(name);
  for (const [key, value] of Object.entries(el.attribs))
    if (asciiLowerCase(key) === wanted) return value;
  return undefined;
}

/**
 * The control type an element denotes under HTML semantics, or undefined for a non-control.
 * input: an ASCII-case-insensitive keyword; a missing or invalid value is the text state.
 * button: submit/reset/button, missing or invalid is submit. select and textarea name themselves.
 */
export function htmlControlType(el: HtmlControlElement): string | undefined {
  const tag = asciiLowerCase(el.name);
  if (tag === "select" || tag === "textarea") return tag;
  if (tag !== "input" && tag !== "button") return undefined;
  const raw = htmlAttribute(el, "type");
  const type = raw === undefined ? undefined : asciiLowerCase(raw);
  if (tag === "button") return type && BUTTON_TYPES.has(type) ? type : "submit";
  return type && INPUT_TYPES.has(type) ? type : "text";
}

/** True when `el` is an <input> whose HTML type state is `type` (given in lower case). */
export function isHtmlInputType(el: HtmlControlElement, type: string): boolean {
  return asciiLowerCase(el.name) === "input" && htmlControlType(el) === type;
}

/** The first element of a raw tag string, parsed with HTML rules (for text-level rewriters). */
export function parseHtmlTag(tag: string): HtmlControlElement | undefined {
  const el = parseDocument(tag, { decodeEntities: true }).children.find(isTag);
  return el ? { name: el.name, attribs: el.attribs } : undefined;
}
