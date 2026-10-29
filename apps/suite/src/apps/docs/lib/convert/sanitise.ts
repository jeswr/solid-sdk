// AUTHORED-BY Codex
import sanitizeHtml from "sanitize-html";
import { normaliseDestination, normaliseImageDestination } from "../editor/destination";
import { reportSkipped, type SkippedItem } from "./skipped";

/** Only the editor's supported HTML surface; no styles, active content or embedded data. */
export function sanitiseImport(html: string, skipped: SkippedItem[] = []): string {
  const allowedTags = [
    "p",
    "h1",
    "h2",
    "h3",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "strike",
    "sub",
    "sup",
    "mark",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "hr",
    "br",
    "a",
    "img",
  ];
  const allowedAttributes: Record<string, string[]> = {
    a: ["href", "title"],
    img: ["src", "alt", "width", "height"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
    ol: ["start"],
    ul: ["data-type"],
    li: ["data-type", "data-checked"],
  };
  return sanitizeHtml(html, {
    allowedTags,
    allowedAttributes,
    transformTags: {
      "*": (tagName, attribs) => {
        if (/^h[4-6]$/.test(tagName)) tagName = "h3";
        if (!allowedTags.includes(tagName)) reportSkipped(skipped, "Unsupported HTML");
        for (const key of Object.keys(attribs)) {
          if (!(allowedAttributes[tagName] ?? []).includes(key)) {
            delete attribs[key];
            reportSkipped(skipped, "Unsupported attributes");
          }
        }
        for (const key of ["src", "href"]) {
          const url = attribs[key];
          if (url === undefined) continue;
          const destination =
            key === "src" ? normaliseImageDestination(url) : normaliseDestination(url);
          if (!destination) {
            delete attribs[key];
            reportSkipped(skipped, "Unsafe URLs");
          } else attribs[key] = destination;
        }
        return { tagName, attribs };
      },
    },
    allowedSchemes: ["https", "http", "mailto"],
    allowedSchemesByTag: { img: ["https", "http"] },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
  });
}
