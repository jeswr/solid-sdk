// AUTHORED-BY Codex GPT-6
/** A bounded MIME subset for the offline exchange, with an opaque base64 structured part. */
import { digestBytes } from "../core/canonical.js";
import { type ByteMessage, CarriageError, oneCopy } from "./bytes.js";

const boundary = "answerable-mime-v1";
const utf8 = new TextEncoder();
export function writeEmail(
  message: ByteMessage,
  readable: string,
  description: string,
  routing: { from: string; to: string; date: string; messageId: string } = {
    from: "sender@fictional.example",
    to: "receiver@fictional.example",
    date: "Fri, 13 Nov 2026 09:00:00 +0000",
    messageId: `${digestBytes(message.bytes).slice(7)}@fictional.example`,
  },
): ByteMessage {
  if (
    /[\r\n]/.test(description) ||
    /[\r\n]/.test(message.mediaType) ||
    Object.values(routing).some((value) => /[\r\n<>]/.test(value))
  )
    throw new CarriageError("malformed", "Invalid MIME header.");
  const text = [
    `From: <${routing.from}>`,
    `To: <${routing.to}>`,
    `Date: ${routing.date}`,
    `Message-ID: <${routing.messageId}>`,
    "Subject: An automated signed message",
    "MIME-Version: 1.0",
    `Agent-Description: ${description}`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(readable).toString("base64"),
    `--${boundary}`,
    `Content-Type: ${message.mediaType}`,
    "Content-Disposition: attachment; name=answerable",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(message.bytes).toString("base64"),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return { bytes: utf8.encode(text), mediaType: `multipart/mixed; boundary="${boundary}"` };
}
export function readEmail(mail: ByteMessage): {
  message: ByteMessage;
  readable: string;
  description: string;
} {
  if (mail.bytes.length > 2_000_000)
    throw new CarriageError("bounds-exceeded", "The email exceeds the carriage bound.");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(mail.bytes);
  const pieces = source.split(`--${boundary}`);
  const header = pieces.shift() ?? "";
  if (!header.includes(`Content-Type: multipart/mixed; boundary="${boundary}"`))
    throw new CarriageError("malformed", "Unsupported MIME envelope.");
  const description = /^Agent-Description: ([^\r\n]+)$/m.exec(header)?.[1];
  if (!description)
    throw new CarriageError("malformed", "The email has no agent description header.");
  const copies: ByteMessage[] = [];
  const readable: string[] = [];
  for (const part of pieces) {
    if (part.startsWith("--")) continue;
    const split = part.indexOf("\r\n\r\n");
    if (split < 0) throw new CarriageError("malformed", "Malformed MIME part.");
    const headers = part.slice(0, split);
    const data = part.slice(split + 4).replace(/\s/g, "");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))
      throw new CarriageError("malformed", "Invalid base64 MIME part.");
    if (!headers.includes("Content-Transfer-Encoding: base64"))
      throw new CarriageError("malformed", "Unsupported MIME transfer encoding.");
    const mediaType = /Content-Type: ([^\r\n]+)/.exec(headers)?.[1];
    if (!mediaType) throw new CarriageError("malformed", "Missing MIME part type.");
    const bytes = Uint8Array.from(Buffer.from(data, "base64"));
    if (mediaType === "text/plain; charset=utf-8")
      readable.push(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    else copies.push({ bytes, mediaType });
  }
  if (readable.length !== 1)
    throw new CarriageError("human-parity-mismatch", "One readable copy is required.");
  return { message: oneCopy(copies), readable: readable[0] as string, description };
}
