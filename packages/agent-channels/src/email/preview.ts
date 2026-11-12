// AUTHORED-BY Codex GPT-6.1-Sol
import { MAX_EMAIL_BYTES } from "../email-mime.js";
import { ChannelParseError } from "../errors.js";
import { previewBytes, previewText } from "../preview.js";
import type { Wire } from "../types.js";
import { headerValues, type MimeNode, parseMime, shapeOf } from "./mime.js";

/** Read header values without the MIME inspector's whitespace trimming/unfolding. */
function header(bytes: string, name: string): string {
  const lines = (bytes.split(/\r?\n\r?\n/, 1)[0] as string).split(/\r?\n/);
  const prefix = `${name}: `;
  const values = lines.filter((line) => line.slice(0, prefix.length).toLowerCase() === prefix);
  if (values.length !== 1 || lines.some((line) => /^[ \t]/.test(line)))
    throw new ChannelParseError("ambiguous preview MIME header");
  return previewText((values[0] as string).slice(prefix.length));
}

/** Decode the supported MIME layout itself, including the text/plain footer. */
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
  const to = header(bytes, "to");
  const subject = header(bytes, "subject");
  const alternative = (root.children as readonly MimeNode[])[0] as MimeNode;
  const plain = (alternative.children as readonly MimeNode[])[0] as MimeNode;
  if (headerValues(plain, "content-transfer-encoding").join() !== "base64")
    throw new ChannelParseError("ambiguous preview MIME");
  return `To: ${to}\nSubject: ${subject}\n\n${previewText((plain.text as string).replaceAll("\r\n", "\n"))}`;
}
