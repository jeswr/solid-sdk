// AUTHORED-BY Codex

import { openArrayBuffer } from "mammoth/lib/zipfile";
import mammoth from "mammoth/mammoth.browser";
import { SaxesParser } from "saxes";
import { sanitiseImport } from "./sanitise";
import { reportSkipped, type SkippedItem } from "./skipped";

export type { SkippedItem } from "./skipped";

export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
export const DOCX_STYLE_MAP = [
  // Suite exports one paragraph per code block; fresh keeps adjacent blocks separate.
  "p.Code => pre:fresh",
  "p[style-name='Horizontal Rule'] => hr:fresh",
  "r[style-name='Task Marker'] => !",
  "r[style-name='Inline Code'] => code",
  "u => u",
  "highlight => mark",
  "p[style-name='Title'] => h1:fresh",
  ...[1, 2, 3, 4, 5, 6].map(
    (level) => `p[style-name='Heading ${level}'] => h${Math.min(level, 3)}:fresh`,
  ),
  "p[style-name='Quote'] => blockquote:fresh > p:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh > p:fresh",
  "p[style-name='Code'] => pre:separator('\n')",
];
export interface ImportProgress {
  completed: number;
  total: number;
}
export interface DocxImportOptions {
  uploadImage: (data: ArrayBuffer, contentType: string) => Promise<string>;
  progress: (progress: ImportProgress) => void;
}
const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

interface DocxElement {
  type: string;
  children?: DocxElement[];
  styleId?: string | null;
  styleName?: string | null;
  numbering?: { level: string; isOrdered: boolean } | null;
  indent?: { start: string | null };
}

/** Build paths using the actual ancestors, including task-list/item attributes. */
function mapLists(document: DocxElement, styleMap: string[]) {
  function container(element: DocxElement) {
    const ancestors: string[] = [];
    for (const child of element.children ?? []) {
      const styleName = child.styleName?.toLowerCase();
      const task = styleName === "task checked" || styleName === "task unchecked";
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
        const list = task ? "ul[data-type='taskList']" : child.numbering?.isOrdered ? "ol" : "ul";
        const item = task
          ? `li[data-type='taskItem'][data-checked='${styleName === "task checked"}']`
          : "li";
        // A document may start at an indented level without supplying its parents.
        const depth = Math.min(level, ancestors.length);
        const path = [...ancestors.slice(0, depth), `${list} > ${item}:fresh > p:fresh`].join(
          " > ",
        );
        const styleId = `SuiteList${styleMap.length}`;
        styleMap.push(`p.${styleId} => ${path}`);
        child.styleId = styleId;
        ancestors.length = depth;
        ancestors.push(`${list} > ${item}`);
      } else {
        ancestors.length = 0;
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
  const inspected = stripUnsupported(await archive.read("word/document.xml", "utf-8"));
  archive.write("word/document.xml", inspected.xml);
  const images: { data: ArrayBuffer; contentType: string; placeholder: string }[] = [];
  const styleMap = [...DOCX_STYLE_MAP];
  const result = await mammoth.convertToHtml(
    { arrayBuffer: await archive.toArrayBuffer() },
    {
      styleMap,
      transformDocument: (document: DocxElement) => mapLists(document, styleMap),
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
  result.messages.forEach(() => {
    reportSkipped(inspected.skipped, "Unsupported DOCX formatting");
  });
  let html = result.value;
  options.progress({ completed: 0, total: images.length });
  for (const [index, image] of images.entries()) {
    const url = await options.uploadImage(image.data, image.contentType);
    // Escape the replacement through the sanitizer instead of interpolating an attribute.
    const safe = sanitiseImport(`<img src="${url.replaceAll('"', "&quot;")}" />`);
    const src = /src="([^"]+)"/.exec(safe)?.[1];
    if (!src) throw new Error("Invalid uploaded image URL");
    html = html.replaceAll(image.placeholder, src);
    options.progress({ completed: index + 1, total: images.length });
  }
  return { html: sanitiseImport(html, inspected.skipped), skipped: inspected.skipped };
}
