// AUTHORED-BY Codex GPT-6.1-Sol
// Explicit HTML navigation controls can describe sorting and cursor inputs without a form.
import { isCsrfFieldName } from "./forms.js";
import { attr, descendants, type Element, parseHtml, text } from "./html.js";
import { matchRequest } from "./templates.js";
import type { EndpointCandidate, RecordedRequest } from "./types.js";
import { varName } from "./util.js";

export function sortLinks(html: string): Element[] {
  const links = new Set<Element>();
  for (const button of descendants(parseHtml(html))) {
    if (
      button.name !== "button" ||
      !/sort(?: by)?|order by/i.test(attr(button, "aria-label") ?? text(button))
    )
      continue;
    const container = button.parent;
    if (container?.type !== "tag") continue;
    for (const el of descendants(container)) if (el.name === "a" && attr(el, "href")) links.add(el);
  }
  return [...links];
}
const navigationCache = new WeakMap<object, { next: URL[]; sorted: URL[] }>();
function navigation(page: { url: string; html: string }) {
  let result = navigationCache.get(page);
  if (result) return result;
  const urls = (elements: Element[]) =>
    elements.flatMap((el) => {
      try {
        const url = new URL(attr(el, "href") ?? "", page.url);
        return url.origin === new URL(page.url).origin ? [url] : [];
      } catch {
        return [];
      }
    });
  result = {
    next: urls(
      descendants(parseHtml(page.html)).filter((e) => e.name === "a" && attr(e, "rel") === "next"),
    ),
    sorted: urls(sortLinks(page.html)),
  };
  navigationCache.set(page, result);
  return result;
}
export function addNavigationInputs(
  c: EndpointCandidate,
  pages: Array<{ url: string; html: string }>,
): EndpointCandidate {
  if (c.method !== "GET") return c;
  const params = c.params.map((p) => ({ ...p }));
  let urlTemplate = c.urlTemplate;
  for (const page of pages) {
    const nav = navigation(page);
    for (const url of nav.next) {
      const matched = matchRequest(c, {
        method: "GET",
        url: url.href,
        requestHeaders: {},
      } as RecordedRequest);
      if (
        !matched ||
        c.params.some(
          (p) =>
            p.location === "path" && p.kind === "numeric" && !/^\d+$/.test(matched[p.name] ?? ""),
        )
      )
        continue;
      for (const [key, value] of url.searchParams) {
        const name = varName(key);
        if (
          isCsrfFieldName(key) ||
          c.csrf.some(
            (rule) => rule.target.kind === "query" && [key, name].includes(rule.target.name),
          )
        )
          continue;
        if (!params.some((p) => p.name === name))
          params.push({ name, location: "query", examples: [value], required: false });
      }
    }
    const matches = nav.sorted.flatMap((url) => {
      const values = matchRequest(c, {
        method: "GET",
        url: url.href,
        requestHeaders: {},
      } as RecordedRequest);
      return values ? [values] : [];
    });
    for (const param of params.filter((p) => p.location === "path" && p.name === "sort")) {
      const options = [
        ...new Set(matches.map((m) => m[param.name]).filter((v): v is string => v !== undefined)),
      ];
      if (options.length < 2 || params.some((p) => p.name === "sort" && p !== param)) continue;
      urlTemplate = urlTemplate.replaceAll(`{${param.name}}`, "{sort}");
      param.name = "sort";
      param.options = options;
    }
  }
  const query = params.filter((p) => p.location === "query").map((p) => p.name);
  const base = urlTemplate.replace(/\{[?&][^}]*\}$/, "");
  return {
    ...c,
    params,
    urlTemplate:
      base + (query.length ? `{${base.includes("?") ? "&" : "?"}${query.join(",")}}` : ""),
  };
}
