// AUTHORED-BY Codex GPT-6
/** A bounded MIME subset for the offline exchange, with an opaque base64 structured part. */
import { digestBytes } from "../core/canonical.js";
import { type ByteMessage, CarriageError, oneCopy } from "./bytes.js";

const boundary = "answerable-mime-v1";
const utf8 = new TextEncoder();

export function isAgentDescriptionAddress(value: string): boolean {
  return /^https:\/\/[^/]/i.test(value) && !/[\s\p{Cc}<>\\]/u.test(value) && URL.canParse(value);
}

export function descriptionAddressForActor(actor: string): string | undefined {
  if (!isAgentDescriptionAddress(actor)) return undefined;
  const url = new URL(actor);
  if (url.username || url.password) return undefined;
  url.hash = "";
  url.search = "";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/description`;
  return url.href;
}

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
    !isAgentDescriptionAddress(description) ||
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
  const source = new TextDecoder("utf-8", { fatal: true })
    .decode(mail.bytes)
    .replaceAll("\r\n", "\n");
  const separator = source.indexOf("\n\n");
  const head = separator < 0 ? source : source.slice(0, separator);
  const [contentType, duplicateType] = headerValues(head, "Content-Type");
  const type = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (type === undefined || type === "text/plain" || type === "text/html")
    throw new CarriageError("no-structured-content", "The email has no signed structured part.");
  const declared =
    /^multipart\/mixed[ \t]*;[ \t]*boundary[ \t]*=[ \t]*(?:"([A-Za-z0-9'()+_,./:=? -]{1,70})"|([A-Za-z0-9'+_.-]{1,70}))$/i.exec(
      contentType ?? "",
    );
  const boundaryValue = declared?.[1] ?? declared?.[2];
  if (separator < 0 || duplicateType !== undefined || !boundaryValue || boundaryValue.endsWith(" "))
    throw new CarriageError("malformed", "Unsupported MIME envelope.");
  const copies: ByteMessage[] = [];
  const readable: string[] = [];
  for (const part of mimeParts(source.slice(separator + 2), boundaryValue)) {
    const split = part.indexOf("\n\n");
    if (split < 0) throw new CarriageError("malformed", "Malformed MIME part.");
    const headers = part.slice(0, split);
    const data = part.slice(split + 2).replace(/[ \t\n]/g, "");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))
      throw new CarriageError("malformed", "Invalid base64 MIME part.");
    const [encoding, duplicateEncoding] = headerValues(headers, "Content-Transfer-Encoding");
    if (encoding?.toLowerCase() !== "base64" || duplicateEncoding !== undefined)
      throw new CarriageError("malformed", "Unsupported MIME transfer encoding.");
    const [mediaType, duplicateMediaType] = headerValues(headers, "Content-Type");
    if (!mediaType || duplicateMediaType !== undefined)
      throw new CarriageError("malformed", "Expected one MIME part type.");
    const bytes = Uint8Array.from(Buffer.from(data, "base64"));
    if (mediaType === "text/plain; charset=utf-8")
      readable.push(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    else copies.push({ bytes, mediaType });
  }
  if (readable.length !== 1)
    throw new CarriageError("human-parity-mismatch", "One readable copy is required.");
  const message = oneCopy(copies);
  const [description, duplicate] = headerValues(head, "Agent-Description");
  if (!description || duplicate !== undefined || !isAgentDescriptionAddress(description))
    throw new CarriageError("malformed", "The email requires one HTTPS agent description address.");
  return { message, readable: readable[0] as string, description };
}

function headerValues(head: string, name: string): string[] {
  const prefix = `${name.toLowerCase()}:`;
  return head
    .replace(/\n[ \t]+/g, " ")
    .split("\n")
    .filter((line) => line.toLowerCase().startsWith(prefix))
    .map((line) => line.slice(prefix.length).replace(/^[ \t]+|[ \t]+$/g, ""));
}

function* mimeParts(body: string, declared: string): Generator<string> {
  const open = `--${declared}`;
  const close = `${open}--`;
  let part: string[] | undefined;
  for (const line of body.split("\n")) {
    const delimiter = line.replace(/[ \t]+$/, "");
    if (delimiter === open || delimiter === close) {
      if (part) yield part.join("\n");
      if (delimiter === close) return;
      part = [];
    } else {
      part?.push(line);
    }
  }
  throw new CarriageError("malformed", "Missing closing MIME boundary.");
}
