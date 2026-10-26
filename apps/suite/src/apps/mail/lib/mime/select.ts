// AUTHORED-BY Codex GPT-6
import type PostalMime from "postal-mime";
import type { Attachment } from "postal-mime";

// postal-mime 4.1.4 exposes its decoded tree at runtime, but omits it from its
// public declarations. Keep this version-specific seam here; regression tests
// exercise the real parser. No wire parsing or decoding is duplicated locally.
interface MimeNode {
  contentType: {
    multipart: string | false;
    parsed: { value: string; params: Record<string, string> };
  };
  contentId?: string;
  childNodes: MimeNode[];
  /** Finalized leaf bytes; multipart nodes do not use this field. */
  content: ArrayBuffer;
  getTextContent(): string;
}

interface DecodedParser {
  root: MimeNode;
  attachments: Attachment[];
  isInlineTextNode(node: MimeNode): boolean;
  collectAttachment(
    node: MimeNode,
    content: ArrayBuffer,
    related: boolean,
    exceeded: boolean,
  ): void;
}

interface Selection {
  plain?: string | undefined;
  html?: string | undefined;
  attachments: Attachment[];
}

const bareId = (id: string) => id.trim().replace(/^<|>$/g, "");

/** Select real representations before flattening loses multipart semantics. */
export function selectMimeContent(parser: PostalMime): Selection {
  const decoded = parser as unknown as DecodedParser;
  // Reuse postal-mime's attachment metadata/byte handling, including for text
  // resources that its default collector incorrectly treated as body content.
  decoded.attachments = [];

  const select = (node: MimeNode, resource = false, related = false): Selection => {
    if (!node.contentType.multipart) {
      if (!resource && decoded.isInlineTextNode(node)) {
        const type = node.contentType.parsed.value === "text/html" ? "html" : "plain";
        return { [type]: node.getTextContent(), attachments: [] };
      }
      const start = decoded.attachments.length;
      decoded.collectAttachment(node, node.content, related, false);
      return { attachments: decoded.attachments.slice(start) };
    }

    const subtype = node.contentType.multipart;
    const start = node.contentType.parsed.params.start;
    // An invalid start conservatively falls back to the first child. IDs remain
    // case sensitive, and matching is only against immediate children (RFC 2387).
    const root =
      node.childNodes.find((child) => start && bareId(child.contentId ?? "") === bareId(start)) ??
      node.childNodes[0];
    const children = node.childNodes.map((child) =>
      select(
        child,
        resource || (subtype === "related" && child !== root),
        related || subtype === "related",
      ),
    );

    if (subtype === "alternative" && !resource) {
      // RFC 2046 orders alternatives by increasing preference. Select once per
      // exposed representation; a nested alternative replaces its outer fallback.
      const plain = children.findLast((child) => child.plain !== undefined);
      const html = children.findLast((child) => child.html !== undefined);
      const chosen = new Set([plain, html]);
      return {
        plain: plain?.plain,
        html: html?.html,
        attachments: children
          .filter(
            (child) => chosen.has(child) || (child.plain === undefined && child.html === undefined),
          )
          .flatMap((child) => child.attachments),
      };
    }

    const result: Selection = { attachments: children.flatMap((child) => child.attachments) };
    for (const type of ["plain", "html"] as const) {
      const bodies = children.flatMap((child) => (child[type] === undefined ? [] : [child[type]]));
      if (bodies.length) result[type] = bodies.join("\n");
    }
    return result;
  };

  return select(decoded.root);
}
