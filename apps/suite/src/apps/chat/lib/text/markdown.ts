// AUTHORED-BY Codex GPT-6.1-Sol
import { parseInline } from "./inline";
import type { BlockNode, TextOptions } from "./types";

const fencePattern = /^ {0,3}(`{3,}|~{3,})([\w+-]*)\s*$/;
const listMarkerPattern = /^ {0,3}(?:([-+*])|([0-9]{1,9})[.)])(?=\s)/;
const quotePattern = /^ {0,3}> ?(.*)$/;

/** Scan whitespace and body separately so failed bodies cannot retry whitespace splits. */
function listItem(line: string) {
  const marker = listMarkerPattern.exec(line);
  if (!marker) return null;
  let bodyStart = marker[0].length;
  while (/\s/.test(line.charAt(bodyStart))) bodyStart += 1;
  // Preserve the former dot-based body's treatment of Unicode line separators.
  const body = line.slice(bodyStart);
  if (/[\u2028\u2029]/.test(body)) return null;
  return { ordered: marker[2] !== undefined, start: Number(marker[2] ?? 1), body };
}

/** Parse blocks without HTML passthrough, I/O, or any renderer dependency.
 * Lists and quotes are flat; continuation lines become separate paragraphs.
 * Unclosed fenced code consumes the remainder literally. CRLF/CR becomes LF.
 */
export function parseMessageText(source: string, options: TextOptions = {}): BlockNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: BlockNode[] = [];
  let offset = 0;
  while (offset < lines.length) {
    const line = lines[offset] as string;
    if (!line.trim()) {
      offset += 1;
      continue;
    }
    const fence = fencePattern.exec(line);
    if (fence) {
      const marker = fence[1] as string;
      const closer = new RegExp(`^ {0,3}${marker.charAt(0)}{${marker.length},}\\s*$`);
      const content: string[] = [];
      offset += 1;
      while (offset < lines.length && !closer.test(lines[offset] as string)) {
        content.push(lines[offset] as string);
        offset += 1;
      }
      blocks.push({ type: "codeBlock", language: fence[2] || null, value: content.join("\n") });
      offset += 1;
      continue;
    }
    if (quotePattern.test(line)) {
      const content: string[] = [];
      while (offset < lines.length) {
        const quote = quotePattern.exec(lines[offset] as string);
        if (!quote) break;
        content.push(quote[1] as string);
        offset += 1;
      }
      blocks.push({ type: "quote", children: parseInline(content.join("\n"), options) });
      continue;
    }
    const list = listItem(line);
    if (list) {
      const ordered = list.ordered;
      const items = [];
      while (offset < lines.length) {
        const item = listItem(lines[offset] as string);
        if (!item || item.ordered !== ordered) break;
        items.push(parseInline(item.body, options));
        offset += 1;
      }
      blocks.push({ type: "list", ordered, start: list.start, items });
      continue;
    }
    const content = [line];
    offset += 1;
    while (offset < lines.length) {
      const next = lines[offset] as string;
      if (!next.trim() || fencePattern.test(next) || quotePattern.test(next) || listItem(next)) {
        break;
      }
      content.push(next);
      offset += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(content.join("\n"), options) });
  }
  return blocks;
}
