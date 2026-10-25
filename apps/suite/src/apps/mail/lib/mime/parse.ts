// AUTHORED-BY Codex GPT-6.1-Sol
import PostalMime, { type Address, decodeWords } from "postal-mime";
import { sanitizeMessageHtml } from "./html";

export type MimeAddress = Address;
/** Pass original bytes for messages containing unencoded non-UTF-8 octets. */
export type MimeInput = string | Uint8Array | ArrayBuffer;

export interface MimeHeader {
  /** Lowercase name; duplicate fields remain in document order. */
  name: string;
  /** Unfolded wire value, retained for structured-header consumers. */
  rawValue: string;
  /** RFC 2047 encoded words decoded to Unicode. Treat as untrusted plain text. */
  value: string;
}

export interface MimeAttachment {
  /** Untrusted metadata, never a filesystem path or a download instruction. */
  filename: string | null;
  contentType: string;
  disposition: string | null;
  description: string | null;
  /** Bare, case-sensitive ID matching HTML's data-inline-cid attribute. */
  contentId: string | null;
  inline: boolean;
  size: number;
  content: Uint8Array;
}

export interface MimeMessage {
  headers: MimeHeader[];
  from: MimeAddress | null;
  sender: MimeAddress | null;
  to: MimeAddress[];
  cc: MimeAddress[];
  bcc: MimeAddress[];
  replyTo: MimeAddress[];
  subject: string;
  /** ISO date when valid; otherwise the original header value. */
  date: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  /** Untrusted plain-text body; empty when the message has only HTML or attachments. */
  text: string;
  /** Sanitised reading HTML; null when no HTML representation exists. */
  html: string | null;
  /** Includes inline CID parts; bytes are decoded but never executed or loaded. */
  attachments: MimeAttachment[];
}

/**
 * Parse RFC 5322 / MIME bytes without I/O. Postal-mime handles multipart selection,
 * transfer encodings, charsets and encoded parameters. Its bounded parser errors
 * propagate as rejected promises. Encapsulated messages remain downloadable parts.
 */
export async function parseMimeMessage(input: MimeInput): Promise<MimeMessage> {
  const message = await PostalMime.parse(input, {
    attachmentEncoding: "arraybuffer",
    forceRfc822Attachments: true,
  });
  return {
    headers: message.headers.map(({ key, value }) => ({
      name: key,
      rawValue: value,
      value: decodeWords(value),
    })),
    from: message.from ?? null,
    sender: message.sender ?? null,
    to: message.to ?? [],
    cc: message.cc ?? [],
    bcc: message.bcc ?? [],
    replyTo: message.replyTo ?? [],
    subject: message.subject ?? "",
    date: message.date ?? null,
    messageId: message.messageId ?? null,
    inReplyTo: message.inReplyTo ?? null,
    references: message.references ?? null,
    text: message.text ?? "",
    html: message.html === undefined ? null : sanitizeMessageHtml(message.html),
    attachments: message.attachments.map((part) => {
      // arraybuffer is fixed above; postal-mime cannot return string content here.
      const content = new Uint8Array(part.content as ArrayBuffer);
      return {
        filename: part.filename,
        contentType: part.mimeType,
        disposition: part.disposition,
        description: part.description ?? null,
        contentId: part.contentId?.trim().replace(/^<|>$/g, "") ?? null,
        inline: part.related === true || part.disposition === "inline",
        size: content.byteLength,
        content,
      };
    }),
  };
}
