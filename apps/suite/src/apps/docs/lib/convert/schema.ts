// AUTHORED-BY Codex

import { Mark } from "@tiptap/pm/model";
import { generateJSON, getSchema, type JSONContent } from "@tiptap/react";
import { baseExtensions } from "../../editor/extensions";
import { normaliseDestination } from "../editor/destination";
import { sanitiseImport } from "./sanitise";
import { reportSkipped, type SkippedItem } from "./skipped";

export const importSchema = getSchema(baseExtensions(globalThis.fetch));

/** Apply the same URL policy to mapped imports and embedded document payloads. */
export function normaliseDestinations(node: JSONContent, skipped: SkippedItem[]): JSONContent {
  const result = { ...node };
  if (node.marks)
    result.marks = node.marks.flatMap((mark) => {
      if (mark.type !== "link") return [mark];
      const href = normaliseDestination(String(mark.attrs?.href ?? ""));
      if (href) return [{ ...mark, attrs: { ...mark.attrs, href } }];
      reportSkipped(skipped, "Unsafe URLs");
      return [];
    });
  if (node.type === "image") {
    const src = normaliseDestination(String(node.attrs?.src ?? ""));
    if (!src || !/^https?:/.test(src)) {
      reportSkipped(skipped, "Unsafe URLs");
      return { type: "paragraph" };
    }
    result.attrs = { ...node.attrs, src };
  }
  if (node.content)
    result.content = node.content.map((child) => normaliseDestinations(child, skipped));
  return result;
}

/** The single boundary between mapped imports and editor/snapshot content. */
export function normaliseImport(json: JSONContent, skipped: SkippedItem[] = []) {
  function map(node: JSONContent): JSONContent[] {
    const type = importSchema.nodes[String(node.type)];
    if (!type) {
      reportSkipped(skipped, "Unsupported nodes");
      return [];
    }
    const attrs = { ...node.attrs };
    if (node.type === "heading") {
      const level = Number(attrs.level);
      attrs.level = Number.isFinite(level) ? Math.min(3, Math.max(1, Math.round(level))) : 1;
    }
    const defaults = type.spec.attrs ?? {};
    for (const key of Object.keys(attrs)) {
      if (!(key in defaults)) {
        delete attrs[key];
        reportSkipped(skipped, "Unsupported attributes");
      }
    }
    if (
      "textAlign" in attrs &&
      ![null, "left", "center", "right", "justify"].includes(attrs.textAlign)
    ) {
      attrs.textAlign = null;
      reportSkipped(skipped, "Unsupported alignment");
    }
    const marks = (node.marks ?? []).filter((mark) => {
      if (importSchema.marks[mark.type]) return true;
      reportSkipped(skipped, "Unsupported marks");
      return false;
    });
    const mapped: JSONContent = {
      ...node,
      attrs,
      ...(node.marks ? { marks } : {}),
      ...(node.content ? { content: node.content.flatMap(map) } : {}),
    };
    try {
      // JSON marks are an unordered multiset from importers. Canonicalize with
      // the schema's rank/exclusion rules before check() can reject the text.
      if (mapped.marks)
        mapped.marks = mapped.marks
          .reduce((set, mark) => importSchema.markFromJSON(mark).addToSet(set), Mark.none)
          .map((mark) => mark.toJSON());
      const parsed = importSchema.nodeFromJSON(mapped);
      parsed.check();
      return [parsed.toJSON() as JSONContent];
    } catch {
      reportSkipped(skipped, "Invalid content");
      return [];
    }
  }
  const mapped = map(normaliseDestinations(json, skipped))[0];
  if (mapped && mapped.type !== "doc") reportSkipped(skipped, "Invalid document root");
  const parsed = importSchema.nodeFromJSON(
    mapped?.type === "doc" && mapped.content?.length
      ? mapped
      : { type: "doc", content: [{ type: "paragraph" }] },
  );
  parsed.check();
  const result = parsed.toJSON() as JSONContent;
  return { json: result, skipped };
}

export function importHtml(source: string, skipped: SkippedItem[] = []) {
  // All six HTML heading levels have the same meaning as Markdown/DOCX levels.
  const html = sanitiseImport(source, skipped);
  const dom = new window.DOMParser().parseFromString(html, "text/html");
  for (const paragraph of dom.body.querySelectorAll("p")) {
    if (paragraph.querySelector("img") && !paragraph.textContent?.trim())
      paragraph.replaceWith(...paragraph.childNodes);
  }
  return normaliseImport(
    generateJSON(dom.body.innerHTML, baseExtensions(globalThis.fetch)),
    skipped,
  );
}

export function importPlainText(source: string) {
  return normaliseImport({
    type: "doc",
    content: source
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => ({
        type: "paragraph",
        ...(line ? { content: [{ type: "text", text: line }] } : {}),
      })),
  });
}
