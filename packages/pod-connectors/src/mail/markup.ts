// AUTHORED-BY Codex GPT-6.1-Sol
import { asciiLower, decodeMarkupText, MARKUP_MAX_DEPTH, markupHtmlTokens } from "./markup-html.js";
import {
  EMAIL_MARKUP_TYPES,
  type EmailMarkupItem,
  type EmailMarkupOptions,
  MARKUP_NODE_TYPES,
  MARKUP_PROPERTIES,
  type MarkupNode,
  type MarkupNodeType,
  type MarkupProperties,
  type MarkupProperty,
  type MarkupValue,
} from "./markup-types.js";
export const DEFAULT_MARKUP_MAX_BYTES = 1024 * 1024;
export const MAX_MARKUP_BYTES = 8 * 1024 * 1024;
export const MAX_MARKUP_ITEMS = 1000;
export const MAX_MARKUP_SCRIPTS = 32;
export const MAX_MARKUP_STRING = 8192;
export const MAX_MARKUP_SCALAR_CHARS = 256 * 1024;
const MAX_NODES = 4096;
const MAX_VALUES = 16_384;
const nodeTypes: ReadonlySet<string> = new Set(MARKUP_NODE_TYPES);
const rootTypes: ReadonlySet<string> = new Set(EMAIL_MARKUP_TYPES);
const properties: ReadonlySet<string> = new Set(MARKUP_PROPERTIES);

export function markupLimit(value: number | undefined, fallback: number, hard: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Invalid email markup limit");
  return Math.min(value, hard);
}
function fitsUtf8(text: string, max: number): boolean {
  if (text.length > max) return false;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes++;
    else if (c < 0x800) bytes += 2;
    else if (
      c >= 0xd800 &&
      c <= 0xdbff &&
      text.charCodeAt(i + 1) >= 0xdc00 &&
      text.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i++;
    } else bytes += 3;
    if (bytes > max) return false;
  }
  return true;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** No remote resolution, aliases, arbitrary inline definitions or foreign vocabulary inference. */
function schemaContext(context: unknown): boolean {
  if (context === undefined) return true;
  if (typeof context === "string") return /^https?:\/\/schema\.org\/?$/.test(context);
  if (Array.isArray(context)) return context.length > 0 && context.every(schemaContext);
  return (
    record(context) &&
    Object.keys(context).length === 1 &&
    schemaContext(context["@vocab"]) &&
    typeof context["@vocab"] === "string"
  );
}
function schemaTerm(value: string): string | undefined {
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(value)) return value;
  return /^https?:\/\/schema\.org\/([A-Za-z][A-Za-z0-9]*)\/?$/.exec(value)?.[1];
}
function nodeType(value: unknown): MarkupNodeType | undefined {
  const types = Array.isArray(value) ? value : [value];
  const preferred = types.find(
    (type) => typeof type === "string" && rootTypes.has(schemaTerm(type) ?? ""),
  );
  if (typeof preferred === "string") return schemaTerm(preferred) as MarkupNodeType;
  for (const type of types) {
    const name = typeof type === "string" ? schemaTerm(type) : undefined;
    if (name && nodeTypes.has(name)) return name as MarkupNodeType;
  }
  return undefined;
}
/** Guard before JSON.parse: bound depth, structural work and individual raw strings. */
function guardedJson(text: string): unknown {
  let depth = 0;
  let tokens = 0;
  let quoted = false;
  let escaped = false;
  let length = 0;
  for (const ch of text) {
    if (quoted) {
      if (++length > MAX_MARKUP_STRING * 6) return undefined;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') {
      quoted = true;
      length = 0;
    } else if (ch === "[" || ch === "{") {
      if (++depth > MARKUP_MAX_DEPTH) return undefined;
    } else if (ch === "]" || ch === "}") depth--;
    else if (ch === "," || ch === ":") {
      if (++tokens > 50_000) return undefined;
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
/** Pure inert extraction; capped input, scripts, strings, nodes, depth, elements and root items. */
export interface EmailMarkupResult {
  readonly items: EmailMarkupItem[];
  readonly truncated: boolean;
  readonly scalarCharacters: number;
}
export function extractEmailMarkup(
  html: string,
  options: EmailMarkupOptions = {},
): EmailMarkupItem[] {
  return extractEmailMarkupResult(html, options).items;
}
export function extractEmailMarkupResult(
  html: string,
  options: EmailMarkupOptions = {},
): EmailMarkupResult {
  const maxBytes = markupLimit(options.maxBytes, DEFAULT_MARKUP_MAX_BYTES, MAX_MARKUP_BYTES);
  const maxItems = markupLimit(options.maxItems, 100, MAX_MARKUP_ITEMS);
  if (!maxItems || !fitsUtf8(html, maxBytes))
    return { items: [], truncated: !!html, scalarCharacters: 0 };
  const out: EmailMarkupItem[] = [];
  let nodes = 0;
  let valueCount = 0;
  let characters = 0;
  let microCharacters = 0;
  let truncated = false;
  let exhausted = false;
  let microExhausted = false;
  function charge(value: string | number | boolean): boolean {
    const length = String(value).length;
    if (length > MAX_MARKUP_SCALAR_CHARS - characters) {
      truncated = exhausted = true;
      return false;
    }
    characters += length;
    return true;
  }
  function normalize(raw: Record<string, unknown>, depth = 0): MarkupNode | undefined {
    if (depth >= MARKUP_MAX_DEPTH || ++nodes > MAX_NODES || !schemaContext(raw["@context"]))
      return undefined;
    const type = nodeType(raw["@type"]);
    // An explicit, unsupported type must not masquerade as an untyped nested value.
    if (raw["@type"] !== undefined && !type) return undefined;
    const props: MarkupProperties = {};
    // Keep @id inert, but allow it to identify nested providers without dereferencing it.
    if (
      typeof raw["@id"] === "string" &&
      raw["@id"].length <= MAX_MARKUP_STRING &&
      charge(raw["@id"])
    )
      props.identifier = [raw["@id"]];
    for (const [key, source] of Object.entries(raw)) {
      if (valueCount >= MAX_VALUES || exhausted) break;
      const name = schemaTerm(key);
      if (!name || !properties.has(name)) continue;
      const values: MarkupValue[] = [];
      for (const value of Array.isArray(source) ? source : [source]) {
        if (values.length >= 64 || valueCount >= MAX_VALUES || exhausted) break;
        valueCount++;
        if (typeof value === "string" && value.length <= MAX_MARKUP_STRING) {
          if (charge(value)) values.push(value);
        } else if (
          typeof value === "boolean" ||
          (typeof value === "number" && Number.isFinite(value))
        ) {
          if (charge(value)) values.push(value);
        } else if (record(value)) {
          const child = normalize(value, depth + 1);
          if (child) values.push(child);
        }
      }
      if (values.length) props[name as MarkupProperty] = values;
    }
    return { ...(type ? { type } : {}), properties: props };
  }
  function visit(value: unknown, depth = 0): void {
    if (
      exhausted ||
      out.length >= maxItems ||
      depth >= MARKUP_MAX_DEPTH ||
      nodes >= MAX_NODES ||
      valueCount >= MAX_VALUES
    )
      return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child, depth + 1);
      return;
    }
    if (!record(value) || !schemaContext(value["@context"])) return;
    const type = nodeType(value["@type"]);
    if (type && rootTypes.has(type)) {
      const normalized = normalize(value);
      if (normalized) out.push(normalized as EmailMarkupItem);
    }
    if (value["@graph"] !== undefined) visit(value["@graph"], depth + 1);
  }
  interface Frame {
    tag: string;
    scope?: Record<string, unknown>;
    owner?: Record<string, unknown>;
    props: string[];
    text: string;
    overflow?: boolean;
    value?: string;
  }
  const stack: Frame[] = [];
  let scopes = 0;
  let scripts = 0;
  let overflowDepth = 0;
  function scope(): Record<string, unknown> | undefined {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i]?.scope) return stack[i]?.scope;
    return undefined;
  }
  function finish(frame: Frame): void {
    if (frame.overflow) return;
    const value =
      frame.scope ?? frame.value ?? decodeMarkupText(frame.text).replace(/\s+/g, " ").trim();
    if (frame.owner && frame.props.length) {
      for (const prop of frame.props) {
        const previous = frame.owner[prop];
        if (Array.isArray(previous) && previous.length >= 64) continue;
        // Bound the intermediate microdata tree before normalization, including aliases.
        if (typeof value === "string") {
          if (value.length > MAX_MARKUP_STRING) continue;
          if (value.length > MAX_MARKUP_SCALAR_CHARS - microCharacters) {
            truncated = microExhausted = true;
            break;
          }
          microCharacters += value.length;
        }
        if (Array.isArray(previous)) previous.push(value);
        else if (!previous) frame.owner[prop] = [value];
      }
    } else if (frame.scope) visit(frame.scope);
  }
  function appendText(text: string): void {
    const owner = scope();
    for (const frame of stack)
      if (
        !frame.overflow &&
        frame.props.length &&
        !frame.scope &&
        frame.value === undefined &&
        frame.owner === owner
      ) {
        if (text.length > MAX_MARKUP_STRING - frame.text.length) frame.overflow = true;
        else frame.text += text;
      }
  }
  for (const token of markupHtmlTokens(html)) {
    if (out.length >= maxItems || exhausted || microExhausted) {
      truncated = true;
      break;
    }
    if (token.kind === "raw") {
      if (
        token.tag === "script" &&
        ++scripts <= MAX_MARKUP_SCRIPTS &&
        !token.attrs.has("src") &&
        asciiLower(token.attrs.get("type")?.trim() ?? "") === "application/ld+json"
      )
        visit(guardedJson(token.value));
      else if (!overflowDepth && (token.tag === "textarea" || token.tag === "title"))
        appendText(token.value);
      continue;
    }
    if (overflowDepth && token.kind === "text") continue;
    if (token.kind === "text") {
      appendText(token.value);
      continue;
    }
    if (token.kind === "end") {
      if (overflowDepth) {
        overflowDepth--;
        continue;
      }
      // A bounded stack search; mismatched tags never pop unrelated scope boundaries.
      let index = stack.length - 1;
      while (index >= 0 && stack[index]?.tag !== token.tag) index--;
      if (index < 0) continue;
      while (stack.length > index) finish(stack.pop() as Frame);
      continue;
    }
    if (overflowDepth || stack.length >= MARKUP_MAX_DEPTH) {
      if (!token.void) overflowDepth++;
      truncated = true;
      continue;
    }
    const props = (token.attrs.get("itemprop") ?? "")
      .split(/\s+/)
      .slice(0, 16)
      .map(schemaTerm)
      .filter((p): p is string => p !== undefined && properties.has(p));
    const frame: Frame = { tag: token.tag, owner: scope(), props, text: "" };
    if (token.attrs.has("itemscope")) {
      if (++scopes > MAX_NODES) break;
      // itemtype must be an absolute schema.org type in microdata.
      const types = (token.attrs.get("itemtype") ?? "")
        .split(/\s+/)
        .filter((t) => /^https?:\/\/schema\.org\//.test(t));
      frame.scope = { "@type": types.length ? types : "unsupported" };
    } else {
      const attr =
        token.tag === "meta"
          ? "content"
          : ["a", "area", "link"].includes(token.tag)
            ? "href"
            : ["audio", "embed", "iframe", "img", "source", "track", "video"].includes(token.tag)
              ? "src"
              : token.tag === "time"
                ? "datetime"
                : ["data", "meter"].includes(token.tag)
                  ? "value"
                  : undefined;
      if (attr) frame.value = token.attrs.get(attr);
    }
    if (token.void) finish(frame);
    else stack.push(frame);
  }
  // A scalar budget stop publishes only the values already finished. Ordinary unclosed
  // scopes remain unpublished. Normalization independently caps repeated nested aliases.
  if (microExhausted)
    while (stack.length) {
      const frame = stack.pop() as Frame;
      if (frame.scope) finish(frame);
    }
  return { items: out, truncated, scalarCharacters: characters };
}
