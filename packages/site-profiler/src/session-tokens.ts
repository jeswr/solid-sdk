// AUTHORED-BY Codex GPT-6
// Opaque values are session material only when a page/cookie supplies them and at least two
// requests repeat them. Ordinary IDs, one-off nonces and user input never qualify by shape alone.
import type { CsrfSource } from "@jeswr/site-model";
import { attr, attrValue, descendants, parseHtml } from "./html.js";
import type { RecordedRequest } from "./types.js";

export type SessionTokens = ReadonlyMap<string, CsrfSource>;
const opaque = (v: string) =>
  v.length >= 16 && v.length <= 256 && /^[A-Za-z0-9_-]+$/.test(v) && /[a-z]/i.test(v);

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
