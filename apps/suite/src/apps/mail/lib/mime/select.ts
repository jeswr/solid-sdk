// AUTHORED-BY Codex GPT-6
import type PostalMime from "postal-mime";
import type { Attachment } from "postal-mime";
import { MimeParseError } from "./errors";

// postal-mime 4.1.4 exposes its decoded tree at runtime, but omits it from its
// public declarations. Keep this version-specific seam here; regression tests
// exercise the real parser. No wire parsing or decoding is duplicated locally.
interface MimeNode {
  contentType: {
    multipart: string | false;
    parsed: { value: string; params: Record<string, string> };
  };
  contentId?: string;
  contentDisposition: { parsed: { value: string } };
  childNodes: MimeNode[];
  finalizedChildCount: number;
  state: "header" | "body" | "finished";
  /** Finalized leaf bytes; multipart nodes do not use this field. */
  content: ArrayBuffer;
  getTextContent(): string;
  feed(line: Uint8Array, lineBreak: Uint8Array): boolean;
  finalizeChildNodes(boundaryEnded: boolean): Promise<void>;
}

interface DecodedParser {
  root: MimeNode;
  currentNode: MimeNode;
  buf: ArrayBuffer;
  av: Uint8Array;
  readPos: number;
  processLine(line: Uint8Array, lineBreak: Uint8Array, isFinal: boolean): Promise<void>;
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

/** Retain multipart body spans while postal-mime still knows their boundaries. */
export function retainMultipartContent(parser: PostalMime): (node: MimeNode) => ArrayBuffer {
  const decoded = parser as unknown as DecodedParser;
  const spans = new Map<MimeNode, { start: number; end?: number }>();
  const processLine = decoded.processLine.bind(decoded);
  decoded.processLine = async (line, lineBreak, isFinal) => {
    const node = decoded.currentNode;
    if (!spans.has(node)) {
      const span = { start: decoded.av.length };
      spans.set(node, span);
      const feed = node.feed.bind(node);
      node.feed = (bytes, ending) => {
        const wasHeader = node.state === "header";
        const repeat = feed(bytes, ending);
        if (wasHeader && node.state !== "header") {
          span.start = repeat ? bytes.byteOffset : decoded.readPos;
        }
        return repeat;
      };
      const finalizeChildren = node.finalizeChildNodes.bind(node);
      node.finalizeChildNodes = async (boundaryEnded) => {
        if (boundaryEnded) {
          // The preceding CRLF belongs to the delimiter, not the child entity.
          const end = lineOffset - (decoded.av[lineOffset - 2] === 13 ? 2 : 1);
          for (const child of node.childNodes.slice(node.finalizedChildCount)) {
            const childSpan = spans.get(child) as { start: number; end?: number };
            childSpan.end = Math.max(childSpan.start, end);
          }
        }
        await finalizeChildren(boundaryEnded);
      };
    }
    lineOffset = line.byteOffset;
    // readLine invents LF at EOF without a newline. Derive the final break from
    // the wire span instead, retaining real CR/LF bytes without appending any.
    const ending = isFinal
      ? decoded.av.subarray(line.byteOffset + line.byteLength, decoded.readPos)
      : lineBreak;
    await processLine(line, ending, isFinal);
  };
  let lineOffset = 0;
  return (node) => {
    const span = spans.get(node) as { start: number; end?: number };
    return decoded.buf.slice(span.start, span.end);
  };
}

/** Select real representations before flattening loses multipart semantics. */
export function selectMimeContent(
  parser: PostalMime,
  multipartContent: (node: MimeNode) => ArrayBuffer,
): Selection {
  const decoded = parser as unknown as DecodedParser;
  // Reuse postal-mime's attachment metadata, including for text
  // resources that its default collector incorrectly treated as body content.
  decoded.attachments = [];

  const select = (
    node: MimeNode,
    resource = false,
    related = false,
    relatedRoot = false,
  ): Selection => {
    const disposition = node.contentDisposition.parsed.value;
    const attached = disposition !== "" && disposition !== "inline" && !relatedRoot;
    if (!node.contentType.multipart || attached) {
      const supported = ["text/plain", "text/html"].includes(node.contentType.parsed.value);
      if (!resource && !attached && supported && (relatedRoot || decoded.isInlineTextNode(node))) {
        const type = node.contentType.parsed.value === "text/html" ? "html" : "plain";
        return { [type]: node.getTextContent(), attachments: [] };
      }
      const start = decoded.attachments.length;
      const content = node.contentType.multipart ? multipartContent(node) : node.content;
      decoded.collectAttachment(node, content, related, false);
      const attachments = decoded.attachments.slice(start);
      // The collector transcodes calendars and normalizes line endings. Downloads
      // must instead retain the original transfer-decoded bytes for every type.
      for (const attachment of attachments) attachment.content = content;
      return { attachments };
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
        subtype === "related" && child === root,
      ),
    );

    if (subtype === "alternative" && !resource) {
      // RFC 2046 orders alternatives by increasing preference. Select once per
      // exposed representation; a nested alternative replaces its outer fallback.
      const plain = children.findLast((child) => child.plain !== undefined);
      const html = children.findLast((child) => child.html !== undefined);
      const chosen = new Set([plain, html]);
      const retained = children.filter(
        (child) => chosen.has(child) || (child.plain === undefined && child.html === undefined),
      );
      const ids = new Set<string>();
      for (const child of retained) {
        const childIds = new Set(
          child.attachments.flatMap((part) => (part.contentId ? [bareId(part.contentId)] : [])),
        );
        for (const id of childIds) {
          // A flat CID namespace cannot represent resources with different
          // alternative owners. Fail closed rather than bind HTML to wrong bytes.
          if (ids.has(id)) throw new MimeParseError();
          ids.add(id);
        }
      }
      return {
        plain: plain?.plain,
        html: html?.html,
        attachments: retained.flatMap((child) => child.attachments),
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
