// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  base64Lines,
  crlf,
  encodeHeader,
  filenameParameter,
  formatAddress,
  header,
  utf8,
} from "./encoding";
import type { Attachment, ComposedMessage, ComposeInput, ComposeSources } from "./types";
import {
  address,
  addresses,
  ComposeError,
  date,
  domain,
  key,
  messageId,
  record,
  requireInput,
  text,
  threading,
} from "./validation";

function textPart(value: string, subtype: "plain" | "html"): string {
  text(value, subtype);
  return `Content-Type: text/${subtype}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Lines(utf8(crlf(value)))}`;
}
function attachmentPart(value: Attachment): string {
  record(value, "attachment");
  requireInput(
    typeof value.contentType === "string" &&
      /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(value.contentType),
    "contentType",
  );
  // Multipart/message content needs its own transfer rules; only leaf media types are supported.
  requireInput(!/^(multipart|message)\//i.test(value.contentType), "contentType");
  let contentType = value.contentType;
  if (value.charset !== undefined) {
    requireInput(
      /^text\//i.test(contentType) &&
        typeof value.charset === "string" &&
        /^[!#$%&'*+\-.^_`{|}~a-z0-9]+$/i.test(value.charset),
      "attachment.charset",
    );
    contentType += `; charset=${value.charset}`;
  }
  requireInput(value.data instanceof Uint8Array, "attachment.data");
  return `Content-Type: ${contentType}\r\nContent-Disposition: attachment;\r\n ${filenameParameter(value.filename)}\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Lines(value.data)}`;
}
function multipart(parts: string[], subtype: string, boundary: string): string {
  return `Content-Type: multipart/${subtype};\r\n boundary="${boundary}"\r\n\r\n${parts.map((part) => `--${boundary}\r\n${part}\r\n`).join("")}--${boundary}--`;
}
export function composeMessage(input: ComposeInput, sources: ComposeSources): ComposedMessage {
  record(input, "message");
  address(input.from);
  for (const list of [input.to, input.cc, input.bcc, input.replyTo]) {
    if (list !== undefined) addresses(list);
  }
  const recipients = [...(input.to ?? []), ...(input.cc ?? []), ...(input.bcc ?? [])];
  requireInput(recipients.length > 0, "recipients");
  requireInput(input.replyTo === undefined || input.replyTo.length > 0, "replyTo");
  threading(input);
  record(sources, "sources");
  domain(sources.messageIdDomain);
  let now: Date;
  let random: Uint8Array;
  try {
    now = sources.clock();
    random = sources.randomBytes(16);
  } catch {
    throw new ComposeError("invalid-source", "clock/randomBytes");
  }
  date(now);
  requireInput(random instanceof Uint8Array && random.length === 16, "randomBytes");
  const token = Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const id = `<${now.getTime().toString(36)}.${token}@${sources.messageIdDomain}>`;
  messageId(id);
  const fields = [
    header("Date", now.toUTCString().replace("GMT", "+0000")),
    header("Message-ID", id),
    header("From", formatAddress(input.from)),
  ];
  for (const [name, list] of [
    ["To", input.to],
    ["Cc", input.cc],
    ["Reply-To", input.replyTo],
  ] as const) {
    if (list !== undefined && list.length > 0)
      fields.push(header(name, list.map(formatAddress).join(",\r\n ")));
  }
  fields.push(header("Subject", encodeHeader(input.subject)));
  if (input.inReplyTo !== undefined) fields.push(header("In-Reply-To", input.inReplyTo));
  if (input.references !== undefined && input.references.length > 0)
    fields.push(header("References", input.references.join("\r\n ")));
  fields.push("MIME-Version: 1.0");
  let body = textPart(input.text, "plain");
  if (input.html !== undefined)
    body = multipart([body, textPart(input.html, "html")], "alternative", `=_suite_alt_${token}`);
  if (input.attachments !== undefined) {
    requireInput(Array.isArray(input.attachments), "attachments");
    if (input.attachments.length > 0)
      body = multipart(
        [body, ...Array.from(input.attachments, attachmentPart)],
        "mixed",
        `=_suite_mix_${token}`,
      );
  }
  // Boundaries contain '_' and cannot occur in any of our base64-encoded leaf bodies.
  const raw = `${fields.join("\r\n")}\r\n${body}\r\n`;
  requireInput(
    raw.split("\r\n").every((line) => line.length <= 998),
    "lineLength",
  );
  const seen = new Set<string>();
  const to = recipients
    .filter(({ email }) => {
      const canonical = key(email);
      if (seen.has(canonical)) return false;
      seen.add(canonical);
      return true;
    })
    .map(({ email }) => email);
  return {
    raw,
    messageId: id,
    date: new Date(now.getTime()),
    envelope: { from: input.from.email, to },
  };
}
