// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// Small shared helpers: URL classification, value kinds, names, and a minimal RFC 6570 expander for
// the templates the profiler itself writes (used to replay operations during verification).

import { SAB, SCHEMA } from "@jeswr/site-model";
import type { ParamKind } from "./types.js";

export const XSD = "http://www.w3.org/2001/XMLSchema#";
export const s = (local: string) => `${SCHEMA}${local}`;
export const sab = (local: string) => `${SAB}${local}`;
export const xsd = (local: string) => `${XSD}${local}`;

const STATIC_EXT =
  /\.(?:js|mjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|pdf|zip|txt|xml)$/i;
const STATIC_TYPES = new Set([
  "stylesheet",
  "script",
  "image",
  "font",
  "media",
  "manifest",
  "texttrack",
  "eventsource",
  "websocket",
]);

export function isStatic(url: string, resourceType?: string): boolean {
  if (resourceType && STATIC_TYPES.has(resourceType)) return true;
  try {
    const path = new URL(url).pathname;
    return STATIC_EXT.test(path) || /\/(?:static|assets)\/.*\.(?:html?|json)$/i.test(path);
  } catch {
    return false;
  }
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** Absolute URL without fragment; undefined when it does not parse or is not http(s). */
export function normaliseUrl(href: string, base?: string): string | undefined {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    u.hash = "";
    return u.toString();
  } catch {
    return undefined;
  }
}

const SESSION_END = /log[-_ ]?out|sign[-_ ]?out|log[-_ ]?off|unsubscribe/;

/** Decoded query names and values; malformed escapes stay as written. */
function queryWords(url: string): string {
  const query = url.split("#")[0]?.split("?").slice(1).join("?") ?? "";
  const decode = (part: string) => {
    try {
      return decodeURIComponent(part.replace(/\+/g, " "));
    } catch {
      return part;
    }
  };
  return query
    .split(/[&;]/)
    .flatMap((pair) => pair.split("=").map(decode))
    .join(" ");
}

/**
 * Links a crawler must never follow: they change state even though they are GETs on bad sites.
 * The path (and link text) is checked for any state-changing word; the query string's decoded
 * names and values only for session-ending words (round 22: `?route=account/logout`,
 * `?action=logout`, `?logout=1`, `?signout`), so a search for "delete" stays a search.
 */
export function isDangerousLink(url: string, text = ""): boolean {
  let path = url.split("?")[0] ?? url;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    /* templates and malformed links still get classified */
  }
  const words = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  if (SESSION_END.test(words(queryWords(url)))) return true;
  const hay = words(`${path} ${text}`);
  return /log-?out|sign-?out|logoff|unsubscribe|\bdelete\b|\bremove\b|\bcancel\b|destroy|\b(?:save|create|update|enable|disable|flush|refresh|reset|reindex|reorder|duplicate|send|run|execute|truncate|drop)\b/.test(
    hay,
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SKU = /^(?=[A-Z0-9-]*\d)[A-Z0-9]+(?:-[A-Z0-9]+)+$/;

/** How an identifier-like value looks; 'text' when it looks like a word. */
export function valueKind(value: string, knownIds?: ReadonlySet<string>): ParamKind {
  if (/^\d+$/.test(value)) return "numeric";
  if (UUID.test(value)) return "uuid";
  if (SKU.test(value)) return "sku";
  if (knownIds?.has(value)) return "known-id";
  return "text";
}

export function singular(word: string): string {
  if (/ies$/i.test(word)) return `${word.slice(0, -3)}y`;
  if (/(?:ss|us)$/i.test(word)) return word;
  if (/s$/i.test(word)) return word.slice(0, -1);
  return word;
}

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "x"
  );
}

/** A legal RFC 6570 varname: ALPHA / DIGIT / "_" / "." / pct-encoded. */
export function varName(raw: string): string {
  const out = Array.from(raw)
    .map((ch) => (/[A-Za-z0-9_.]/.test(ch) ? ch : encodeURIComponent(ch).replace(/[!'()*]/g, pct)))
    .join("");
  return out || "v";
}

function pct(ch: string): string {
  return `%${ch.charCodeAt(0).toString(16).toUpperCase()}`;
}

function encodeUnreserved(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, pct);
}

/**
 * Expand the subset of RFC 6570 the profiler writes: {var}, {+var}, {?a,b}, {&a}, {/a}. Undefined
 * variables are skipped as the RFC says.
 */
export function expandTemplate(
  template: string,
  values: Record<string, string | undefined>,
): string {
  return template.replace(/\{([+?&/]?)([^}]+)\}/g, (_m, op: string, list: string) => {
    const names = list.split(",").map((n) => n.trim());
    const defined = names.filter((n) => values[n] !== undefined);
    if (op === "?" || op === "&") {
      if (defined.length === 0) return "";
      const pairs = defined.map((n) => `${n}=${encodeUnreserved(values[n] ?? "")}`);
      return `${op}${pairs.join("&")}`;
    }
    if (op === "/") return defined.map((n) => `/${encodeUnreserved(values[n] ?? "")}`).join("");
    if (op === "+") return defined.map((n) => encodeURI(values[n] ?? "")).join(",");
    return defined.map((n) => encodeUnreserved(values[n] ?? "")).join(",");
  });
}

/** Variable names used in an RFC 6570 template, in order. */
export function templateVariables(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(/\{[+?&/#.;]?([^}]+)\}/g)) {
    for (const n of (m[1] ?? "").split(",")) {
      const name = n.trim().replace(/\*$|:\d+$/, "");
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

/** The template with variable names erased, so templates learned from different evidence compare equal. */
export function templateShape(method: string, template: string): string {
  const shaped = template.replace(/\{[?&][^}]*\}/g, "").replace(/\{[^}]*\}/g, "{}");
  return `${method.toUpperCase()} ${shaped}`;
}

export function truncate(text: string, max: number): { text: string; truncated: boolean } {
  return text.length > max
    ? { text: text.slice(0, max), truncated: true }
    : { text, truncated: false };
}

export function uniq<T>(items: Iterable<T>): T[] {
  return Array.from(new Set(items));
}

export function isJsonType(contentType?: string): boolean {
  return /[/+]json\b/i.test(contentType ?? "");
}

export function isHtmlType(contentType?: string): boolean {
  return /text\/html|application\/xhtml/i.test(contentType ?? "");
}

export function tryJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Resolve an RFC 6901 pointer. */
export function jsonPointer(doc: unknown, pointer: string): unknown {
  if (pointer === "") return doc;
  if (!pointer.startsWith("/")) return undefined;
  let cur: unknown = doc;
  for (const raw of pointer.slice(1).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(cur)) {
      if (!/^\d+$/.test(key)) return undefined;
      cur = cur[Number(key)];
    } else if (cur !== null && typeof cur === "object") {
      cur = Object.hasOwn(cur, key) ? (cur as Record<string, unknown>)[key] : undefined;
    } else return undefined;
    if (cur === undefined) return undefined;
  }
  return cur;
}

export function pointerEscape(key: string): string {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}

export const EFFECT_RANK: Record<string, number> = {
  read: 0,
  "reversible-write": 1,
  "irreversible-write": 2,
  payment: 3,
};
