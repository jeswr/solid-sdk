// AUTHORED-BY Claude Opus 5.5
/**
 * Shared MailWriter: stores raw RFC 822 messages in the pod-mail layout (apps MAI-01)
 * through the connector ports. Used by the Gmail API importer (CON-07) and the Takeout
 * mbox path (CON-08). Message documents are written as they arrive; thread and folder
 * membership is reconciled once by `flush()`, so a large mailbox does not rewrite its
 * Inbox document per message.
 *
 * Replay safety: a run that fails after writing messages but before `flush()` keeps its
 * source cursor, so the next run replays the same changes. Membership is therefore
 * reconciled from each touched message's desired state against every known folder
 * (never from the message's previous document), and thread members whose message
 * documents no longer exist are dropped.
 */
import { DataFactory, Store } from "n3";
import { Provenance } from "../core/provenance.js";
import type { ImportContext } from "../core/types.js";
import { htmlToText } from "./html-text.js";
import { parseMail } from "./parse.js";
import {
  accountRoot,
  attachmentSlug,
  emlSlug,
  folderSlug,
  messageSlug,
  threadSlug,
} from "./paths.js";
import { MAIL_CLASSES, MailAttachment, MailCollection, MailMessage } from "./vocab.js";

export { MailParseError } from "./parse.js";

/** The connector ports the writer needs (API and file imports both provide them). */
export type MailPorts = Pick<
  ImportContext,
  "resolve" | "read" | "write" | "writeBinary" | "remove"
>;

/**
 * A folder: `key` names its document (a system folder name such as `Inbox`, a source label
 * id, or a label name), `title` is its display name and may change between runs.
 */
export interface MailFolder {
  readonly key: string;
  readonly title: string;
}

export interface MailItem {
  /** RFC 822 source bytes. */
  readonly raw: Uint8Array;
  readonly folders: readonly MailFolder[];
  readonly read: boolean;
  /** Source-native thread key; defaults to the MAI-01 References/In-Reply-To root. */
  readonly threadKey?: string;
  /** Document id when the message has no usable Message-ID, or another source item owns it. */
  readonly fallbackId: string;
  /** Source item URL recorded as provenance (`prov:wasDerivedFrom`); identifies the item. */
  readonly sourceUrl?: string;
  readonly receivedAt?: Date;
}

export interface StoredMail {
  readonly slug: string;
  /** Message subject IRI. */
  readonly iri: string;
  /** Thread subject IRI. */
  readonly thread: string;
}

export interface MailWriter {
  /** Store one message. Throws `MailParseError` for unparseable input (skip it). */
  add(item: MailItem): Promise<StoredMail>;
  /**
   * Delete a stored message, its source and attachments, and drop its memberships. When the
   * document is already gone (a replayed deletion), `thread` lets the membership still be dropped.
   */
  removeMessage(slug: string, thread?: string): Promise<void>;
  /** Reconcile touched messages against `folders` (all folders the source knows) and write. */
  flush(folders?: readonly MailFolder[]): Promise<void>;
}

/** RDF and malformed MIME types from untrusted mail are stored as opaque bytes. */
export function binaryType(contentType: string): string {
  const type = String(contentType.split(";", 1)[0]).trim().toLowerCase();
  const rdf = /^(text\/(turtle|n3)|application\/(ld\+json|n-triples|n-quads|trig|rdf\+xml))$/;
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(type) && !rdf.test(type)
    ? type
    : "application/octet-stream";
}

const docOf = (iri: string) => iri.split("#", 1)[0] as string;

export function createMailWriter(ctx: MailPorts, account: string): MailWriter {
  const root = accountRoot(account);
  const base = ctx.resolve("mail/").slice(0, -"mail/".length);
  const slugOf = (url: string) => {
    if (!url.startsWith(base)) throw new TypeError("Mail document outside the connector");
    return url.slice(base.length);
  };
  const iriOf = (slug: string) => `${ctx.resolve(slug)}#it`;
  /** Desired folder documents of every message touched this run (empty = in no folder). */
  const desired = new Map<string, Set<string>>();
  /** Folder documents to reconcile, with their current title ("" keeps the stored one). */
  const titles = new Map<string, string>();
  const remember = (slug: string) => {
    if (!titles.has(slug)) titles.set(slug, "");
  };
  /** Thread document slug → members to add / drop, plus the first subject seen. */
  const threads = new Map<string, { add: Set<string>; drop: Set<string>; title?: string }>();
  const thread = (slug: string) => {
    let entry = threads.get(slug);
    if (!entry) {
      entry = { add: new Set(), drop: new Set() };
      threads.set(slug, entry);
    }
    return entry;
  };
  const existing = async (slug: string) => {
    const dataset = await ctx.read(slug);
    return dataset && new MailMessage(iriOf(slug), dataset, DataFactory);
  };

  async function add(item: MailItem): Promise<StoredMail> {
    const mail = await parseMail(item.raw);
    let id = mail.messageId ?? item.fallbackId;
    let previous = await existing(messageSlug(account, id));
    // Message-IDs are untrusted and can repeat: another source item keeps its document.
    if (
      previous &&
      item.sourceUrl !== undefined &&
      !new Provenance(previous.value, previous.dataset, DataFactory).derivedFrom.has(item.sourceUrl)
    ) {
      id = item.fallbackId;
      previous = await existing(messageSlug(account, id));
    }
    const slug = messageSlug(account, id);
    const iri = iriOf(slug);

    const eml = await ctx.writeBinary({
      slug: emlSlug(account, id),
      contentType: "message/rfc822",
      body: item.raw,
    });
    const dataset = new Store();
    const message = new MailMessage(iri, dataset, DataFactory);
    message.types.add(MAIL_CLASSES.EmailMessage);
    message.identifier = mail.messageId ?? id;
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
    if (mail.inReplyTo) message.inReplyTo = iriOf(messageSlug(account, mail.inReplyTo));
    const threadDoc = threadSlug(
      account,
      item.threadKey ?? mail.references[0] ?? mail.inReplyTo ?? id,
    );
    message.partOfThread = iriOf(threadDoc);
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
    const folders = new Set<string>();
    for (const { key, title } of item.folders) {
      const folder = folderSlug(account, key);
      folders.add(folder);
      titles.set(folder, title);
      message.folderIris.add(iriOf(folder));
    }
    desired.set(iri, folders);
    // Folders named on the previous version are reconciled too, even if no longer known.
    for (const old of previous?.folderIris ?? []) remember(slugOf(docOf(old)));
    const oldThread = previous?.partOfThread;
    if (oldThread && docOf(oldThread) !== ctx.resolve(threadDoc)) {
      const entry = thread(slugOf(docOf(oldThread)));
      entry.drop.add(iri);
      entry.add.delete(iri);
    }
    const entry = thread(threadDoc);
    entry.add.add(iri);
    entry.drop.delete(iri);
    entry.title ??= mail.subject;

    await ctx.write({
      slug,
      category: "mail",
      forClass: MAIL_CLASSES.EmailMessage,
      dataset,
      sourceUrl: item.sourceUrl,
      registrationContainer: root,
    });
    return { slug, iri, thread: iriOf(threadDoc) };
  }

  async function removeMessage(slug: string, threadIri?: string): Promise<void> {
    const iri = iriOf(slug);
    const previous = await existing(slug);
    desired.set(iri, new Set());
    for (const folder of previous?.folderIris ?? []) remember(slugOf(docOf(folder)));
    const memberOf = previous?.partOfThread ?? threadIri;
    if (memberOf) {
      const entry = thread(slugOf(docOf(memberOf)));
      entry.drop.add(iri);
      entry.add.delete(iri);
    }
    if (!previous) return;
    for (const attachment of previous.attachments) await ctx.remove(slugOf(attachment));
    if (previous.encoding) await ctx.remove(slugOf(previous.encoding));
    await ctx.remove(slug);
  }

  async function flush(known: readonly MailFolder[] = []): Promise<void> {
    for (const { key, title } of known) {
      const slug = folderSlug(account, key);
      if (title || !titles.has(slug)) titles.set(slug, title);
    }
    for (const [slug, title] of [...titles.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const current = await ctx.read(slug);
      const dataset = new Store([...(current ?? [])]);
      const folder = new MailCollection(iriOf(slug), dataset, DataFactory);
      let changed = !current;
      for (const [iri, folders] of desired) {
        const want = folders.has(slug);
        if (want !== folder.members.has(iri)) {
          changed = true;
          if (want) folder.members.add(iri);
          else folder.members.delete(iri);
        }
      }
      if (title && folder.title !== title) {
        folder.title = title;
        changed = true;
      }
      const system = slug.includes("/folders/system:");
      if (folder.members.size === 0 && !system) {
        if (current) await ctx.remove(slug);
        continue;
      }
      if (!changed) continue;
      folder.types.add(MAIL_CLASSES.Folder);
      await ctx.write({
        slug,
        category: "mail",
        forClass: MAIL_CLASSES.Folder,
        dataset,
        skipRegistration: true,
      });
    }
    titles.clear();
    for (const [slug, entry] of [...threads.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const current = await ctx.read(slug);
      const dataset = new Store([...(current ?? [])]);
      const collection = new MailCollection(iriOf(slug), dataset, DataFactory);
      for (const iri of entry.drop) collection.members.delete(iri);
      for (const iri of entry.add) collection.members.add(iri);
      // Members left by an interrupted earlier run are dropped once their documents are gone.
      for (const iri of [...collection.members])
        if (!entry.add.has(iri) && !(await ctx.read(slugOf(docOf(iri)))))
          collection.members.delete(iri);
      if (collection.members.size === 0) {
        if (current) await ctx.remove(slug);
        continue;
      }
      collection.types.add(MAIL_CLASSES.Conversation);
      collection.types.add(MAIL_CLASSES.SiocThread);
      if (collection.title === undefined && entry.title !== undefined)
        collection.title = entry.title;
      await ctx.write({
        slug,
        category: "mail",
        forClass: MAIL_CLASSES.Conversation,
        dataset,
        skipRegistration: true,
      });
    }
    threads.clear();
    desired.clear();
  }

  return { add, removeMessage, flush };
}
