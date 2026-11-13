// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// Step 3: form analysis. Reads every form on a page (method, action, fields, select options, hidden
// fields) and turns hidden anti-forgery fields and csrf meta tags into CsrfRules. Never submits.

import type { CsrfRule } from "@jeswr/site-model";
import {
  attr,
  attrValue,
  type Document,
  descendants,
  type Element,
  parseHtml,
  selectAll,
  text,
} from "./html.js";
import type { FormField, FormInfo } from "./types.js";
import { normaliseUrl } from "./util.js";

const CSRF_NAME =
  /csrf|xsrf|authenticity|anti-?forgery|_token$|^token$|nonce|requestverification|form[_-]?key/i;

export function isCsrfFieldName(name: string): boolean {
  return CSRF_NAME.test(name);
}

function formSelector(form: Element, all: Element[]): string {
  const id = attr(form, "id");
  if (id && /^-?[_a-zA-Z][-_a-zA-Z0-9]*$/.test(id)) return `form#${id}`;
  const action = attr(form, "action");
  if (action !== undefined) {
    const sel = `form[action=${attrValue(action)}]`;
    const sameAction = all.filter((f) => attr(f, "action") === action);
    if (sameAction.length === 1) return sel;
    const method = attr(form, "method");
    if (method) return `${sel}[method=${attrValue(method)}]`;
    return sel;
  }
  return "form";
}

function labelFor(doc: Document, el: Element): string | undefined {
  const id = attr(el, "id");
  if (id) {
    const label = descendants(doc).find((l) => l.name === "label" && attr(l, "for") === id);
    if (label) return text(label);
  }
  let p = el.parent as Element | null;
  while (p && p.type === "tag") {
    if (p.name === "label") return text(p);
    p = p.parent as Element | null;
  }
  return attr(el, "placeholder") ?? attr(el, "aria-label");
}

function fieldsOf(doc: Document, form: Element): FormField[] {
  const fields: FormField[] = [];
  for (const el of descendants(form)) {
    const name = attr(el, "name");
    if (!name || attr(el, "disabled") !== undefined) continue;
    if (el.name === "input") {
      const type = (attr(el, "type") ?? "text").toLowerCase();
      if (["submit", "button", "image", "reset", "file"].includes(type)) continue;
      if ((type === "checkbox" || type === "radio") && attr(el, "checked") === undefined) {
        const existing = fields.find((f) => f.name === name);
        const value = attr(el, "value") ?? "on";
        if (existing) existing.options = [...(existing.options ?? []), value];
        else
          fields.push({
            name,
            type,
            required: attr(el, "required") !== undefined,
            hidden: false,
            options: [value],
          });
        continue;
      }
      const field: FormField = {
        name,
        type,
        required: attr(el, "required") !== undefined,
        hidden: type === "hidden",
      };
      const value = attr(el, "value");
      if (value !== undefined) field.value = value;
      const label = labelFor(doc, el);
      if (label && type !== "hidden") field.label = label;
      fields.push(field);
    } else if (el.name === "select") {
      const options = descendants(el).filter((o) => o.name === "option");
      const values = options.map((o) => attr(o, "value") ?? text(o));
      const sel = options.find((o) => attr(o, "selected") !== undefined) ?? options[0];
      const field: FormField = {
        name,
        type: "select",
        required: attr(el, "required") !== undefined,
        hidden: false,
        options: values,
      };
      if (sel) field.selected = attr(sel, "value") ?? text(sel);
      if (field.selected !== undefined) field.value = field.selected;
      const label = labelFor(doc, el);
      if (label) field.label = label;
      fields.push(field);
    } else if (el.name === "textarea") {
      const field: FormField = {
        name,
        type: "textarea",
        required: attr(el, "required") !== undefined,
        hidden: false,
      };
      const label = labelFor(doc, el);
      if (label) field.label = label;
      fields.push(field);
    }
  }
  return fields;
}

/** Every form on a page. */
export function parseForms(html: string, pageUrl: string): FormInfo[] {
  const doc = parseHtml(html);
  const forms = descendants(doc).filter((el) => el.name === "form");
  const out: FormInfo[] = [];
  for (const form of forms) {
    const method = (attr(form, "method") ?? "get").toUpperCase() === "POST" ? "POST" : "GET";
    const action = normaliseUrl(attr(form, "action") || pageUrl, pageUrl);
    if (!action) continue;
    const fields = fieldsOf(doc, form);
    const submitLabels = descendants(form)
      .filter(
        (el) =>
          (el.name === "button" && (attr(el, "type") ?? "submit") === "submit") ||
          (el.name === "input" && attr(el, "type") === "submit"),
      )
      .map((el) => (el.name === "input" ? (attr(el, "value") ?? "Submit") : text(el)));
    out.push({
      pageUrl,
      method,
      action,
      enctype:
        (attr(form, "enctype") ?? "").toLowerCase() === "multipart/form-data"
          ? "multipart/form-data"
          : "application/x-www-form-urlencoded",
      selector: formSelector(form, forms),
      fields,
      hasPassword: fields.some((f) => f.type === "password"),
      submitLabels,
    });
  }
  return out;
}

/**
 * CSRF rules for a form: each hidden anti-forgery field is read from the form's page (given as a
 * URL template) and written back into the same form field.
 */
export function formCsrfRules(form: FormInfo, pageUrlTemplate: string): CsrfRule[] {
  return form.fields
    .filter((f) => f.hidden && isCsrfFieldName(f.name))
    .map((f) => ({
      source: {
        kind: "html" as const,
        urlTemplate: pageUrlTemplate,
        selector: `${form.selector} input[name=${attrValue(f.name)}]`,
        attribute: "value",
      },
      target: { kind: "form" as const, name: f.name },
    }));
}

/** `<meta name="csrf-token" content="...">` style tokens; the header name is the common default. */
export function metaCsrfRules(html: string, pageUrlTemplate: string): CsrfRule[] {
  const doc = parseHtml(html);
  return selectAll(doc, "meta[name][content]")
    .filter((m) => isCsrfFieldName(attr(m, "name") ?? ""))
    .map((m) => ({
      source: { kind: "meta" as const, urlTemplate: pageUrlTemplate, name: attr(m, "name") ?? "" },
      target: { kind: "header" as const, name: "X-CSRF-Token" },
    }));
}

/**
 * Sample values for a GET form so the crawler can visit its result page: free-text fields get a
 * word seen on the site, selects their selected option, hidden fields their value.
 */
export function sampleGetUrl(form: FormInfo, word: string): string | undefined {
  if (form.method !== "GET") return undefined;
  const url = new URL(form.action);
  url.search = "";
  for (const f of form.fields) {
    if (f.hidden) url.searchParams.append(f.name, f.value ?? "");
    else if (f.type === "select")
      url.searchParams.append(f.name, f.selected ?? f.options?.[0] ?? "");
    else if (f.type === "checkbox" || f.type === "radio") continue;
    else if (f.type === "number" || f.type === "range")
      url.searchParams.append(f.name, f.value ?? "1");
    else url.searchParams.append(f.name, f.value || word);
  }
  return url.toString();
}
