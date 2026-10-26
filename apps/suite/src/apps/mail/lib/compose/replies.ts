// AUTHORED-BY Codex GPT-6.1-Sol
import { crlf } from "./encoding";
import type { MailAddress, MessageDraft, OriginalMessage } from "./types";
import {
  address,
  addresses,
  date,
  headerText,
  key,
  mailbox,
  messageId,
  record,
  requireInput,
  text,
  threading,
} from "./validation";

function validate(original: OriginalMessage) {
  record(original, "original");
  address(original.from);
  for (const list of [original.to, original.cc, original.replyTo]) {
    if (list !== undefined) addresses(list);
  }
  requireInput(original.replyTo === undefined || original.replyTo.length > 0, "replyTo");
  headerText(original.subject, "subject");
  text(original.text, "text");
  date(original.date);
  if (original.messageId !== undefined) messageId(original.messageId);
  threading(original);
}
function textAddress(value: MailAddress): string {
  return value.name === undefined ? value.email : `${value.name} <${value.email}>`;
}
function quote(original: OriginalMessage): string {
  return `On ${original.date.toUTCString()}, ${textAddress(original.from)} wrote:\r\n${crlf(
    original.text,
  )
    .split("\r\n")
    .map((line) => `> ${line}`)
    .join("\r\n")}`;
}
function prefixed(subject: string, prefix: "Re" | "Fwd"): string {
  return new RegExp(`^${prefix}:`, "i").test(subject) ? subject : `${prefix}: ${subject}`;
}
function replyDraft(
  original: OriginalMessage,
  identities: readonly string[],
  all: boolean,
): MessageDraft {
  validate(original);
  requireInput(Array.isArray(identities) && identities.length > 0, "identities");
  const seen = new Set<string>();
  for (const email of identities) {
    mailbox(email);
    seen.add(key(email));
  }
  const unique = (values: readonly MailAddress[]) =>
    values
      .filter(({ email }) => {
        const canonical = key(email);
        if (seen.has(canonical)) return false;
        seen.add(canonical);
        return true;
      })
      .map((value) => ({ ...value }));
  let to = unique(original.replyTo ?? [original.from]);
  if (to.length === 0) to = unique(original.to ?? []);
  if (all) to.push(...unique(original.to ?? []));
  const cc = all ? unique(original.cc ?? []) : [];
  requireInput(to.length + cc.length > 0, "recipients");
  const draft: MessageDraft = {
    to,
    cc,
    subject: prefixed(original.subject, "Re"),
    text: `\r\n\r\n${quote(original)}`,
  };
  if (original.messageId !== undefined) {
    draft.inReplyTo = original.messageId;
    const parents =
      original.references ?? (original.inReplyTo === undefined ? [] : [original.inReplyTo]);
    draft.references = [
      ...new Set(parents.filter((id) => id !== original.messageId)),
      original.messageId,
    ];
  }
  return draft;
}
export function reply(original: OriginalMessage, identities: readonly string[]): MessageDraft {
  return replyDraft(original, identities, false);
}
export function replyAll(original: OriginalMessage, identities: readonly string[]): MessageDraft {
  return replyDraft(original, identities, true);
}
export function forward(original: OriginalMessage): MessageDraft {
  validate(original);
  return {
    to: [],
    cc: [],
    subject: prefixed(original.subject, "Fwd"),
    text: `\r\n\r\n---------- Forwarded message ----------\r\nFrom: ${textAddress(original.from)}\r\nSubject: ${original.subject}\r\n\r\n${quote(original)}`,
  };
}
