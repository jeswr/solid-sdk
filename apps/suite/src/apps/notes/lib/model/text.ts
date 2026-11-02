// AUTHORED-BY Codex GPT-6.1-Sol
import sanitizeHtml from "sanitize-html";

/** Plain text only: the HTML parser decodes entities before sanitization escapes them. */
export function noteText(html: string): string {
  const chunks: string[] = [];
  const boundary = (tag: string) => {
    if (/^(?:li|p|div|br|h[1-6]|tr|blockquote|pre)$/.test(tag)) chunks.push("\n");
  };
  sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    onOpenTag: boundary,
    onCloseTag: boundary,
    textFilter: (text) => {
      // Decode exactly one layer of the sanitizer's three text escapes. This keeps
      // literal entity spellings intact and never interprets decoded text as HTML.
      chunks.push(
        text
          .replace(/\s+/g, " ")
          .replace(
            /&(?:amp|lt|gt);/g,
            (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">" })[entity] as string,
          ),
      );
      return "";
    },
  });
  return chunks
    .join("")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}
