// AUTHORED-BY Claude Opus 5.5
/**
 * Shared MailWriter: stores raw RFC 822 messages in the pod-mail layout (apps MAI-01)
 * through the connector ports. Used by the Gmail API importer (CON-07) and the Takeout
 * mbox path (CON-08). Message documents are written as they arrive; thread and folder
 * membership is accumulated and written once by `flush()`, so a large mailbox does not
 * rewrite its Inbox document per message.
 */
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import type { ImportContext } from "../core/types.js";
import { htmlToText } from "./html-text.js";
import { parseMail } from "./parse.js";
import {
  accountRoot,
  attachmentSlug,
  emlSlug,
  folderSlug,
  messageSlug,
  SYSTEM_FOLDERS,
  threadSlug,
} from "./paths.js";
import { MAIL_CLASSES, MailAttachment, MailCollection, MailMessage } from "./vocab.js";

/** The connector ports the writer needs (API and file imports both provide them). */
export type MailPorts = Pick<
  ImportContext,
  "resolve" | "read" | "write" | "writeBinary" | "remove"
>;

export interface MailItem {
  /** RFC 822 source bytes. */
  readonly raw: Uint8Array;
  /** Folder titles; system names (`Inbox`, `Sent`, …) map to the reserved system folders. */
  readonly folders: readonly string[];
  readonly read: boolean;
  /** Source-native thread key; defaults to the MAI-01 References/In-Reply-To root. */
  readonly threadKey?: string;
  /** Document id when the message has no usable Message-ID. */
  readonly fallbackId: string;
  /** Source item URL recorded as provenance (`prov:wasDerivedFrom`). */
  readonly sourceUrl?: string;
  readonly receivedAt?: Date;
}

export interface MailWriter {
  /** Store one message and return its document slug. */
  add(item: MailItem): Promise<string>;
  /** Delete a stored message, its source and attachments, and drop its memberships. */
  removeMessage(slug: string): Promise<void>;
  /** Message slugs recorded on a thread (pending changes included). */
  threadMessages(threadKey: string): Promise<string[]>;
  /** Write every touched thread and folder document. */
  flush(): Promise<void>;
}

/** RDF and malformed MIME types from untrusted mail are stored as opaque bytes. */
function binaryType(contentType: string): string {
  const type = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const rdf = /^(text\/(turtle|n3)|application\/(ld\+json|n-triples|n-quads|trig|rdf\+xml))$/;
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(type) && !rdf.test(type)
    ? type
    : "application/octet-stream";
}

interface Pending {
  readonly kind: "thread" | "folder";
  title?: string;
  readonly add: Set<string>;
  readonly drop: Set<string>;
}

const docOf = (iri: string) => iri.split("#", 1)[0] as string;

export function createMailWriter(ctx: MailPorts, account: string): MailWriter {
  const root = accountRoot(account);
  const pending = new Map<string, Pending>();
  const base = ctx.resolve("mail/").slice(0, -"mail/".length);
  const slugOf = (url: string) => {
    if (!url.startsWith(base)) throw new TypeError("Mail document outside the connector");
    return url.slice(base.length);
  };
  const touch = (slug: string, kind: Pending["kind"]): Pending => {
    let entry = pending.get(slug);
    if (!entry) {
      entry = { kind, add: new Set(), drop: new Set() };
      pending.set(slug, entry);
    }
    return entry;
  };
  const member = (slug: string, kind: Pending["kind"], message: string, keep: boolean) => {
    const entry = touch(slug, kind);
    (keep ? entry.add : entry.drop).add(message);
    (keep ? entry.drop : entry.add).delete(message);
    return entry;
  };
  const existing = async (slug: string) => {
    const dataset = await ctx.read(slug);
    return dataset && new MailMessage(`${ctx.resolve(slug)}#it`, dataset, DataFactory);
  };

  async function add(item: MailItem): Promise<string> {
    const mail = await parseMail(item.raw);
    const id = mail.messageId ?? item.fallbackId;
    const slug = messageSlug(account, id);
    const iri = `${ctx.resolve(slug)}#it`;
    const previous = await existing(slug);

    const eml = await ctx.writeBinary({
      slug: emlSlug(account, id),
      contentType: "message/rfc822",
      body: item.raw,
    });
    const dataset = new Store();
    const message = new MailMessage(iri, dataset, DataFactory);
    message.types.add(MAIL_CLASSES.EmailMessage);
    message.identifier = id;
    message.subjectLine = mail.subject;
    message.bodyHtml = mail.html;
    message.body = mail.text ?? (mail.html === undefined ? undefined : htmlToText(mail.html));
    message.sender = mail.from;
    for (const to of mail.to) message.to.add(to);
    for (const cc of mail.cc) message.cc.add(cc);
    for (const bcc of mail.bcc) message.bcc.add(bcc);
    message.dateSent = mail.date;
    message.dateReceived = item.receivedAt;
    // Keep the first read time across re-imports; the read flag is the presence of dateRead.
    message.dateRead = item.read
      ? (previous?.dateRead ?? mail.date ?? item.receivedAt ?? new Date(0))
      : undefined;
    message.encoding = eml.url;
    if (mail.inReplyTo)
      message.inReplyTo = `${ctx.resolve(messageSlug(account, mail.inReplyTo))}#it`;
    const thread = threadSlug(account, item.threadKey ?? mail.inReplyTo ?? id);
    message.partOfThread = `${ctx.resolve(thread)}#it`;
    for (const [index, part] of mail.attachments.entries()) {
      const stored = await ctx.writeBinary({
        slug: attachmentSlug(account, id, index),
        contentType: binaryType(part.contentType),
        body: part.content,
      });
      message.attachments.add(stored.url);
      const metadata = new MailAttachment(stored.url, dataset, DataFactory);
      metadata.types.add(MAIL_CLASSES.MediaObject);
      metadata.name = part.name;
      metadata.contentType = part.contentType;
    }
    const folders = new Set(item.folders.map((title) => folderSlug(account, title)));
    for (const title of item.folders) {
      const folder = folderSlug(account, title);
      message.folderIris.add(`${ctx.resolve(folder)}#it`);
      member(folder, "folder", iri, true).title = title;
    }
    // Memberships the source no longer reports are dropped (archive, label removal, thread move).
    for (const old of previous?.folderIris ?? []) {
      const oldSlug = slugOf(docOf(old));
      if (!folders.has(oldSlug)) member(oldSlug, "folder", iri, false);
    }
    const oldThread = previous?.partOfThread;
    if (oldThread && docOf(oldThread) !== ctx.resolve(thread))
      member(slugOf(docOf(oldThread)), "thread", iri, false);
    const threadEntry = member(thread, "thread", iri, true);
    threadEntry.title ??= mail.subject;

    await ctx.write({
      slug,
      category: "mail",
      forClass: MAIL_CLASSES.EmailMessage,
      dataset,
      sourceUrl: item.sourceUrl,
      registrationContainer: root,
    });
    return slug;
  }

  async function removeMessage(slug: string): Promise<void> {
    const previous = await existing(slug);
    if (!previous) return;
    const iri = previous.value;
    for (const folder of previous.folderIris) member(slugOf(docOf(folder)), "folder", iri, false);
    if (previous.partOfThread) member(slugOf(docOf(previous.partOfThread)), "thread", iri, false);
    for (const attachment of previous.attachments) await ctx.remove(slugOf(attachment));
    if (previous.encoding) await ctx.remove(slugOf(previous.encoding));
    await ctx.remove(slug);
  }

  async function threadMessages(threadKey: string): Promise<string[]> {
    const slug = threadSlug(account, threadKey);
    const dataset = await ctx.read(slug);
    const members = new Set(
      dataset ? new MailCollection(`${ctx.resolve(slug)}#it`, dataset, DataFactory).members : [],
    );
    const entry = pending.get(slug);
    for (const iri of entry?.add ?? []) members.add(iri);
    for (const iri of entry?.drop ?? []) members.delete(iri);
    return [...members].map((iri) => slugOf(docOf(iri)));
  }

  async function flush(): Promise<void> {
    for (const [slug, entry] of [...pending.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const current: DatasetCore | undefined = await ctx.read(slug);
      const dataset = new Store([...(current ?? [])]);
      const collection = new MailCollection(`${ctx.resolve(slug)}#it`, dataset, DataFactory);
      for (const iri of entry.drop) collection.members.delete(iri);
      for (const iri of entry.add) collection.members.add(iri);
      pending.delete(slug);
      const system = entry.kind === "folder" && slug.includes("/folders/system:");
      if (collection.members.size === 0 && !system) {
        if (current) await ctx.remove(slug);
        continue;
      }
      if (entry.kind === "thread") {
        collection.types.add(MAIL_CLASSES.Conversation);
        collection.types.add(MAIL_CLASSES.SiocThread);
      } else collection.types.add(MAIL_CLASSES.Folder);
      if (collection.title === undefined && entry.title !== undefined)
        collection.title = entry.title;
      await ctx.write({
        slug,
        category: "mail",
        forClass: entry.kind === "thread" ? MAIL_CLASSES.Conversation : MAIL_CLASSES.Folder,
        dataset,
        skipRegistration: true,
      });
    }
  }

  return { add, removeMessage, threadMessages, flush };
}

export { SYSTEM_FOLDERS };
