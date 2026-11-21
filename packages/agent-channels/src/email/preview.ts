// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { readEnvelope } from "../direct/shared.js";
import { MAX_EMAIL_BYTES } from "../email-mime.js";
import { ChannelParseError } from "../errors.js";
import { previewBytes, previewText, withSignedMessage } from "../preview.js";
import type { Wire } from "../types.js";
import { renderHtml } from "./bodies.js";
import { headerValues, type MimeNode, parseMime, shapeOf } from "./mime.js";

/** Every header the renderer writes; anything else (Cc, Bcc, Reply-To…) refuses. */
const ROOT_HEADERS = [
  "from",
  "to",
  "subject",
  "date",
  "message-id",
  "mime-version",
  "auto-submitted",
  "x-agentic-reply",
  "content-type",
];
const LEAF_HEADERS = ["content-type", "content-transfer-encoding"];

/** Read header values without the MIME inspector's whitespace trimming/unfolding. */
function header(bytes: string, name: string): string {
  const lines = (bytes.split(/\r?\n\r?\n/, 1)[0] as string).split(/\r?\n/);
  const prefix = `${name}: `;
  const values = lines.filter((line) => line.slice(0, prefix.length).toLowerCase() === prefix);
  if (values.length !== 1 || lines.some((line) => /^[ \t]/.test(line)))
    throw new ChannelParseError("ambiguous preview MIME header");
  return previewText((values[0] as string).slice(prefix.length));
}
function headerNames(node: MimeNode, expected: readonly string[]): void {
  if (node.headers.map(([name]) => name).join() !== expected.join())
    throw new ChannelParseError("unsupported preview MIME headers");
}
function base64Leaf(node: MimeNode, extra: readonly string[] = []): string {
  headerNames(node, [LEAF_HEADERS[0] as string, ...extra, LEAF_HEADERS[1] as string]);
  if (headerValues(node, "content-transfer-encoding").join() !== "base64")
    throw new ChannelParseError("ambiguous preview MIME");
  return node.text as string;
}

/**
 * Decode the supported MIME layout itself: the visible To/Subject and plain text, an HTML
 * alternative that must say exactly the same, and the signed message the attachment
 * delivers to the recipient's agent, shown in full.
 */
export async function preview(wire: Wire): Promise<string> {
  const bytes = previewBytes(wire, "message/rfc822", MAX_EMAIL_BYTES);
  const parsed = parseMime(bytes);
  if (!parsed.ok) throw new ChannelParseError("invalid preview MIME");
  const root = parsed.root;
  if (
    shapeOf(root) !==
    "multipart/mixed(multipart/alternative(text/plain,text/html),application/ld+json)"
  )
    throw new ChannelParseError("unsupported preview MIME layout");
  headerNames(root, ROOT_HEADERS);
  const to = header(bytes, "to");
  const subject = header(bytes, "subject");
  const [alternative, attachment] = root.children as readonly MimeNode[];
  headerNames(alternative as MimeNode, ["content-type"]);
  const [plainNode, htmlNode] = (alternative as MimeNode).children as readonly MimeNode[];
  const plain = base64Leaf(plainNode as MimeNode);
  const carrier = base64Leaf(attachment as MimeNode, ["content-disposition"]);
  if (base64Leaf(htmlNode as MimeNode) !== renderHtml(plain, carrier))
    throw new ChannelParseError("preview HTML differs from the plain text");
  const { compactJws } = readEnvelope(carrier);
  return withSignedMessage(
    `To: ${to}\nSubject: ${subject}\n\n${previewText(plain.replaceAll("\r\n", "\n"))}`,
    compactJws,
    MAX_EMAIL_BYTES,
  );
}
