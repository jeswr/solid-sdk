// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// Step 5: extraction proposals. JSON responses with an array of objects (or one product-like object)
// and HTML pages with repeated items (a link plus a price) or a product detail layout become
// Extraction rules mapping to schema.org by key name. Third-party text (descriptions, reviews) is
// marked untrusted so the planner only ever sees it as data.

import type { Extraction, FieldRule } from "@jeswr/site-model";
import {
  attr,
  classes,
  type Document,
  descendants,
  type Element,
  elementChildren,
  parseHtml,
  selectAll,
  simpleSelector,
  text,
} from "./html.js";
import { jsonPointer, pointerEscape, s, sab, tryJson, xsd } from "./util.js";

interface KeyRule {
  property: string;
  datatype?: string;
  untrusted?: boolean;
}

const KEY_RULES: Array<[RegExp, KeyRule]> = [
  [/^(name|title|productname|displayname)$/, { property: s("name") }],
  [
    /^(price|amount|saleprice|unitprice|currentprice)$/,
    { property: s("price"), datatype: xsd("decimal") },
  ],
  [/^totalpaymentdue$/, { property: s("totalPaymentDue"), datatype: xsd("decimal") }],
  [/^(currency|pricecurrency|currencycode)$/, { property: s("priceCurrency") }],
  [/^sku$/, { property: s("sku") }],
  [/^(url|link|href|permalink|weburl)$/, { property: s("url"), datatype: "iri" }],
  [/^(image|imageurl|thumbnail|img)$/, { property: s("image"), datatype: "iri" }],
  [/^(description|summary|blurb|details)$/, { property: s("description"), untrusted: true }],
  [/^(id|entityid|productid|itemid|uuid)$/, { property: s("identifier") }],
  [
    /^(stock|inventory|quantityavailable|available)$/,
    { property: s("inventoryLevel"), datatype: xsd("integer") },
  ],
  [/^(rating|stars|ratingvalue)$/, { property: s("ratingValue"), datatype: xsd("decimal") }],
  [
    /^(body|text|comment|content|reviewbody|reviewtext)$/,
    { property: s("reviewBody"), untrusted: true },
  ],
  [/^(author|reviewer|username)$/, { property: s("author"), untrusted: true }],
  [/^(qty|quantity)$/, { property: s("orderQuantity"), datatype: xsd("integer") }],
  [/^(total|totalprice|grandtotal)$/, { property: s("totalPrice"), datatype: xsd("decimal") }],
  [/^(email|customeremail)$/, { property: s("email") }],
  [/^(firstname|givenname)$/, { property: s("givenName") }],
  [/^(lastname|familyname)$/, { property: s("familyName") }],
  [/^orderstatus$/, { property: s("orderStatus") }],
  [/^(ordernumber|incrementid)$/, { property: s("orderNumber") }],
  [/^(createdat|datecreated)$/, { property: s("dateCreated") }],
  [/^(updatedat|datemodified)$/, { property: s("dateModified") }],
  [/^(ordercurrencycode)$/, { property: s("priceCurrency") }],
];

function normKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The schema.org mapping for a JSON key, given a sample value. */
export function mapKey(key: string, sample: unknown): KeyRule | undefined {
  if (sample !== null && typeof sample === "object") return undefined;
  const k = normKey(key);
  for (const [re, rule] of KEY_RULES) {
    if (!re.test(k)) continue;
    if (rule.datatype === xsd("decimal") && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(sample)))
      return { property: rule.property };
    if (rule.datatype === xsd("integer") && !/^[+-]?\d+$/.test(String(sample)))
      return { property: rule.property };
    return rule;
  }
  return undefined;
}

function field(rule: KeyRule, path: string, attribute?: string): FieldRule {
  const f: FieldRule = { property: rule.property, path };
  if (attribute) f.attribute = attribute;
  if (rule.datatype) f.datatype = rule.datatype;
  if (rule.untrusted) f.untrusted = true;
  return f;
}

function itemTypeFor(fields: FieldRule[]): string {
  const props = new Set(fields.map((f) => f.property));
  if (props.has(s("totalPaymentDue")) || props.has(s("totalPrice")) || props.has(s("orderNumber")))
    return s("Order");
  if (props.has(s("price")) || props.has(s("sku"))) return s("Product");
  if (props.has(s("reviewBody"))) return s("Review");
  if (props.has(s("email")) || props.has(s("givenName"))) return s("Person");
  return s("Thing");
}

function withId(ex: Extraction): Extraction {
  if (ex.fields.some((f) => f.property === s("url") && f.datatype === "iri")) ex.idField = s("url");
  return ex;
}

const LIST_KEYS = ["items", "results", "data", "products", "hits", "records", "entries", "list"];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function findArray(
  doc: unknown,
  depth = 0,
): { pointer: string; items: Record<string, unknown>[] } | undefined {
  if (Array.isArray(doc)) {
    const items = doc.filter(isRecord);
    return items.length && items.length === doc.length ? { pointer: "", items } : undefined;
  }
  if (!isRecord(doc) || depth > 1) return undefined;
  const keys = Object.keys(doc).sort((a, b) => {
    const ia = LIST_KEYS.indexOf(a.toLowerCase());
    const ib = LIST_KEYS.indexOf(b.toLowerCase());
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  for (const k of keys) {
    const v = doc[k];
    if (Array.isArray(v) && v.length && v.every(isRecord)) {
      return { pointer: `/${pointerEscape(k)}`, items: v as Record<string, unknown>[] };
    }
  }
  for (const k of keys) {
    const inner = findArray(doc[k], depth + 1);
    if (inner?.pointer)
      return { pointer: `/${pointerEscape(k)}${inner.pointer}`, items: inner.items };
  }
  return undefined;
}

function fieldsForObject(obj: Record<string, unknown>): FieldRule[] {
  const out: FieldRule[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const rule = mapKey(k, v);
    if (rule && !out.some((f) => f.property === rule.property))
      out.push(field(rule, `/${pointerEscape(k)}`));
  }
  if (
    out.some((f) => [s("totalPrice"), s("orderNumber")].includes(f.property)) &&
    obj.status !== undefined
  )
    out.push({ property: s("orderStatus"), path: "/status" });
  // Unknown scalar keys retain their exact JSON key as a stable, percent-encoded sab property.
  // Arrays/objects and nulls do not become text claims; credential-like keys never become facts.
  for (const [k, v] of Object.entries(obj)) {
    if (
      out.some((f) => f.path === `/${pointerEscape(k)}`) ||
      mapKey(k, v) ||
      v === null ||
      typeof v === "object" ||
      /password|secret|token|csrf|form[_-]?key/i.test(k)
    )
      continue;
    out.push({
      property: sab(encodeURIComponent(k)),
      path: `/${pointerEscape(k)}`,
      ...(typeof v === "string" ? { untrusted: true } : {}),
    });
  }
  return out;
}

const MAX_NESTED = 5;

/** Propose an Extraction for a JSON response body; undefined when nothing maps. */
export function proposeJsonExtraction(body: string | unknown): Extraction | undefined {
  const doc = typeof body === "string" ? tryJson(body) : body;
  if (doc === undefined) return undefined;
  if (isRecord(doc)) {
    const own = fieldsForObject(doc);
    const productLike = own.some((f) =>
      [s("price"), s("sku"), s("totalPaymentDue")].includes(f.property),
    );
    if (own.length >= 2 && productLike) {
      // One item. Nested review arrays: their text becomes untrusted schema:review values.
      for (const [k, v] of Object.entries(doc)) {
        if (!/review|comment/i.test(k) || !Array.isArray(v)) continue;
        v.slice(0, MAX_NESTED).forEach((item, i) => {
          if (!isRecord(item)) return;
          const textKey = Object.keys(item).find(
            (x) => mapKey(x, item[x])?.property === s("reviewBody"),
          );
          if (textKey) {
            own.push({
              property: s("review"),
              path: `/${pointerEscape(k)}/${i}/${pointerEscape(textKey)}`,
              untrusted: true,
            });
          }
        });
      }
      return withId({ format: "json", itemType: itemTypeFor(own), fields: own });
    }
  }
  const found = findArray(doc);
  if (!found) return undefined;
  const merged: Record<string, unknown> = {};
  for (const item of found.items.slice(0, 10)) {
    for (const [k, v] of Object.entries(item)) if (!(k in merged)) merged[k] = v;
  }
  const fields = fieldsForObject(merged);
  if (fields.length < 2) return undefined;
  return withId({ format: "json", itemPath: found.pointer, itemType: itemTypeFor(fields), fields });
}

// ---------------------------------------------------------------------------------------------
// HTML

const PRICE_TEXT = /[£$€¥]\s?\d|\d[.,]\d{2}\s?(?:GBP|USD|EUR)\b/;

function isPriceEl(el: Element): boolean {
  return (
    classes(el).some((c) => /price|cost|amount/i.test(c)) ||
    attr(el, "itemprop") === "price" ||
    attr(el, "data-price") !== undefined
  );
}

function priceElIn(root: Element | Document): Element | undefined {
  return descendants(root).find(isPriceEl);
}

function hasPrice(el: Element): boolean {
  return Boolean(priceElIn(el)) || isPriceEl(el) || PRICE_TEXT.test(text(el));
}

function linkIn(el: Element): Element | undefined {
  if (el.name === "a" && attr(el, "href")) return el;
  return descendants(el).find((d) => d.name === "a" && attr(d, "href") !== undefined);
}

function numericAttr(el: Element, prefer: string[]): string | undefined {
  for (const name of prefer)
    if (attr(el, name) !== undefined && !Number.isNaN(Number(attr(el, name)))) return name;
  for (const [name, value] of Object.entries(el.attribs)) {
    if (name.startsWith("data-") && value !== "" && !Number.isNaN(Number(value))) return name;
  }
  return undefined;
}

function priceFields(priceEl: Element, selector: string): FieldRule[] {
  const fields: FieldRule[] = [];
  const numeric = numericAttr(priceEl, ["data-price", "content", "data-amount", "data-value"]);
  if (numeric)
    fields.push({
      property: s("price"),
      path: selector,
      attribute: numeric,
      datatype: xsd("decimal"),
    });
  else fields.push({ property: s("price"), path: selector });
  const currencyAttr = Object.keys(priceEl.attribs).find((a) => /currency/i.test(a));
  if (currencyAttr)
    fields.push({ property: s("priceCurrency"), path: selector, attribute: currencyAttr });
  return fields;
}

function idAttrFields(el: Element, selector: string): FieldRule[] {
  const fields: FieldRule[] = [];
  for (const name of Object.keys(el.attribs)) {
    if (/^data-(?:[a-z]+-)?id$/.test(name) && !fields.some((f) => f.property === s("identifier"))) {
      fields.push({ property: s("identifier"), path: selector, attribute: name });
    } else if (name === "data-sku")
      fields.push({ property: s("sku"), path: selector, attribute: name });
  }
  return fields;
}

function relativeSelector(root: Element, el: Element): string {
  if (el === root) return ":scope";
  const own = simpleSelector(el);
  const matches = selectAll(root, own);
  if (matches[0] === el) return own;
  const parent = el.parent as Element | null;
  if (parent && parent !== root && parent.type === "tag")
    return `${relativeSelector(root, parent)} > ${own}`;
  return `:scope > ${own}`;
}

function itemish(el: Element): boolean {
  return (
    classes(el).some((c) => /(?:card|item|tile|entry)$|^(?:product|result)$/i.test(c)) ||
    Object.keys(el.attribs).some((a) => /^data-(?:[a-z]+-)?id$/.test(a))
  );
}

interface ListCandidate {
  parent: Element;
  signature: string;
  items: Element[];
}

function findLists(doc: Document): ListCandidate[] {
  const out: ListCandidate[] = [];
  for (const parent of descendants(doc)) {
    const groups = new Map<string, Element[]>();
    for (const c of elementChildren(parent)) {
      const sig = simpleSelector(c);
      groups.set(sig, [...(groups.get(sig) ?? []), c]);
    }
    for (const [sig, items] of groups) {
      const ok = items.filter((i) => linkIn(i) && hasPrice(i));
      if (ok.length !== items.length || items.length === 0) continue;
      if (items.length >= 2 || (items[0] && itemish(items[0])))
        out.push({ parent, signature: sig, items });
    }
  }
  return out.sort((a, b) => b.items.length - a.items.length);
}

function listExtraction(list: ListCandidate): Extraction {
  const sample = list.items[0] as Element;
  const fields: FieldRule[] = [];
  const link = linkIn(sample);
  if (link) {
    const sel = relativeSelector(sample, link);
    const heading = descendants(sample).find((d) => /^h[1-6]$/.test(d.name));
    if (text(link)) fields.push({ property: s("name"), path: sel });
    else if (heading) fields.push({ property: s("name"), path: relativeSelector(sample, heading) });
    fields.push({ property: s("url"), path: sel, attribute: "href", datatype: "iri" });
  }
  const priceEl = priceElIn(sample);
  if (priceEl) fields.push(...priceFields(priceEl, relativeSelector(sample, priceEl)));
  fields.push(...idAttrFields(sample, ":scope"));
  const order = attr(sample, "data-order-id") !== undefined;
  if (order) {
    for (const field of fields) {
      if (field.property === s("identifier")) field.property = s("orderNumber");
      if (field.property === s("price")) field.property = s("totalPrice");
    }
    const date = descendants(sample).find((el) => el.name === "time" && attr(el, "datetime"));
    if (date)
      fields.push({
        property: s("dateCreated"),
        path: relativeSelector(sample, date),
        attribute: "datetime",
        datatype: xsd("dateTime"),
      });
  }
  const parentSel = simpleSelector(list.parent);
  return withId({
    format: "html",
    itemPath: `${parentSel} > ${list.signature}`,
    itemType: order ? s("Order") : itemTypeFor(fields),
    fields,
  });
}

function docSelector(doc: Document, el: Element): string {
  const own = simpleSelector(el);
  if (selectAll(doc, own).length === 1) return own;
  let p = el.parent as Element | null;
  while (p && p.type === "tag") {
    const ps = simpleSelector(p);
    const combined = `${ps} ${own}`;
    if ((attr(p, "id") || classes(p).length) && selectAll(doc, combined)[0] === el) return combined;
    p = p.parent as Element | null;
  }
  return own;
}

function detailExtraction(doc: Document): Extraction | undefined {
  const h1 = descendants(doc).find((e) => e.name === "h1");
  const priceEl = priceElIn(doc);
  if (!h1 || !priceEl) return undefined;
  const fields: FieldRule[] = [{ property: s("name"), path: docSelector(doc, h1) }];
  fields.push(...priceFields(priceEl, docSelector(doc, priceEl)));
  const idHolder = descendants(doc).find((e) =>
    Object.keys(e.attribs).some((a) => /^data-(?:[a-z]+-)?id$/.test(a)),
  );
  if (idHolder) fields.push(...idAttrFields(idHolder, docSelector(doc, idHolder)));
  const skuEl = descendants(doc).find(
    (e) => classes(e).includes("sku") || attr(e, "itemprop") === "sku",
  );
  if (skuEl && !fields.some((f) => f.property === s("sku"))) {
    const kids = elementChildren(skuEl);
    const target = kids.length === 1 && kids[0] ? kids[0] : skuEl;
    fields.push({
      property: s("sku"),
      path:
        target === skuEl ? docSelector(doc, skuEl) : `${docSelector(doc, skuEl)} ${target.name}`,
    });
  }
  const desc = descendants(doc).find(
    (e) =>
      classes(e).some((c) => /^description$|product-description/.test(c)) ||
      attr(e, "itemprop") === "description",
  );
  if (desc)
    fields.push({ property: s("description"), path: docSelector(doc, desc), untrusted: true });
  const review = descendants(doc).find((e) =>
    classes(e).some((c) => /^review$|review-item|comment$/.test(c)),
  );
  if (review) {
    const body =
      descendants(review).find((e) => classes(e).some((c) => /body|text|content/.test(c))) ??
      descendants(review).find((e) => e.name === "p");
    if (body) {
      fields.push({
        property: s("review"),
        path: `${simpleSelector(review)} ${simpleSelector(body)}`,
        untrusted: true,
      });
    }
  }
  return { format: "html", itemType: s("Product"), fields };
}

/** Propose an Extraction for an HTML page: repeated items first, else a product detail layout. */
export function proposeHtmlExtraction(html: string): Extraction | undefined {
  const doc = parseHtml(html);
  const lists = findLists(doc);
  const best = lists[0];
  if (best) return listExtraction(best);
  return detailExtraction(doc);
}

// ---------------------------------------------------------------------------------------------
// Applying an extraction (used to infer flow bindings and to verify operations).

export type Item = Record<string, string[]>;

function resolveIri(value: string, base: string): string {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

function jsonValues(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.flatMap(jsonValues);
  if (typeof v === "object") return [];
  return [String(v)];
}

/** Run an extraction over a response body; each item maps property IRIs to values. */
export function applyExtraction(ex: Extraction, body: string, pageUrl: string): Item[] {
  const items: Item[] = [];
  const push = (item: Item, f: FieldRule, values: string[]) => {
    const vals = f.datatype === "iri" ? values.map((v) => resolveIri(v, pageUrl)) : values;
    if (vals.length) item[f.property] = [...(item[f.property] ?? []), ...vals];
  };
  if (ex.format === "json") {
    const doc = tryJson(body);
    if (doc === undefined) return [];
    const root = ex.itemPath === undefined ? doc : jsonPointer(doc, ex.itemPath);
    const list =
      ex.itemPath !== undefined && Array.isArray(root) ? root : root === undefined ? [] : [root];
    for (const node of list) {
      const item: Item = {};
      for (const f of ex.fields) push(item, f, jsonValues(jsonPointer(node, f.path)));
      items.push(item);
    }
    return items;
  }
  const doc = parseHtml(body);
  const roots: Array<Element | Document> = ex.itemPath ? selectAll(doc, ex.itemPath) : [doc];
  for (const root of roots) {
    const item: Item = {};
    for (const f of ex.fields) {
      const els = selectAll(root, f.path);
      push(
        item,
        f,
        els
          .map((el) => (f.attribute ? attr(el, f.attribute) : text(el)))
          .filter((v): v is string => v !== undefined && v !== ""),
      );
    }
    items.push(item);
  }
  return items;
}
