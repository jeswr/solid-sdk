// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import PostalMime, { type Address, decodeWords } from "postal-mime";
import { Attachment } from "./attachment.js";
import type { MailStore } from "./io.js";
import { MailboxDataset } from "./mailbox.js";
import { attachmentUrl, mailDocument, mailRoot } from "./paths.js";
import { SCHEMA } from "./vocab.js";

/** One message at a time; the enclosing mailbox is never buffered. Input is RFC 4155 mboxrd. */
export async function* splitMbox(
  source: AsyncIterable<Uint8Array>,
  maxMessageBytes = 25 * 1024 * 1024,
): AsyncGenerator<Uint8Array> {
  if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 1)
    throw new TypeError("Invalid message limit");
  let pending = new Uint8Array(0);
  let lines: Uint8Array[] = [];
  let size = 0;
  let started = false;
  const decoder = new TextDecoder("ascii");
  function append(line: Uint8Array): void {
    size += line.length;
    if (size > maxMessageBytes) throw new RangeError("Mail message exceeds import limit");
    lines.push(line);
  }
  function bytes(): Uint8Array {
    const out = new Uint8Array(size);
    let offset = 0;
    for (const line of lines) {
      out.set(line, offset);
      offset += line.length;
    }
    return out;
  }
  for await (const chunk of source) {
    const joined = new Uint8Array(pending.length + chunk.length);
    joined.set(pending);
    joined.set(chunk, pending.length);
    let start = 0;
    for (let i = 0; i < joined.length; i++) {
      if (joined[i] !== 10) continue;
      const line = joined.slice(start, i + 1);
      start = i + 1;
      const prefix = decoder.decode(line.subarray(0, 128));
      if (prefix.startsWith("From ")) {
        if (started && size) yield bytes();
        started = true;
        lines = [];
        size = 0;
      } else {
        if (!started) throw new TypeError("Expected mbox From separator");
        // mboxrd quotes body lines beginning with From (including already quoted lines).
        append(/^>+From /.test(prefix) ? line.slice(1) : line);
      }
    }
    pending = joined.slice(start);
    if (size + pending.length > maxMessageBytes)
      throw new RangeError("Mail message exceeds import limit");
  }
  if (pending.length) {
    if (!started) throw new TypeError("Expected mbox From separator");
    const prefix = decoder.decode(pending.subarray(0, 128));
    append(/^>+From /.test(prefix) ? pending.slice(1) : pending);
  }
  if (size) yield bytes();
}

export interface ImportedMail {
  mailbox: MailboxDataset;
  id: string;
  message: string;
  thread: string;
  folders: { iri: string; title: string }[];
  raw: Uint8Array;
  attachments: { url: string; name: string; contentType: string; content: ArrayBuffer }[];
}
function addresses(values: Address[]): string[] {
  return values.flatMap((value) =>
    value.group
      ? addresses(value.group)
      : value.address
        ? [`mailto:${encodeURIComponent(value.address)}`]
        : [],
  );
}
/** MIME decoding is delegated to the browser-safe postal-mime parser. HTML remains inert data. */
export async function parseEmail(
  raw: Uint8Array,
  storage: string,
  account: string,
  fallbackId: string,
): Promise<ImportedMail> {
  const root = mailRoot(storage, account);
  const email = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" });
  const id = email.messageId || fallbackId;
  const references =
    email.headers.find((h) => h.key === "references")?.value.match(/<[^>]+>/g) ?? [];
  const threadId = references[0] || email.inReplyTo || id;
  const url = mailDocument(root, "messages", id);
  const mailbox = new MailboxDataset(new Store(), DataFactory);
  const message = mailbox.createMessage(`${url}#it`);
  message.identifier = id;
  message.subjectLine = email.subject;
  message.body = email.text;
  message.sender = addresses(email.from ? [email.from] : [])[0];
  for (const iri of addresses(email.to ?? [])) message.to.add(iri);
  for (const iri of addresses(email.cc ?? [])) message.cc.add(iri);
  for (const iri of addresses(email.bcc ?? [])) message.bcc.add(iri);
  if (email.date) {
    const date = new Date(email.date);
    if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid message date");
    message.dateSent = date;
  }
  message.encoding = url.replace(/\.ttl$/, ".eml");
  message.partOfThread = `${mailDocument(root, "threads", threadId)}#it`;
  if (email.inReplyTo) message.inReplyTo = `${mailDocument(root, "messages", email.inReplyTo)}#it`;
  const gmailHeaders = email.headers.filter((h) => h.key === "x-gmail-labels");
  const labels = new Set(
    gmailHeaders
      .map((h) => h.value)
      .join(",")
      .split(",")
      .map((s) => decodeWords(s.trim()))
      .filter(Boolean),
  );
  const unread = labels.delete("Unread");
  const opened = labels.delete("Opened");
  const read = labels.delete("Read");
  message.setRead(
    !unread &&
      (gmailHeaders.length > 0 ||
        opened ||
        read ||
        /R/.test(email.headers.find((h) => h.key === "status")?.value ?? "")),
    message.dateSent ?? new Date(0),
  );
  if (gmailHeaders.length === 0) labels.add("Inbox");
  if (labels.delete("Archived")) labels.add("Archive");
  const folders = [...labels].map((title) => ({
    title,
    iri: `${mailDocument(root, "folders", ["Inbox", "Sent", "Drafts", "Trash", "Archive", "Starred"].includes(title) ? title.toLowerCase() : title)}#it`,
  }));
  for (const folder of folders) message.folderIris.add(folder.iri);
  const attachments = email.attachments.map((a, index) => ({
    url: attachmentUrl(storage, id, index),
    name: a.filename || "attachment",
    contentType: a.mimeType,
    content: a.content as ArrayBuffer,
  }));
  for (const a of attachments) {
    message.attachments.add(a.url);
    const metadata = new Attachment(a.url, mailbox, DataFactory);
    metadata.types.add(`${SCHEMA}MediaObject`);
    metadata.name = a.name;
    metadata.contentType = a.contentType;
  }
  return {
    mailbox,
    id,
    message: message.value,
    thread: message.partOfThread,
    folders,
    raw,
    attachments,
  };
}
/** Takeout's extracted .mbox uses the same streaming path, including X-Gmail-Labels. */
export async function* importMbox(
  source: AsyncIterable<Uint8Array>,
  storage: string,
  account: string,
  mintId: () => string,
): AsyncGenerator<ImportedMail> {
  const threads = new Map<string, string>();
  for await (const raw of splitMbox(source)) {
    const item = await parseEmail(raw, storage, account, mintId());
    const message = item.mailbox.message(item.message);
    const parent = message.inReplyTo;
    const knownThread = parent === undefined ? undefined : threads.get(parent);
    if (knownThread !== undefined) {
      item.thread = knownThread;
      message.partOfThread = knownThread;
    }
    threads.set(item.message, item.thread);
    yield item;
  }
}
/** Sequential conditional writes. On failure, callers reload; no multi-document atomicity is implied. */
export async function persistImportedMail(store: MailStore, item: ImportedMail): Promise<void> {
  const message = item.mailbox.message(item.message);
  for (const a of item.attachments) await store.write(a.url, a.content, a.contentType, null, false);
  await store.write(
    String(message.encoding),
    new Blob([item.raw as Uint8Array<ArrayBuffer>]),
    "message/rfc822",
    null,
    false,
  );
  await store.save({
    mailbox: item.mailbox,
    url: item.message.split("#")[0] as string,
    etag: null,
    exists: false,
  });
  const threadDoc = await store.load(item.thread.split("#")[0] as string, true);
  const thread = threadDoc.mailbox.createThread(item.thread);
  if (thread.title === undefined) thread.title = message.subjectLine;
  thread.addMessage(item.message);
  await store.save(threadDoc);
  for (const folder of item.folders) {
    const loaded = await store.load(folder.iri.split("#")[0] as string, true);
    const wrapper = loaded.mailbox.createFolder(folder.iri);
    wrapper.title = folder.title;
    wrapper.addMessage(item.message);
    await store.save(loaded);
  }
}
