// AUTHORED-BY Claude Opus 5.5
// HTML parsing (htmlparser2 + domutils) and a small CSS selector engine for the selector subset the
// profiler writes: type, *, #id, .class, [attr], [attr="v"], :scope, descendant and child
// combinators, and selector lists. Generated selectors stay inside this subset so any conforming
// engine (css-select, a browser) evaluates them the same way.

import { asciiLowerCase } from "@jeswr/site-executor";
import { type ChildNode, type Document, type Element, isTag } from "domhandler";
import { getAttributeValue, textContent } from "domutils";
import { parseDocument } from "htmlparser2";

export type { Document, Element } from "domhandler";

export function parseHtml(html: string): Document {
  return parseDocument(html, { lowerCaseAttributeNames: true, lowerCaseTags: true });
}

export function elementChildren(node: Document | Element): Element[] {
  return (node.children as ChildNode[]).filter(isTag);
}

export function descendants(node: Document | Element): Element[] {
  const out: Element[] = [];
  const walk = (n: Document | Element) => {
    for (const c of elementChildren(n)) {
      out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

export function attr(el: Element, name: string): string | undefined {
  return getAttributeValue(el, name);
}

export function classes(el: Element): string[] {
  return (attr(el, "class") ?? "").split(/\s+/).filter(Boolean);
}

/** Text content with whitespace collapsed. */
export function text(el: Element | Document): string {
  return textContent(el).replace(/\s+/g, " ").trim();
}

interface AttrTest {
  name: string;
  value?: string;
}

interface Compound {
  tag?: string;
  id?: string;
  classes: string[];
  attrs: AttrTest[];
  scope: boolean;
}

interface Complex {
  /** Left to right: compounds[i] relates to compounds[i+1] through combinators[i]. */
  compounds: Compound[];
  combinators: Array<" " | ">">;
}

const IDENT = /^-?[_a-zA-Z][-_a-zA-Z0-9]*/;

function parseCompound(src: string, pos: number): { c: Compound; pos: number } {
  const c: Compound = { classes: [], attrs: [], scope: false };
  let i = pos;
  const tag = /^(\*|[a-zA-Z][a-zA-Z0-9-]*)/.exec(src.slice(i));
  if (tag?.[1]) {
    if (tag[1] !== "*") c.tag = tag[1].toLowerCase();
    i += tag[1].length;
  }
  for (;;) {
    const ch = src[i];
    if (ch === "#" || ch === ".") {
      const m = IDENT.exec(src.slice(i + 1));
      if (!m) throw new SyntaxError(`Bad selector near ${src.slice(i)}`);
      if (ch === "#") c.id = m[0];
      else c.classes.push(m[0]);
      i += 1 + m[0].length;
    } else if (ch === "[") {
      const m =
        /^\[\s*([-_a-zA-Z0-9:]+)\s*(?:=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([-_a-zA-Z0-9]+))\s*)?\]/.exec(
          src.slice(i),
        );
      if (!m?.[1]) throw new SyntaxError(`Bad attribute selector near ${src.slice(i)}`);
      const raw = m[2] ?? m[3] ?? m[4];
      const test: AttrTest = { name: m[1].toLowerCase() };
      if (raw !== undefined) test.value = raw.replace(/\\(.)/g, "$1");
      c.attrs.push(test);
      i += m[0].length;
    } else if (src.startsWith(":scope", i)) {
      c.scope = true;
      i += 6;
    } else break;
  }
  if (i === pos) throw new SyntaxError(`Bad selector near ${src.slice(pos) || "end"}`);
  return { c, pos: i };
}

export function parseSelector(selector: string): Complex[] {
  const out: Complex[] = [];
  for (const part of splitList(selector)) {
    const src = part.trim();
    if (!src) throw new SyntaxError("Empty selector");
    const complex: Complex = { compounds: [], combinators: [] };
    let i = 0;
    for (;;) {
      const r = parseCompound(src, i);
      complex.compounds.push(r.c);
      i = r.pos;
      const ws = /^\s*(>)?\s*/.exec(src.slice(i));
      if (i >= src.length) break;
      const consumed = ws?.[0] ?? "";
      if (!consumed) throw new SyntaxError(`Unsupported selector syntax near ${src.slice(i)}`);
      complex.combinators.push(ws?.[1] ? ">" : " ");
      i += consumed.length;
    }
    out.push(complex);
  }
  return out;
}

function splitList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (const ch of selector) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[") depth++;
    else if (ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

function matchCompound(el: Element, c: Compound, scope: Element | Document): boolean {
  if (c.scope && el !== scope) return false;
  if (c.tag && el.name !== c.tag) return false;
  if (c.id && attr(el, "id") !== c.id) return false;
  if (c.classes.length) {
    const have = classes(el);
    if (!c.classes.every((k) => have.includes(k))) return false;
  }
  for (const a of c.attrs) {
    const v = attr(el, a.name);
    if (v === undefined) return false;
    // HTML matches [type=...] values ASCII-case-insensitively, as browsers and css-select do.
    if (
      a.value !== undefined &&
      (a.name === "type" ? asciiLowerCase(v) !== asciiLowerCase(a.value) : v !== a.value)
    )
      return false;
  }
  return true;
}

function parentWithin(el: Element, scope: Element | Document): Element | undefined {
  if (el === scope) return undefined;
  const p = el.parent;
  if (!p || !isTag(p as ChildNode)) return undefined;
  return p as Element;
}

function matchComplex(el: Element, cx: Complex, scope: Element | Document, idx: number): boolean {
  const compound = cx.compounds[idx];
  if (!compound || !matchCompound(el, compound, scope)) return false;
  if (idx === 0) return true;
  const comb = cx.combinators[idx - 1];
  let p = parentWithin(el, scope);
  if (comb === ">") return p !== undefined && matchComplex(p, cx, scope, idx - 1);
  while (p) {
    if (matchComplex(p, cx, scope, idx - 1)) return true;
    p = parentWithin(p, scope);
  }
  return false;
}

/** querySelectorAll over the subset; the scope element itself is a candidate only via :scope. */
export function selectAll(scope: Element | Document, selector: string): Element[] {
  const list = parseSelector(selector);
  const pool = descendants(scope);
  if (scope.type !== "root") pool.unshift(scope as Element);
  return pool.filter((el) =>
    list.some((cx) => {
      const last = cx.compounds.length - 1;
      const usesScope = cx.compounds.some((c) => c.scope);
      if (el === scope && !usesScope) return false;
      return matchComplex(el, cx, scope, last);
    }),
  );
}

export function selectOne(scope: Element | Document, selector: string): Element | undefined {
  return selectAll(scope, selector)[0];
}

/** Quote a value for an attribute selector. */
export function attrValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** A short selector for one element using its tag plus id or classes, within the subset. */
export function simpleSelector(el: Element): string {
  const id = attr(el, "id");
  if (id && IDENT.test(id) && IDENT.exec(id)?.[0] === id) return `${el.name}#${id}`;
  const cls = classes(el).filter((k) => IDENT.exec(k)?.[0] === k);
  return cls.length ? `${el.name}.${cls.join(".")}` : el.name;
}
