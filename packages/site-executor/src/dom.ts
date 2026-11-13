// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
// HTML and JSON reading helpers: htmlparser2 + css-select for HTML, RFC 6901 for JSON.

import { _compileUnsafe, prepareContext, selectOne } from "css-select";
import { type AnyNode, type Document, type Element, isTag } from "domhandler";
import * as DomUtils from "domutils";
import { find, findOne, getAttributeValue, textContent } from "domutils";
import { parseDocument } from "htmlparser2";

export function parseHtml(html: string): Document {
  return parseDocument(html, { decodeEntities: true });
}

/** Whitespace-collapsed text content of an element. */
export function elementText(el: AnyNode): string {
  return textContent(el).replace(/\s+/g, " ").trim();
}

/** Every element matching `selector` under `root` (the root itself excluded). */
export function selectElements(
  selector: string,
  root: AnyNode | AnyNode[],
  limit = Number.POSITIVE_INFINITY,
): Element[] {
  const match = _compileUnsafe<AnyNode, Element>(selector, undefined, root);
  const nodes = prepareContext(root, { ...DomUtils, isTag }, match.shouldTestNextSiblings);
  return find((node) => isTag(node) && match(node), nodes, true, limit) as Element[];
}

export function selectElement(selector: string, root: AnyNode | AnyNode[]): Element | null {
  return selectOne<AnyNode, Element>(selector, root);
}

export function attribute(el: Element, name: string): string | undefined {
  return getAttributeValue(el, name);
}

/** content of <meta name="..."> (exact, case-insensitive name compare, no selector parsing). */
export function metaContent(doc: Document, name: string): string | undefined {
  const lower = name.toLowerCase();
  const el = findOne(
    (e) => e.name === "meta" && (getAttributeValue(e, "name") ?? "").toLowerCase() === lower,
    doc.children,
    true,
  );
  return el ? getAttributeValue(el, "content") : undefined;
}

export class PointerError extends Error {
  override name = "PointerError";
}

/** RFC 6901 JSON Pointer evaluation. Returns undefined when the pointer does not resolve. */
export function jsonPointer(doc: unknown, pointer: string): unknown {
  if (pointer === "") return doc;
  if (!pointer.startsWith("/"))
    throw new PointerError("JSON pointer must be empty or start with '/'");
  let current: unknown = doc;
  for (const raw of pointer.slice(1).split("/")) {
    const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) return undefined;
      current = current[Number(token)];
    } else if (current !== null && typeof current === "object") {
      if (!Object.hasOwn(current, token)) return undefined;
      current = (current as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return current;
}
