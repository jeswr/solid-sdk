// AUTHORED-BY Codex GPT-6.1-Sol
// Demonstrated text forms: meaningful inputs, witnessed fixed fields, fresh CSRF sources.
import { isSelectionFilter } from "@jeswr/site-model";
import { formCsrfRules, isCsrfFieldName, parseForms } from "./forms.js";
import { attr, attrValue, descendants, parseHtml, text } from "./html.js";
import { requestValues } from "./templates.js";
import type { CandidateParam, EndpointCandidate } from "./types.js";

const roles: Record<string, string> = {
  name: "name",
  title: "title",
  body: "body",
  text: "text",
  comment: "text",
  forum: "forum",
  sku: "sku",
  price: "price",
  qty: "quantity",
  quantity: "quantity",
};
function leaf(name: string): string {
  return (
    name
      .split(/[[\].]/)
      .filter(Boolean)
      .at(-1)
      ?.toLowerCase() ?? name
  );
}
export function learnDemonstratedForm(
  c: EndpointCandidate,
  pages: Array<{ url: string; html: string }> = [],
): EndpointCandidate {
  if (
    c.method === "GET" ||
    !["multipart/form-data", "application/x-www-form-urlencoded"].includes(c.contentType ?? "")
  )
    return c;
  const samples = c.samples.filter(
    (r) =>
      r.phase === "demonstration" &&
      !r.blocked &&
      r.status !== undefined &&
      r.status >= 200 &&
      r.status < 400,
  );
  if (!samples.length) return c;
  const first = samples[0];
  if (!first) return c;
  const sent = requestValues(first).body;
  const forumNames = new Set(
    pages.flatMap((page) =>
      descendants(parseHtml(page.html))
        .filter((el) => el.name === "select" && leaf(attr(el, "name") ?? "") === "forum")
        .flatMap((select) =>
          descendants(select)
            .filter((el) => el.name === "option")
            .map((option) => attr(option, "data-name") ?? text(option)),
        ),
    ),
  );
  const forumParam = c.params.find(
    (p) =>
      p.location === "path" &&
      p.kind === "known-id" &&
      p.examples.length &&
      p.examples.every((value) => forumNames.has(value)),
  );
  if (forumParam && forumParam.name !== "forumName") {
    const old = forumParam.name;
    c = {
      ...c,
      urlTemplate: c.urlTemplate.replaceAll(`{${old}}`, "{forumName}"),
      params: c.params.map((p) => (p === forumParam ? { ...p, name: "forumName" } : p)),
    };
  }
  // Scope token sources to the form actually used by this demonstration. A page may
  // contain many identical token names (one per row), each protecting a different item.
  const relevant = pages.filter((p) =>
    parseForms(p.html, p.url).some((f) => f.action === first.url),
  );
  const page = relevant.sort((a, b) => a.url.length - b.url.length)[0];
  const form = page && parseForms(page.html, page.url).find((f) => f.action === first.url);
  const templateIdentity = (value: string) => {
    for (const param of c.params.filter(
      (p) => p.location === "path" && (p.kind === "numeric" || p.name === "forumName"),
    )) {
      const example = param.examples[0];
      if (example)
        value = value.replace(
          new RegExp(
            `(^|[/_])${example.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[/\\[\\"_]|$)`,
            "g",
          ),
          `$1{${param.name}}`,
        );
    }
    return value;
  };
  if (form && page) {
    const rules = formCsrfRules(form, templateIdentity(page.url));
    c = {
      ...c,
      form,
      csrf: [
        ...c.csrf.filter((r) => r.target.kind !== "form" || r.source.kind === "cookie"),
        ...rules
          .map((r) => ({
            ...r,
            source:
              r.source.kind === "html"
                ? { ...r.source, selector: templateIdentity(r.source.selector) }
                : r.source,
            target: { ...r.target, name: templateIdentity(r.target.name) },
          }))
          .filter(
            (r) =>
              !c.csrf.some(
                (existing) =>
                  existing.source.kind === "cookie" && existing.target.name === r.target.name,
              ),
          ),
      ],
    };
  }
  // Flat ordinary forms already carry useful names/defaults/options. Preserve their
  // established surface; normalization is for witnessed composite JS form payloads.
  if (!sent.some(([name]) => /[[\]]/.test(name))) return c;
  let urlTemplate = c.urlTemplate;
  const params = c.params
    .filter((p) => p.location !== "body" && p.location !== "form")
    .map((p) => ({ ...p }));
  for (let i = params.length - 1; i >= 0; i--) {
    const p = params[i];
    if (!p) continue;
    if (p.location !== "path" || !p.examples.length || p.examples.some((v) => v !== p.examples[0]))
      continue;
    const prefix = urlTemplate.split(`{${p.name}}`)[0] ?? "";
    if (
      p.name === "forumName" ||
      /\/(?:id|identifier|products?|items?|orders?|customers?)\/$/i.test(prefix) ||
      (p.kind === "numeric" && !/\/(?:type|store|set|version)\/$/i.test(prefix))
    )
      continue;
    urlTemplate = urlTemplate.replace(`{${p.name}}`, encodeURIComponent(p.examples[0] ?? ""));
    params.splice(i, 1);
  }
  const itemPath = params.find(
    (p) =>
      p.location === "path" && /\/(?:id|identifier)\/\{$/.test(urlTemplate.split(p.name)[0] ?? ""),
  );
  if (itemPath && itemPath.name !== "id") {
    urlTemplate = urlTemplate.replace(`{${itemPath.name}}`, "{id}");
    itemPath.name = "id";
  }
  const bindName = (name: string) => {
    for (const param of params.filter((p) => p.location === "path" && p.kind === "numeric")) {
      const value = param.examples[0];
      if (value && param.examples.every((v) => v === value))
        name = name.replace(new RegExp(`(^|_)${value}(?=\\[|_|$)`, "g"), `$1{${param.name}}`);
    }
    return name;
  };
  const csrf = c.csrf.map((rule) => ({
    ...rule,
    target: { ...rule.target, name: bindName(rule.target.name) },
    source:
      rule.source.kind === "html"
        ? { ...rule.source, selector: bindName(rule.source.selector) }
        : rule.source,
  }));
  // A standalone hidden input may protect a JS-rendered form. A witnessed cookie wins.
  for (const [name] of sent) {
    if (
      !isCsrfFieldName(name) ||
      csrf.some((r) => r.target.kind === "form" && r.target.name === bindName(name))
    )
      continue;
    const hidden = pages.find((page) =>
      descendants(parseHtml(page.html)).some(
        (el) => el.name === "input" && attr(el, "type") === "hidden" && attr(el, "name") === name,
      ),
    );
    const meta = pages.find((page) =>
      descendants(parseHtml(page.html)).some(
        (el) => el.name === "meta" && attr(el, "name") === name && attr(el, "content"),
      ),
    );
    if (hidden)
      csrf.push({
        source: {
          kind: "html",
          urlTemplate: hidden.url,
          selector: `input[name=${attrValue(bindName(name))}]`,
          attribute: "value",
        },
        target: { kind: "form", name: bindName(name) },
      });
    else if (meta)
      csrf.push({
        source: { kind: "meta", urlTemplate: meta.url, name },
        target: { kind: "form", name: bindName(name) },
      });
    else
      return {
        ...c,
        unsupported:
          "required CSRF source unavailable (script variables are not a supported source kind)",
      };
  }

  const template = new URLSearchParams();
  const used = new Map<string, string>();
  for (const [wireName, value] of sent) {
    if (
      isCsrfFieldName(wireName) ||
      csrf.some((r) => r.target.kind === "form" && r.target.name === bindName(wireName))
    )
      continue;
    // A redacted field can never be a static replay value.
    if (/\[redacted\]/i.test(value)) continue;
    const boundPath = params.find(
      (p) => p.location === "path" && p.examples.includes(value) && value.length > 1,
    );
    if (boundPath && /(?:^|_)id$/.test(leaf(wireName))) {
      template.append(bindName(wireName), `{${boundPath.name}}`);
      continue;
    }
    const identityField = /^(?:selected|ids?|identifiers?)(?:\[\d*\])?$/i.test(wireName);
    const role = identityField
      ? "id"
      : isSelectionFilter(wireName)
        ? wireName.replace(/\[([^\]]+)\]/g, ".$1")
        : roles[leaf(wireName)];
    if (role && (value !== "" || isSelectionFilter(wireName))) {
      const seen = used.get(role);
      if (seen && seen !== value) return c; // ambiguous repeated semantic fields: retain the original evidence
      if (!seen) {
        const values = samples.map(
          (r) => requestValues(r).body.find(([name]) => name === wireName)?.[1],
        );
        const p: CandidateParam = {
          name: role,
          location: "form",
          required: values.every((v) => v !== undefined && v !== ""),
          examples: [...new Set(values.filter((v): v is string => v !== undefined))],
          formType: "text",
        };
        params.push(p);
        used.set(role, value);
      }
      template.append(bindName(wireName), `{${role}}`);
    } else {
      // Only stable, actually sent incidental values become literals. Never infer a field
      // from the page, and never fix an opaque session-looking value in a template.
      if (/^[A-Za-z0-9_-]{16,256}$/.test(value) && /[a-z]/i.test(value) && /\d/.test(value))
        continue;
      if (
        samples.every((r) =>
          requestValues(r).body.some(([name, v]) => name === wireName && v === value),
        )
      )
        template.append(bindName(wireName), value);
    }
  }
  return { ...c, urlTemplate, params, csrf, bodyTemplate: template.toString() };
}
