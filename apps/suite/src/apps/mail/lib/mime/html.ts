// AUTHORED-BY Codex GPT-6.1-Sol
import sanitizeHtml from "sanitize-html";

/**
 * Keep reading markup and user-activated links only. No CSS, script, forms, embedded
 * documents, SVG, or load-bearing resource attributes survive. CID image references
 * are inert metadata: consumers may resolve them against parsed attachment bytes.
 */
export function sanitizeMessageHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "a",
      "p",
      "div",
      "span",
      "br",
      "hr",
      "blockquote",
      "pre",
      "code",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "sub",
      "sup",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "dl",
      "dt",
      "dd",
      "table",
      "caption",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "th",
      "td",
      "img",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      img: ["alt", "title", "data-inline-cid"],
      th: ["colspan", "rowspan", "scope"],
      td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["https", "http", "mailto"],
    allowProtocolRelative: false,
    parseStyleAttributes: false,
    nonTextTags: [
      "script",
      "style",
      "textarea",
      "option",
      "iframe",
      "object",
      "svg",
      "math",
      "template",
    ],
    transformTags: {
      img: (_tag, attributes) => {
        const cid = /^cid:(.+)$/i.exec(attributes.src ?? "")?.[1];
        return {
          tagName: "img",
          attribs: {
            alt: attributes.alt ?? "",
            title: attributes.title ?? "",
            ...(cid ? { "data-inline-cid": cid } : {}),
          },
        };
      },
    },
  });
}
