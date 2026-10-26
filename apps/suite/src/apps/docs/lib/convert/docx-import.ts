// AUTHORED-BY Codex

import { openArrayBuffer } from "mammoth/lib/zipfile";
import mammoth from "mammoth/mammoth.browser";
import { SaxesParser } from "saxes";
import { sanitiseImport } from "./sanitise";

export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
export const DOCX_STYLE_MAP = [
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
export interface SkippedItem {
  label: string;
  count: number;
}
export interface DocxImportOptions {
  uploadImage: (data: ArrayBuffer, contentType: string) => Promise<string>;
  progress: (progress: ImportProgress) => void;
}
const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
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
  const result = await mammoth.convertToHtml(
    { arrayBuffer: await archive.toArrayBuffer() },
    {
      styleMap: DOCX_STYLE_MAP,
      includeEmbeddedStyleMap: false,
      externalFileAccess: false,
      convertImage: mammoth.images.imgElement(async (image) => {
        const placeholder = `https://docs.invalid/import-image/${images.length}`;
        // Reserve the index before awaiting: mammoth may convert images concurrently.
        const slot = { data: new ArrayBuffer(0), contentType: image.contentType, placeholder };
        images.push(slot);
        slot.data = await image.readAsArrayBuffer();
        return { src: placeholder };
      }),
    },
  );
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
  return { html: sanitiseImport(html), skipped: inspected.skipped };
}
