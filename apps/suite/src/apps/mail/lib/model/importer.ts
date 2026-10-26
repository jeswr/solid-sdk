// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import PostalMime, { type Address, decodeWords } from "postal-mime";
import { Attachment } from "./attachment.js";
import { htmlToText } from "./htmlText.js";
import type { MailStore } from "./io.js";
import { MailboxDataset } from "./mailbox.js";
import { attachmentUrl, mailDocument, mailRoot, systemFolderDocument } from "./paths.js";
import { SCHEMA } from "./vocab.js";

/** One message at a time; the enclosing mailbox is never buffered. Input is RFC 4155 mboxrd. */
export async function* splitMbox(
  source: AsyncIterable<Uint8Array>,
  maxMessageBytes = 25 * 1024 * 1024,
): AsyncGenerator<Uint8Array> {
  if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 1)
    throw new TypeError("Invalid message limit");
  // At most one block per 64 KiB, rather than one allocation per source line.
  let blocks: Uint8Array[] = [];
  let block = new Uint8Array(0);
  let used = 0;
  let size = 0;
  let started = false;
  let mode: "prefix" | "content" | "separator" = "prefix";
  const marker = [70, 114, 111, 109, 32]; // From (including its trailing space)
  let matched = 0;
  let quotes = 0;
  function append(byte: number, count = 1): void {
    if (size + count > maxMessageBytes) throw new RangeError("Mail message exceeds import limit");
    while (count > 0) {
      if (used === block.length) {
        block = new Uint8Array(Math.min(64 * 1024, maxMessageBytes - size));
        blocks.push(block);
        used = 0;
      }
      const length = Math.min(count, block.length - used);
      block.fill(byte, used, used + length);
      used += length;
      size += length;
      count -= length;
    }
  }
  function flushPrefix(unquote: boolean): void {
    append(62, quotes - (unquote ? 1 : 0));
    for (const byte of marker.slice(0, matched)) append(byte);
    quotes = 0;
    matched = 0;
  }
  function bytes(): Uint8Array {
    const out = new Uint8Array(size);
    let offset = 0;
    for (const block of blocks) {
      out.set(block.subarray(0, Math.min(block.length, size - offset)), offset);
      offset += block.length;
    }
    return out;
  }
  for await (const chunk of source) {
    for (const byte of chunk) {
      if (mode === "separator") {
        if (byte === 10) mode = "prefix";
      } else if (mode === "content") {
        append(byte);
        if (byte === 10) mode = "prefix";
      } else if (matched === 0 && byte === 62) {
        if (!started) throw new TypeError("Expected mbox From separator");
        quotes++;
        // One quote may be removed once the complete From marker is known.
        if (size + quotes - 1 > maxMessageBytes)
          throw new RangeError("Mail message exceeds import limit");
      } else if (byte === marker[matched]) {
        matched++;
        if (quotes && size + quotes - 1 + matched > maxMessageBytes)
          throw new RangeError("Mail message exceeds import limit");
        if (matched === marker.length) {
          if (quotes) {
            flushPrefix(true);
            mode = "content";
          } else {
            if (started && size) yield bytes();
            started = true;
            blocks = [];
            block = new Uint8Array(0);
            used = 0;
            size = 0;
            matched = 0;
            mode = "separator";
          }
        }
      } else {
        if (!started) throw new TypeError("Expected mbox From separator");
        flushPrefix(false);
        append(byte);
        mode = byte === 10 ? "prefix" : "content";
      }
    }
  }
  if (quotes || matched) {
    if (!started) throw new TypeError("Expected mbox From separator");
    flushPrefix(false);
  }
  if (size) yield bytes();
}

export interface ImportedMail {
  mailbox: MailboxDataset;
  id: string;
  message: string;
  thread: string;
  references: string[];
  /** Provisional thread documents to reconcile when this item is persisted. */
  mergedThreads?: string[];
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
  message.bodyHtml = email.html;
  message.body = email.text ?? (email.html === undefined ? undefined : htmlToText(email.html));
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
    iri: `${
      ["Inbox", "Sent", "Drafts", "Trash", "Archive", "Starred"].includes(title)
        ? systemFolderDocument(root, title.toLowerCase())
        : mailDocument(root, "folders", title)
    }#it`,
  }));
  for (const folder of folders) message.folderIris.add(folder.iri);
  const attachments = email.attachments.map((a, index) => ({
    url: attachmentUrl(storage, account, id, index),
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
    references: references.map((id) => `${mailDocument(root, "messages", id)}#it`),
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
    if (item.references.length > 0) {
      // References supplies the root even when an earlier reply had incomplete ancestry.
      const ancestors = parent === undefined ? item.references : [...item.references, parent];
      const merged = new Set<string>();
      for (const ancestor of ancestors) {
        const previous = threads.get(ancestor);
        if (previous !== undefined && previous !== item.thread) merged.add(previous);
      }
      if (merged.size > 0)
        for (const [iri, thread] of threads) if (merged.has(thread)) threads.set(iri, item.thread);
      item.mergedThreads = [...merged];
      for (const ancestor of ancestors) threads.set(ancestor, item.thread);
    } else {
      const knownThread =
        threads.get(item.message) ?? (parent === undefined ? undefined : threads.get(parent));
      if (knownThread !== undefined) item.thread = knownThread;
    }
    message.partOfThread = item.thread;
    if (parent !== undefined) threads.set(parent, item.thread);
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
  const mergedDocuments = [];
  for (const previous of item.mergedThreads ?? []) {
    const loaded = await store.load(previous.split("#")[0] as string, true);
    if (!loaded.exists) continue;
    const oldThread = loaded.mailbox.thread(previous);
    for (const iri of [...oldThread.messageIris]) {
      const member = await store.load(iri.split("#")[0] as string);
      member.mailbox.message(iri).partOfThread = item.thread;
      await store.save(member);
      thread.addMessage(iri);
      oldThread.removeMessage(iri);
    }
    mergedDocuments.push(loaded);
  }
  await store.save(threadDoc);
  for (const loaded of mergedDocuments) await store.save(loaded);
  for (const folder of item.folders) {
    const loaded = await store.load(folder.iri.split("#")[0] as string, true);
    const wrapper = loaded.mailbox.createFolder(folder.iri);
    wrapper.title = folder.title;
    wrapper.addMessage(item.message);
    await store.save(loaded);
  }
}
