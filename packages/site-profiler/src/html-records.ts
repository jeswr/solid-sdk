// AUTHORED-BY Codex GPT-6.1-Sol
// Evidence-based HTML records. Selectors are learned from the DOM, never a site's theme.

import type { Extraction, FieldRule } from "@jeswr/site-model";
import { responseIdentity } from "@jeswr/site-model";
import {
  attr,
  classes,
  type Document,
  descendants,
  type Element,
  parseHtml,
  text,
} from "./html.js";
import { s, xsd } from "./util.js";

function tag(el: Element): string {
  if (["html", "body"].includes(el.name)) return el.name;
  const base = classes(el).find((c) => /^[a-zA-Z][\w-]*$/.test(c) && !c.includes("--"));
  const rel = attr(el, "rel");
  return (
    el.name +
    (base ? `.${base}` : "") +
    (!base && rel && /^[a-z]+$/.test(rel) ? `[rel="${rel}"]` : "")
  );
}
function path(root: Element | Document, el: Element): string {
  if (root === el) return ":scope";
  const parent = el.parent;
  return parent && parent !== root && parent.type === "tag"
    ? `${path(root, parent)} > ${tag(el)}`
    : `${root.type === "root" ? "" : ":scope > "}${tag(el)}`;
}
function role(el: Element, pattern: RegExp): boolean {
  return classes(el).some((c) => pattern.test(c));
}
function own(root: Element): Element[] {
  return descendants(root).filter((el) => {
    let p = el.parent;
    while (p && p !== root) {
      if (p.type === "tag" && p.name === "article") return false;
      p = p.parent;
    }
    return true;
  });
}
function field(
  root: Element | Document,
  el: Element,
  property: string,
  attribute?: string,
  untrusted = false,
): FieldRule {
  return {
    property: s(property),
    path: path(root, el),
    ...(attribute ? { attribute } : {}),
    ...(untrusted ? { untrusted: true } : attribute === "href" ? { datatype: "iri" } : {}),
  };
}

/** A witnessed dash permalink can omit only a display slug after the same parent ID. */
function mainPermalink(page: URL, item: URL): boolean {
  if (item.origin !== page.origin) return false;
  if (
    item.pathname === page.pathname ||
    page.pathname.slice(0, page.pathname.lastIndexOf("/")) === item.pathname
  )
    return true;
  const left = page.pathname.split("/"),
    right = item.pathname.split("/");
  if (left.length !== right.length) return false;
  const changed = left.flatMap((part, index) => (part === right[index] ? [] : [index]));
  const at = changed[0];
  return (
    changed.length === 1 &&
    at !== undefined &&
    right[at] === "-" &&
    /^\d+$/.test(left[at - 1] ?? "") &&
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/i.test(left[at] ?? "")
  );
}

/** Separate typed views when one document contains posts, comments and a profile. */
export function htmlRecordExtractions(html: string, endpoint?: string): Extraction[] {
  const doc = parseHtml(html);
  const all = descendants(doc);
  const out: Extraction[] = [];
  const groups = new Map<string, Element[]>();
  for (const el of all.filter((e) => e.name === "article")) {
    const selector = tag(el);
    groups.set(selector, [...(groups.get(selector) ?? []), el]);
  }
  for (const [selector, records] of groups) {
    const root = records[0];
    if (!root) continue;
    const els = own(root);
    const date = els.find((e) => e.name === "time" && attr(e, "datetime"));
    const heading = els.find((e) => /^h[1-6]$/.test(e.name));
    const title = heading && descendants(heading).find((e) => e.name === "a" && attr(e, "href"));
    const body = els.find((e) => role(e, /(?:^|[_-])body$/));
    const permalink = els.find(
      (e) => e.name === "a" && (attr(e, "rel") === "bookmark" || role(e, /(?:^|[_-])permalink$/)),
    );
    const comment = Boolean(
      body && permalink && role(root, /(?:^|[_-])(?:comment|reply)(?:$|[_-])/),
    );
    if (
      !date &&
      !comment &&
      els.some(
        (el) =>
          attr(el, "itemprop") === "price" ||
          attr(el, "data-price") !== undefined ||
          role(el, /(?:^|[_-])price$/),
      )
    )
      continue;
    const fields: FieldRule[] = [];
    if (comment && body && permalink) {
      fields.push(
        field(root, body, "text", undefined, true),
        field(root, permalink, "url", "href"),
      );
      for (const record of records) {
        const parent = own(record).find(
          (e) =>
            e.name === "a" && (attr(e, "rel") === "up" || role(e, /(?:^|[_-])parent(?:-link)?$/)),
        );
        if (parent) {
          fields.push(field(record, parent, "parentItem", "href"));
          break;
        }
      }
    } else if (title) {
      fields.push(field(root, title, date ? "headline" : "name", undefined, true));
      // Prefer a local discussion link to a heading's external submitted URL.
      const count = els.find((e) => attr(e, "data-comment-count") !== undefined);
      const localLink =
        count?.parent?.type === "tag"
          ? descendants(count.parent).find((e) => e.name === "a" && attr(e, "href"))
          : undefined;
      fields.push(field(root, localLink ?? title, "url", "href"));
      if (count) {
        const identityAttr = Object.keys(count.attribs).find((name) =>
          /^data-(?:[a-z]+-)?id$/.test(name),
        );
        if (identityAttr) fields.push(field(root, count, "identifier", identityAttr));
      }
      if (count)
        fields.push({
          ...field(root, count, "commentCount", "data-comment-count"),
          datatype: xsd("integer"),
        });
      if (body) fields.push(field(root, body, "text", undefined, true));
    } else continue;
    if (date) {
      fields.push({ ...field(root, date, "dateCreated", "datetime"), datatype: xsd("dateTime") });
      const author =
        els.find(
          (e) =>
            e.name === "a" &&
            (attr(e, "rel") === "author" || role(e, /(?:^|[_-])(?:author|submitter)$/)),
        ) ?? (comment && heading ? descendants(heading).find((e) => e.name === "a") : undefined);
      if (author) fields.push(field(root, author, "author", undefined, true));
    }
    const page = endpoint && !endpoint.includes("{") ? new URL(endpoint) : undefined;
    const urlField = fields.find((f) => f.property === s("url"));
    const target = urlField && els.find((el) => path(root, el) === urlField.path);
    const href = target && attr(target, "href");
    let ancestor = root.parent;
    while (ancestor && !(ancestor.type === "tag" && ancestor.name === "main"))
      ancestor = ancestor.parent;
    const itemUrl = href && page ? new URL(href, page) : undefined;
    const main =
      records.length === 1 &&
      ancestor &&
      page &&
      itemUrl &&
      responseIdentity(page.href)?.identifier === responseIdentity(itemUrl.href)?.identifier &&
      responseIdentity(page.href) &&
      mainPermalink(page, itemUrl);
    if (main)
      for (const f of fields)
        f.path = `${path(doc, root)} ${f.path.replace(/^:scope\s*>?\s*/, "")}`.trim();
    out.push({
      format: "html",
      ...(main ? {} : { itemPath: selector }),
      itemType: s(comment ? "Comment" : date ? "DiscussionForumPosting" : "CreativeWork"),
      idField: s("url"),
      fields,
    });
  }
  // A profile's own heading link, rather than every author link on the page.
  if (
    endpoint &&
    /\/(?:users?|people|profiles?)\//i.test(new URL(endpoint.replace(/\{[^}]*\}/g, "x")).pathname)
  ) {
    const canonical = all.find((e) => e.name === "link" && attr(e, "rel") === "canonical");
    const target = canonical ? attr(canonical, "href") : endpoint.split("?")[0];
    const link = all.find(
      (e) =>
        e.name === "a" &&
        e.parent?.type === "tag" &&
        /^h[1-6]$/.test(e.parent.name) &&
        target &&
        new URL(attr(e, "href") ?? "", target).href === target &&
        text(e),
    );
    if (link)
      out.unshift({
        format: "html",
        itemType: s("Person"),
        idField: s("url"),
        fields: [field(doc, link, "name", undefined, true), field(doc, link, "url", "href")],
      });
  }
  for (const select of all.filter(
    (e) =>
      e.name === "select" &&
      /(?:^|\[)(?:forum|collection|category)\]?$/i.test(attr(e, "name") ?? ""),
  )) {
    const options = descendants(select).filter((e) => e.name === "option" && attr(e, "value"));
    const first = options[0];
    if (!first) continue;
    // A nonempty value marker avoids the empty "choose one" option without extending CSS.
    const marker = Object.keys(first.attribs).find(
      (name) => /^data-[a-z0-9_-]+$/.test(name) && options.every((o) => attr(o, name)),
    );
    if (marker)
      out.push({
        format: "html",
        itemPath: `${path(doc, select)} > option[${marker}]`,
        itemType: s("CreativeWork"),
        fields: [
          { property: s("name"), path: ":scope", untrusted: true },
          { property: s("identifier"), path: ":scope", attribute: "value" },
        ],
      });
  }
  return out;
}
