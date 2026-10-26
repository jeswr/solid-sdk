// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
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
 * documents no longer exist are dropped. Deletions run in batches of 100 and at flush,
 * committing collection cleanup before bytes and finally RDF, keeping their cleanup
 * inventory available across every interruption.
 */
import { Container } from "@solid/object";
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
  /** Explicit source identity (Gmail), or a previously stored document id. Bypasses Message-ID keying. */
  readonly documentId?: string;
  /** Source item URL recorded as provenance (`prov:wasDerivedFrom`); identifies the item. */
  readonly sourceUrl?: string;
  readonly receivedAt?: Date;
}

export interface StoredMail {
  readonly slug: string;
  /** Document id, for `MailItem.documentId` on later imports of the same item. */
  readonly id: string;
  /** Message subject IRI. */
  readonly iri: string;
  /** Thread subject IRI. */
  readonly thread: string;
}

export interface MailWriter {
  /** Store one message. Throws `MailParseError` for unparseable input (skip it). */
  add(item: MailItem): Promise<StoredMail>;
  /**
   * Queue deletion, processed at 100 messages or in flush(). Each batch drops memberships,
   * then deletes attachments, the source and finally RDF. The RDF retains cleanup inventory
   * until deletion completes; a missing document is a no-op.
   */
  removeMessage(slug: string): Promise<void>;
  /** Process queued deletions, then reconcile touched messages against all known folders. */
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
  const accountDir = accountRoot(account);
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
  const deletions = new Set<string>();
  // Reuse the last batch's collection reads in flush, including an exact multiple of 100.
  // Additions invalidate this snapshot before they can change a collection.
  let deletionSnapshot:
    | { folders: Set<string>; collections: Map<string, Store | undefined> }
    | undefined;
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

  /**
   * Source thread key, else the stored thread of the nearest known ancestor (References root,
   * then In-Reply-To parent), else that ancestor's id (MAI-01), else the message's own id.
   * Ancestors stored only after their replies are not reconciled retroactively.
   */
  async function threadOf(
    key: string | undefined,
    ancestor: string | undefined,
    id: string,
  ): Promise<string> {
    if (key) return threadSlug(account, key);
    if (!ancestor) return threadSlug(account, id);
    const stored = (await existing(messageSlug(account, ancestor)))?.partOfThread;
    const doc = stored && docOf(stored);
    return doc?.startsWith(ctx.resolve(`${accountDir}threads/`)) && doc.endsWith(".ttl")
      ? slugOf(doc)
      : threadSlug(account, ancestor);
  }

  async function add(item: MailItem): Promise<StoredMail> {
    const mail = await parseMail(item.raw);
    let id = item.documentId ?? mail.messageId ?? item.fallbackId;
    let previous = await existing(messageSlug(account, id));
    // Message-IDs are untrusted and can repeat: another source item keeps its document.
    if (
      item.documentId === undefined &&
      previous &&
      item.sourceUrl !== undefined &&
      !new Provenance(previous.value, previous.dataset, DataFactory).derivedFrom.has(item.sourceUrl)
    ) {
      id = item.fallbackId;
      previous = await existing(messageSlug(account, id));
    }
    const slug = messageSlug(account, id);
    const iri = iriOf(slug);
    deletions.delete(slug);
    deletionSnapshot = undefined;

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
    message.encoding = ctx.resolve(emlSlug(account, id));
    if (mail.inReplyTo) message.inReplyTo = iriOf(messageSlug(account, mail.inReplyTo));
    // Without a source key, a stored message keeps its thread (reconciliation is not
    // retroactive), so a replay never strands it in two conversations.
    const kept = previous?.partOfThread && docOf(previous.partOfThread);
    const threadDoc =
      !item.threadKey && kept?.startsWith(ctx.resolve(`${accountDir}threads/`))
        ? slugOf(kept)
        : await threadOf(item.threadKey, mail.references[0] ?? mail.inReplyTo, id);
    message.partOfThread = iriOf(threadDoc);
    const parts = mail.attachments.map((part, index) => ({
      part,
      slug: attachmentSlug(account, id, index),
    }));
    for (const { part, slug: partSlug } of parts) {
      const url = ctx.resolve(partSlug);
      message.attachments.add(url);
      const metadata = new MailAttachment(url, dataset, DataFactory);
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
      const oldSlug = slugOf(docOf(oldThread));
      // Flush scans every stored folder, but only visits known threads. Remove the old
      // membership before replacing its only durable record in the message document.
      await dropMember(oldSlug, iri, MAIL_CLASSES.Conversation);
      const entry = thread(oldSlug);
      entry.drop.add(iri);
      entry.add.delete(iri);
    }
    const entry = thread(threadDoc);
    entry.add.add(iri);
    entry.drop.delete(iri);
    entry.title ??= mail.subject;

    // Retire attachments while the previous document still records them, so a failed delete
    // is retried by the replay instead of being forgotten.
    for (const old of previous?.attachments ?? [])
      if (!message.attachments.has(old)) await ctx.remove(slugOf(old));
    // The message document is committed first with a conditional write (create-only when it
    // did not exist), so it claims the id before any bytes are stored: an overlapping import of
    // another item loses the race with a 412 instead of replacing this item's bytes.
    await ctx.write({
      slug,
      category: "mail",
      forClass: MAIL_CLASSES.EmailMessage,
      dataset,
      sourceUrl: item.sourceUrl,
      registrationContainer: accountDir,
    });
    await ctx.writeBinary({
      slug: emlSlug(account, id),
      contentType: "message/rfc822",
      body: item.raw,
      mode: "replace",
    });
    for (const { part, slug: partSlug } of parts)
      await ctx.writeBinary({
        slug: partSlug,
        contentType: binaryType(part.contentType),
        body: part.content,
        mode: "replace",
      });
    return { slug, iri, thread: iriOf(threadDoc), id };
  }

  /** All stored folders, including labels that disappeared or changed before a failed flush. */
  async function storedFolders(): Promise<Set<string>> {
    const listing = `${accountDir}folders/`;
    const stored = await ctx.read(listing);
    const slugs = new Set<string>();
    if (stored)
      for (const child of new Container(ctx.resolve(listing), stored, DataFactory).contains) {
        const rest = child.value.slice(ctx.resolve(listing).length);
        if (child.value.startsWith(ctx.resolve(listing)) && /^[^/]+\.ttl$/.test(rest))
          slugs.add(`${listing}${rest}`);
      }
    return slugs;
  }

  /** Persist just this removal without flushing pending additions for other messages. */
  async function dropMember(slug: string, iri: string, forClass: string): Promise<void> {
    await dropMembers(slug, new Set([iri]), forClass);
  }

  /** Read and conditionally update a collection just once for the whole deletion batch. */
  async function dropMembers(
    slug: string,
    iris: ReadonlySet<string>,
    forClass: string,
  ): Promise<Store | undefined> {
    const current = await ctx.read(slug);
    if (!current) return undefined;
    const dataset = new Store([...current]);
    const collection = new MailCollection(iriOf(slug), dataset, DataFactory);
    let changed = false;
    for (const iri of iris) if (collection.members.delete(iri)) changed = true;
    if (!changed) return dataset;
    if (collection.members.size === 0 && !slug.includes("/folders/system:")) {
      await ctx.remove(slug);
      return undefined;
    }
    await ctx.write({ slug, category: "mail", forClass, dataset, skipRegistration: true });
    return dataset;
  }

  async function removeMessage(slug: string): Promise<void> {
    deletions.add(slug);
    if (deletions.size >= 100) await deleteBatch();
  }

  async function deleteBatch(): Promise<void> {
    if (deletions.size === 0) return;
    const messages = new Map<string, MailMessage>();
    for (const slug of deletions) {
      const previous = await existing(slug);
      if (previous) messages.set(slug, previous);
    }
    if (messages.size > 0) {
      const iris = new Set([...messages.keys()].map(iriOf));
      const folders = await storedFolders();
      const affectedThreads = new Set<string>();
      for (const previous of messages.values()) {
        if (previous.partOfThread) affectedThreads.add(slugOf(docOf(previous.partOfThread)));
        for (const folder of previous.folderIris) folders.add(slugOf(docOf(folder)));
      }
      const collections = new Map<string, Store | undefined>();
      // Keep every message's inventory until ALL collection writes have succeeded.
      for (const slug of [...affectedThreads].sort())
        collections.set(slug, await dropMembers(slug, iris, MAIL_CLASSES.Conversation));
      for (const folder of [...folders].sort())
        collections.set(folder, await dropMembers(folder, iris, MAIL_CLASSES.Folder));
      for (const [slug, previous] of messages) {
        for (const attachment of previous.attachments) await ctx.remove(slugOf(attachment));
        if (previous.encoding) await ctx.remove(slugOf(previous.encoding));
        await ctx.remove(slug);
      }
      // Deleted additions must not be reintroduced by the subsequent reconciliation.
      for (const iri of iris) desired.delete(iri);
      for (const [slug, entry] of threads) {
        for (const iri of iris) {
          entry.add.delete(iri);
          entry.drop.delete(iri);
        }
        if (entry.add.size === 0 && entry.drop.size === 0) threads.delete(slug);
      }
      deletionSnapshot = { folders, collections };
    }
    deletions.clear();
  }

  async function flush(known: readonly MailFolder[] = []): Promise<void> {
    await deleteBatch();
    const snapshot = deletionSnapshot;
    deletionSnapshot = undefined;
    const readCollection = (slug: string) =>
      snapshot?.collections.has(slug) ? snapshot.collections.get(slug) : ctx.read(slug);
    // Every stored folder is reconciled too: a label deleted at the source may still list a
    // message whose previous version (the only other record of it) was already replaced.
    for (const slug of snapshot?.folders ?? (await storedFolders())) remember(slug);
    for (const { key, title } of known) {
      const slug = folderSlug(account, key);
      if (title || !titles.has(slug)) titles.set(slug, title);
    }
    for (const [slug, title] of [...titles.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const current = await readCollection(slug);
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
      const current = await readCollection(slug);
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
