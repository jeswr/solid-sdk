// AUTHORED-BY Codex

import { generateHTML } from "@tiptap/react";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import mammoth from "mammoth/mammoth.browser";
import { SaxesParser } from "saxes";
import { baseExtensions } from "../../editor/extensions";
import { normaliseImageDestination } from "../editor/destination";
import { readNumbering } from "./docx-numbering";
import { embeddedDocument } from "./docx-payload";
import { WORD } from "./docx-xml";
import { sanitiseImport } from "./sanitise";
import { DOCX_FORMATTING_WARNING, reportSkipped, type SkippedItem } from "./skipped";

export type { SkippedItem } from "./skipped";

export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
const paragraphStyles = new Map<string, string>([
  ["Horizontal Rule", "hr:fresh"],
  ["Title", "h1:fresh"],
  ...[1, 2, 3, 4, 5, 6].map((level): [string, string] => [
    `Heading ${level}`,
    `h${Math.min(level, 3)}:fresh`,
  ]),
  ["Quote", "blockquote:fresh > p:fresh"],
  ["Intense Quote", "blockquote:fresh > p:fresh"],
  ["Code", "pre:separator('\n')"],
]);
// Mammoth's style-name matching is case insensitive, including Word's built-in names.
const paragraphPaths = new Map(
  Array.from(paragraphStyles, ([name, path]): [string, string] => [name.toLowerCase(), path]),
);
export const DOCX_STYLE_MAP = [
  // Suite exports one paragraph per code block; fresh keeps adjacent blocks separate.
  "p.Code => pre:fresh",
  // The task parser consumes the marker, preserving any label text in the same run.
  "r[style-name='Task Marker'] =>",
  "r[style-name='Inline Code'] => code",
  "u => u",
  "highlight => mark",
  ...Array.from(paragraphStyles, ([name, path]) => `p[style-name='${name}'] => ${path}`),
];
export interface ImportProgress {
  completed: number;
  total: number;
}
export interface DocxImportOptions {
  uploadImage: (data: ArrayBuffer, contentType: string) => Promise<string>;
  progress: (progress: ImportProgress) => void;
}

interface DocxElement {
  type: string;
  value?: string;
  children?: DocxElement[];
  styleId?: string | null;
  styleName?: string | null;
  numbering?: { level: string; isOrdered: boolean } | null;
  indent?: { start: string | null };
}

/** Visible task edits override stale paragraph styles, regardless of Word's run boundaries. */
function taskChecked(paragraph: DocxElement, styleName: string | undefined) {
  if (styleName !== "task checked" && styleName !== "task unchecked") return undefined;
  const texts: { value: string }[] = [];
  function visit(element: DocxElement) {
    if (element.type === "text") texts.push(element as { value: string });
    else for (const child of element.children ?? []) visit(child);
  }
  visit(paragraph);
  const marker = texts
    .map((text) => text.value)
    .join("")
    .match(/^[☐☑] ?/);
  if (!marker) return styleName === "task checked";
  // Remove just the leading marker and one separator, never literal checkboxes in the label.
  let remaining = marker[0].length;
  for (const text of texts) {
    const value = text.value;
    text.value = value.slice(remaining);
    remaining -= Math.min(remaining, value.length);
  }
  return marker[0].startsWith("☑");
}

/** Build paths using the actual ancestors, including task-list/item attributes. */
function mapLists(
  document: DocxElement,
  styleMap: string[],
  numbering: ReturnType<typeof readNumbering>,
) {
  let paragraphIndex = 0;
  function container(element: DocxElement) {
    const ancestors: { path: string; key: string; list: string }[] = [];
    for (const child of element.children ?? []) {
      const metadata = child.type === "paragraph" ? numbering[paragraphIndex++] : undefined;
      if (child.type === "paragraph" && metadata) {
        // Use the same effective style/direct numbering as the counter. Explicit
        // numId=0 suppresses inherited numbering, including Mammoth's fallback.
        if (metadata.id === "0") child.numbering = null;
        else if (metadata.numbering) child.numbering = metadata.numbering;
      }
      const styleName = child.styleName?.toLowerCase();
      const continuationStyle = styleName?.match(/^list continuation(?: (.+))?$/);
      const blockStyle = continuationStyle ? continuationStyle[1] : styleName;
      const checked = child.type === "paragraph" ? taskChecked(child, styleName) : undefined;
      const task = checked !== undefined;
      const indentLevel = Math.round(Number(child.indent?.start) / 720 - 1);
      const continuation =
        child.type === "paragraph" &&
        !child.numbering &&
        !task &&
        // Semantic block styles are boundaries unless explicitly marked as a
        // list continuation. A standalone Quote has the same half-inch indent.
        (continuationStyle || (!paragraphPaths.has(styleName ?? "") && child.styleId !== "Code")) &&
        indentLevel >= 0 &&
        ancestors.length > 0;
      const mappedStyle = (ancestors: string[]) => {
        const block =
          child.styleId === "Code" || child.styleId === "ListContinuationCode"
            ? "pre:fresh"
            : (paragraphPaths.get(blockStyle ?? "") ?? "p:fresh");
        const styleId = `SuiteList${styleMap.length}`;
        // Mammoth uses the first matching rule. Every generated list/continuation
        // path must precede presets while retaining the paragraph's block style.
        styleMap.unshift(`p.${styleId} => ${[...ancestors, block].join(" > ")}`);
        child.styleId = styleId;
      };
      if (continuation) {
        ancestors.length = Math.min(indentLevel + 1, ancestors.length);
        mappedStyle(ancestors.map((ancestor) => ancestor.path));
        continue;
      }
      if (child.type === "paragraph" && (task || child.numbering)) {
        // Suite task markers use half-inch indentation instead of Word numbering.
        const level = Math.min(
          8,
          Math.max(
            0,
            Math.round(
              Number(child.numbering?.level ?? Number(child.indent?.start) / 720 - 1) || 0,
            ),
          ),
        );
        const kind = task ? "taskList" : child.numbering?.isOrdered ? "orderedList" : "bulletList";
        const key = `${kind}:${task ? "" : (metadata?.id ?? "")}`;
        // A document may start at an indented level without supplying its parents.
        const depth = Math.min(level, ancestors.length);
        const previous = ancestors[depth];
        const list =
          previous?.key === key
            ? previous.list
            : task
              ? "ul[data-type='taskList']"
              : child.numbering?.isOrdered
                ? `ol[start='${metadata?.start ?? 1}']`
                : "ul";
        const item = task ? `li[data-type='taskItem'][data-checked='${checked}']` : "li";
        const fresh = ancestors[depth]?.key === key ? "" : ":fresh";
        mappedStyle([
          ...ancestors.slice(0, depth).map((ancestor) => ancestor.path),
          `${list}${fresh} > ${item}:fresh`,
        ]);
        ancestors.length = depth;
        ancestors.push({ path: `${list} > ${item}`, key, list });
      } else {
        ancestors.length = 0;
        // A Word edit may remove the list that introduced this continuation.
        if (child.type === "paragraph" && continuationStyle) mappedStyle([]);
        container(child);
      }
    }
  }
  container(document);
  return document;
}

const skippedTags: Record<string, string> = {
  footnoteReference: "Footnotes",
  endnoteReference: "Endnotes",
  commentReference: "Comments",
  ins: "Tracked changes",
  del: "Tracked changes",
  moveFrom: "Tracked changes",
  moveTo: "Tracked changes",
  txbxContent: "Text boxes",
};

/** Inspect OOXML before mammoth erases tracked-change/text-box distinctions. */
export function stripUnsupported(xml: string): { xml: string; skipped: SkippedItem[] } {
  const counts = new Map<string, number>();
  const ranges: [number, number][] = [];
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  let dropping: { start: number; depth: number } | undefined;
  parser.on("opentag", (tag) => {
    depth++;
    if (tag.uri !== WORD || dropping) return;
    const label = skippedTags[tag.local];
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
    if (label || ["commentRangeStart", "commentRangeEnd"].includes(tag.local)) {
      dropping = { start: xml.lastIndexOf("<", parser.position - 1), depth };
    }
  });
  parser.on("closetag", () => {
    if (dropping?.depth === depth) {
      ranges.push([dropping.start, parser.position]);
      dropping = undefined;
    }
    depth--;
  });
  parser.write(xml).close();
  let cleaned = xml;
  for (const [start, end] of ranges.reverse())
    cleaned = cleaned.slice(0, start) + cleaned.slice(end);
  return { xml: cleaned, skipped: [...counts].map(([label, count]) => ({ label, count })) };
}

export async function importDocx(data: ArrayBuffer, options: DocxImportOptions) {
  if (data.byteLength > MAX_IMPORT_BYTES) throw new Error("Choose a file of 50 MB or less");
  const archive = await openArrayBuffer(data);
  const embedded = await embeddedDocument(archive);
  if (embedded) {
    const { json, images } = embedded;
    options.progress({ completed: 0, total: images.length });
    for (const [index, image] of images.entries()) {
      const { url } = await uploadImage(image, options);
      image.node.attrs = { ...image.node.attrs, src: url };
      options.progress({ completed: index + 1, total: images.length });
    }
    return {
      json,
      html: generateHTML(json, baseExtensions(globalThis.fetch)),
      skipped: embedded.skipped,
    };
  }
  const inspected = stripUnsupported(await archive.read("word/document.xml", "utf-8"));
  reportSkipped(inspected.skipped, DOCX_FORMATTING_WARNING);
  const numbering = readNumbering(
    inspected.xml,
    archive.exists("word/numbering.xml")
      ? await archive.read("word/numbering.xml", "utf-8")
      : `<w:numbering xmlns:w="${WORD}"/>`,
    archive.exists("word/styles.xml") ? await archive.read("word/styles.xml", "utf-8") : "",
  );
  archive.write("word/document.xml", inspected.xml);
  const images: { data: ArrayBuffer; contentType: string; placeholder: string }[] = [];
  const styleMap = [...DOCX_STYLE_MAP];
  const result = await mammoth.convertToHtml(
    { arrayBuffer: await archive.toArrayBuffer() },
    {
      styleMap,
      transformDocument: (document: DocxElement) => mapLists(document, styleMap, numbering),
      includeEmbeddedStyleMap: false,
      externalFileAccess: false,
      ignoreEmptyParagraphs: false,
      convertImage: mammoth.images.imgElement(async (image) => {
        const placeholder = `https://docs.invalid/import-image/${images.length}/end`;
        // Reserve the index before awaiting: mammoth may convert images concurrently.
        const slot = { data: new ArrayBuffer(0), contentType: image.contentType, placeholder };
        images.push(slot);
        slot.data = await image.readAsArrayBuffer();
        return { src: placeholder };
      }),
    },
  );
  result.messages.forEach((message) => {
    reportSkipped(inspected.skipped, `Unsupported DOCX formatting: ${message.message}`);
  });
  let html = result.value;
  options.progress({ completed: 0, total: images.length });
  for (const [index, image] of images.entries()) {
    const { src } = await uploadImage(image, options);
    html = html.replaceAll(image.placeholder, src);
    options.progress({ completed: index + 1, total: images.length });
  }
  return { html: sanitiseImport(html, inspected.skipped), skipped: inspected.skipped };
}

async function uploadImage(
  image: { data: ArrayBuffer; contentType: string },
  options: DocxImportOptions,
) {
  const url = normaliseImageDestination(await options.uploadImage(image.data, image.contentType));
  if (!url) throw new Error("Invalid uploaded image URL");
  // JSON keeps the normalized URL; only the HTML replacement needs entity escaping.
  return { url, src: url.replaceAll("&", "&amp;") };
}
