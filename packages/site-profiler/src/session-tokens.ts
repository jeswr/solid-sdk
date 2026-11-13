// AUTHORED-BY Codex GPT-6
// Opaque values are session material only when a page/cookie supplies them and at least two
// requests repeat them. Ordinary IDs, one-off nonces and user input never qualify by shape alone.
import type { CsrfSource } from "@jeswr/site-model";
import { parse } from "acorn";
import { isCsrfFieldName } from "./forms.js";
import { attr, attrValue, descendants, parseHtml } from "./html.js";
import type { RecordedRequest } from "./types.js";

export type SessionTokens = ReadonlyMap<string, CsrfSource>;
const opaque = (v: string) =>
  v.length >= 16 && v.length <= 256 && /^[A-Za-z0-9_-]+$/.test(v) && /[a-z]/i.test(v);

// AUTHORED-BY Codex GPT-6.1-Sol
/** Explicit credentials qualify on their first use. Unsupported script sources are secrets only. */
export function discoverCredentialSources(
  pages: Array<{ url: string; html: string }>,
  cookies: Array<{ name: string; value: string }>,
): { tokens: Map<string, CsrfSource>; secrets: Set<string> } {
  const tokens = new Map<string, CsrfSource>();
  const secrets = new Set<string>();
  const credentialName = (name: string) =>
    isCsrfFieldName(name) || /token|secret|session|auth|password|api.?key/i.test(name);
  const scriptSecrets = (source: string) => {
    const visit = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      const node = value as Record<string, unknown>;
      const left = node.left as Record<string, unknown> | undefined;
      const key = (node.id ?? node.key ?? left?.property ?? left) as
        | Record<string, unknown>
        | undefined;
      const name = key?.name ?? key?.value;
      const rhs = (node.init ?? node.value ?? node.right) as Record<string, unknown> | undefined;
      if (typeof name === "string" && credentialName(name)) {
        const literals = (value: unknown): void => {
          if (!value || typeof value !== "object") return;
          const item = value as Record<string, unknown>;
          if (item.type === "Literal" && typeof item.value === "string") secrets.add(item.value);
          if (item.type === "TemplateElement") {
            const cooked = (item.value as Record<string, unknown>)?.cooked;
            if (typeof cooked === "string" && cooked) secrets.add(cooked);
          }
          for (const child of Object.values(item)) {
            if (Array.isArray(child)) child.forEach(literals);
            else if (child && typeof child === "object") literals(child);
          }
        };
        literals(rhs);
      }
      for (const child of Object.values(node)) {
        if (Array.isArray(child)) child.forEach(visit);
        else if (child && typeof child === "object") visit(child);
      }
    };
    try {
      visit(parse(source, { ecmaVersion: "latest", sourceType: "module" }));
    } catch {
      // Invalid scripts teach no source; still retain obvious credential literals for redaction.
      for (const match of source.matchAll(/([\w$]+)\s*[:=]\s*["']([^"'\r\n]+)["']/g))
        if (credentialName(match[1] ?? "")) secrets.add(match[2] ?? "");
    }
  };
  for (const page of pages) {
    for (const el of descendants(parseHtml(page.html))) {
      if (el.name === "script")
        scriptSecrets(el.children.map((child) => ("data" in child ? child.data : "")).join(""));
      const name = attr(el, "name") ?? "";
      const value = attr(el, el.name === "meta" ? "content" : "value");
      if (!value) continue;
      if (el.name === "input" && attr(el, "type") === "password") secrets.add(value);
      if (!credentialName(name)) continue;
      if (el.name === "meta") {
        tokens.set(value, { kind: "meta", urlTemplate: page.url, name });
        secrets.add(value);
      } else if (el.name === "input" && attr(el, "type") === "hidden") {
        tokens.set(value, {
          kind: "html",
          urlTemplate: page.url,
          selector: `input[name=${attrValue(name)}]`,
          attribute: "value",
        });
        secrets.add(value);
      }
    }
  }
  for (const cookie of cookies) {
    if (!cookie.value) continue;
    tokens.set(cookie.value, { kind: "cookie", name: cookie.name });
    secrets.add(cookie.value);
  }
  return { tokens, secrets };
}

export function discoverSessionTokens(
  pages: Array<{ url: string; html: string }>,
  cookies: Array<{ name: string; value: string }>,
  requests: readonly RecordedRequest[],
): Map<string, CsrfSource> {
  const sources = new Map<string, CsrfSource>();
  for (const page of pages) {
    for (const el of descendants(parseHtml(page.html))) {
      const name = attr(el, "name");
      const value = attr(el, el.name === "meta" ? "content" : "value");
      if (!name || !value || !opaque(value)) continue;
      if (el.name === "input" && attr(el, "type") === "hidden")
        sources.set(value, {
          kind: "html",
          urlTemplate: page.url,
          selector: `input[name=${attrValue(name)}]`,
          attribute: "value",
        });
      else if (el.name === "meta")
        sources.set(value, { kind: "meta", urlTemplate: page.url, name });
    }
  }
  for (const c of cookies)
    if (opaque(c.value)) sources.set(c.value, { kind: "cookie", name: c.name });
  const counts = new Map<string, number>();
  for (const r of requests) {
    const u = new URL(r.url);
    const values = new Set([
      ...u.pathname.split("/").map((v) => {
        try {
          return decodeURIComponent(v);
        } catch {
          return v;
        }
      }),
      ...u.searchParams.values(),
    ]);
    for (const v of values) if (sources.has(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return new Map([...sources].filter(([v]) => (counts.get(v) ?? 0) >= 2));
}

/** Redact learned tokens in every returned trace surface, including escaped URLs and HTML. */
export function redactTrace(
  requests: RecordedRequest[],
  tokens: Iterable<string>,
): RecordedRequest[] {
  const secrets = [...new Set(tokens)].filter(Boolean).sort((a, b) => b.length - a.length);
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") {
      let out = value;
      for (const token of secrets)
        for (const form of new Set([
          token,
          encodeURIComponent(token),
          JSON.stringify(token).slice(1, -1),
        ]))
          out = out.split(form).join("[redacted]");
      return out;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    return value;
  };
  return walk(requests) as RecordedRequest[];
}
