// AUTHORED-BY Claude Opus 5.5
/**
 * Gmail → Mail (CON-07). Full sync lists every message and stores its raw RFC 822 source
 * through the shared MailWriter (pod-mail layout, `.eml` beside each message). The cursor
 * is the mailbox `historyId`; later runs replay `users.history.list` (added, deleted and
 * relabelled messages). An expired history id (404) falls back to a full sync, which also
 * removes stored messages Gmail no longer lists (tracked in `gmail-index.ttl`).
 */
import { Container } from "@solid/object";
import { DataFactory, Store } from "n3";
import { createGoogleOAuthConfig, GOOGLE_SCOPES } from "../adapters/google/oauth.js";
import { IntegrationSyncError } from "../core/errors.js";
import { getJson } from "../core/fixture-fetch.js";
import { Provenance } from "../core/provenance.js";
import type { ImportContext, ImportOutcome, IntegrationAdapter } from "../core/types.js";
import { PodThing } from "../core/vocab.js";
import { accountRoot, messageIdOf, SYSTEM_FOLDERS } from "../mail/paths.js";
import { MAIL_CLASSES, MailMessage, MailSourceIndex } from "../mail/vocab.js";
import {
  createMailWriter,
  type MailFolder,
  MailParseError,
  type MailWriter,
  type StoredMail,
} from "../mail/writer.js";
import {
  GMAIL_API,
  GMAIL_FIXTURES,
  type GmailHistoryList,
  type GmailLabelList,
  type GmailMessage,
  type GmailMessageList,
  type GmailProfile,
} from "./fixtures.js";

const ID = "gmail";
/** Gmail's own per-message cap; larger raw payloads are skipped, never buffered. */
export const MAX_RAW_BYTES = 36 * 1024 * 1024;

/** System labels with a pod-mail folder; other system labels (categories, IMPORTANT) are dropped. */
const SYSTEM_LABELS: Readonly<Record<string, string>> = {
  INBOX: "Inbox",
  SENT: "Sent",
  DRAFT: "Drafts",
  TRASH: "Trash",
  STARRED: "Starred",
};

export const gmailAdapter: IntegrationAdapter = {
  metadata: {
    id: ID,
    name: "Gmail",
    tier: "B",
    authKind: "oauth-pkce",
    scopes: GOOGLE_SCOPES.gmail,
    categories: ["mail"],
    whatYouGet:
      "Your email, with labels as folders and the original messages kept, saved into Mail.",
    requirements: [
      "Google OAuth verification: gmail.readonly is a restricted scope, so only test users can connect until Google verifies the app (including its security assessment).",
      "Browser hosts inject a Web OAuth client id and token proxy URL (TOKEN_PROXY); register their OAuth callback URI.",
      "Node hosts inject a Desktop OAuth client configuration and use loopback PKCE.",
    ],
  },
  oauth: createGoogleOAuthConfig("gmail"),
  fixtures: () => GMAIL_FIXTURES,

  async import(ctx: ImportContext): Promise<ImportOutcome> {
    ctx.progress({ label: "Connecting to your mailbox…", done: 0 });
    const profile = await getJson<GmailProfile>(ID, ctx.api, `${GMAIL_API}/profile`);
    if (typeof profile?.emailAddress !== "string" || typeof profile.historyId !== "string")
      throw new IntegrationSyncError(ID, "Gmail returned an incomplete mailbox profile.");
    const account = profile.emailAddress;
    const labels = await labelFolders(ctx);
    const mail = createMailWriter(ctx, account);
    const index = await SourceIndex.load(ctx, account);
    const sync = new Sync(ctx, mail, labels, index, account);

    let cursor: string | undefined;
    if (ctx.cursor) {
      try {
        cursor = await sync.history(ctx.cursor);
      } catch (error) {
        // History ids expire (about a week); only a 404 means "start again".
        if (!(error instanceof IntegrationSyncError) || error.status !== 404) throw error;
      }
    }
    // The profile historyId is read before listing, so changes during the list replay next time.
    if (cursor === undefined) {
      await sync.full();
      cursor = profile.historyId;
    }
    ctx.progress({ label: "Updating folders and conversations…", done: sync.done });
    const known = new Map<string, MailFolder>();
    for (const key of SYSTEM_FOLDERS) known.set(key, { key, title: key });
    for (const folder of labels.values()) known.set(folder.key, folder);
    await mail.flush([...known.values()]);
    await index.save();
    ctx.progress({ label: "Done", done: sync.done, total: sync.done });
    return { cursor, skipped: sync.skipped || undefined };
  },
};

/** Label id → folder. System folders are keyed by name, user labels by their stable id. */
async function labelFolders(ctx: ImportContext): Promise<Map<string, MailFolder>> {
  const list = await getJson<GmailLabelList>(ID, ctx.api, `${GMAIL_API}/labels`);
  const folders = new Map<string, MailFolder>();
  for (const label of list?.labels ?? []) {
    if (!label || !validId(label.id)) continue;
    const system = SYSTEM_LABELS[label.id];
    if (system) folders.set(label.id, { key: system, title: system });
    else if (label.type === "user" && typeof label.name === "string" && label.name.trim())
      folders.set(label.id, { key: label.id, title: label.name });
  }
  return folders;
}

const WEB_URL = "https://mail.google.com/mail/#all/";
const webUrl = (id: string) => `${WEB_URL}${encodeURIComponent(id)}`;
const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[0-9a-zA-Z_-]+$/.test(id);

interface Indexed {
  readonly slug: string;
  readonly thread?: string;
}

const INCOMPLETE = "incomplete";

/**
 * Which pod document holds each Gmail message (keyed by its Gmail web URL). Deletions and
 * full-sync sweeps need it because document ids come from untrusted Message-ID headers.
 * Before a run first changes the mailbox the index is marked incomplete; a later run that
 * finds the mark recovers mappings for messages written after the last successful save.
 */
class SourceIndex {
  private dirty = false;
  private marked = false;
  private constructor(
    private readonly ctx: ImportContext,
    private readonly account: string,
    readonly entries: Map<string, Indexed>,
  ) {}

  private get slug(): string {
    return `${accountRoot(this.account)}gmail-index.ttl`;
  }

  static async load(ctx: ImportContext, account: string): Promise<SourceIndex> {
    const index = new SourceIndex(ctx, account, new Map());
    const dataset = await ctx.read(index.slug);
    if (!dataset) return index;
    const list = new MailSourceIndex(`${ctx.resolve(index.slug)}#it`, dataset, DataFactory);
    for (const iri of list.members) {
      const source = new PodThing(iri, dataset, DataFactory).sourceUrl;
      const slug = index.slugOf(iri);
      if (source && slug)
        index.entries.set(source, {
          slug,
          thread: new MailMessage(iri, dataset, DataFactory).partOfThread,
        });
    }
    if (list.status === INCOMPLETE) await index.recover();
    return index;
  }

  /** Message document slug for an IRI inside this account's messages container. */
  private slugOf(iri: string): string | undefined {
    const doc = iri.split("#", 1)[0] as string;
    const messages = this.ctx.resolve(`${accountRoot(this.account)}messages/`);
    const name = doc.slice(messages.length);
    return doc.startsWith(messages) && /^[^/]+\.ttl$/.test(name)
      ? `${accountRoot(this.account)}messages/${name}`
      : undefined;
  }

  /** After an interrupted run, map stored messages the index does not know yet. */
  private async recover(): Promise<void> {
    const container = `${accountRoot(this.account)}messages/`;
    const listing = await this.ctx.read(container);
    if (!listing) return;
    const known = new Set([...this.entries.values()].map((entry) => entry.slug));
    for (const child of new Container(this.ctx.resolve(container), listing, DataFactory).contains) {
      const slug = this.slugOf(child.value);
      if (!slug || known.has(slug)) continue;
      const dataset = await this.ctx.read(slug);
      if (!dataset) continue;
      const iri = `${this.ctx.resolve(slug)}#it`;
      const thread = new MailMessage(iri, dataset, DataFactory).partOfThread;
      // A source keeps the document it was indexed with; documents are never re-keyed.
      for (const source of new Provenance(iri, dataset, DataFactory).derivedFrom)
        if (source.startsWith(WEB_URL) && !this.entries.has(source))
          this.set(source, { slug, thread });
    }
    this.marked = true;
  }

  /** Call before the first mailbox change of a run. */
  async begin(): Promise<void> {
    if (this.marked) return;
    await this.write(INCOMPLETE);
    this.marked = true;
  }

  set(source: string, entry: Indexed): void {
    const current = this.entries.get(source);
    if (current?.slug === entry.slug && current.thread === entry.thread) return;
    this.entries.set(source, entry);
    this.dirty = true;
  }

  delete(source: string): void {
    if (this.entries.delete(source)) this.dirty = true;
  }

  async save(): Promise<void> {
    if (!this.dirty && !this.marked) return;
    await this.write(undefined);
    this.dirty = this.marked = false;
  }

  private async write(status: string | undefined): Promise<void> {
    const dataset = new Store();
    const list = new MailSourceIndex(`${this.ctx.resolve(this.slug)}#it`, dataset, DataFactory);
    list.types.add(MAIL_CLASSES.Folder);
    list.title = "Gmail message index";
    list.status = status;
    for (const [source, { slug, thread }] of this.entries) {
      const iri = `${this.ctx.resolve(slug)}#it`;
      list.members.add(iri);
      new PodThing(iri, dataset, DataFactory).sourceUrl = source;
      new MailMessage(iri, dataset, DataFactory).partOfThread = thread;
    }
    await this.ctx.write({
      slug: this.slug,
      category: "mail",
      forClass: MAIL_CLASSES.Folder,
      dataset,
      skipRegistration: true,
    });
  }
}

class Sync {
  done = 0;
  skipped = 0;
  private readonly seen = new Set<string>();
  constructor(
    private readonly ctx: ImportContext,
    private readonly mail: MailWriter,
    private readonly labels: ReadonlyMap<string, MailFolder>,
    private readonly index: SourceIndex,
    private readonly account: string,
  ) {}

  /** Lists every message (Spam and Trash included) and removes stored ones no longer listed. */
  async full(): Promise<void> {
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ maxResults: "100", includeSpamTrash: "true" });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await getJson<GmailMessageList>(
        ID,
        this.ctx.api,
        `${GMAIL_API}/messages?${params}`,
      );
      for (const ref of page?.messages ?? []) await this.store(ref?.id);
      pageToken = page?.nextPageToken || undefined;
    } while (pageToken);
    for (const [source, entry] of [...this.index.entries])
      if (!this.seen.has(source)) await this.drop(source, entry);
  }

  /** Replays history pages from `start`; returns the mailbox historyId to persist. */
  async history(start: string): Promise<string> {
    const changed = new Set<string>();
    const deleted = new Set<string>();
    let pageToken: string | undefined;
    let latest = start;
    do {
      const params = new URLSearchParams({ startHistoryId: start });
      for (const type of ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"])
        params.append("historyTypes", type);
      if (pageToken) params.set("pageToken", pageToken);
      const page = await getJson<GmailHistoryList>(
        ID,
        this.ctx.api,
        `${GMAIL_API}/history?${params}`,
      );
      for (const record of page?.history ?? []) {
        for (const { message } of record?.messagesDeleted ?? []) {
          if (!validId(message?.id)) continue;
          changed.delete(message.id);
          deleted.add(message.id);
        }
        for (const group of [record?.messagesAdded, record?.labelsAdded, record?.labelsRemoved])
          for (const { message } of group ?? [])
            if (validId(message?.id) && !deleted.has(message.id)) changed.add(message.id);
      }
      if (typeof page?.historyId === "string") latest = page.historyId;
      pageToken = page?.nextPageToken || undefined;
    } while (pageToken);
    for (const id of deleted) await this.remove(id);
    for (const id of changed) await this.store(id);
    return latest;
  }

  private async store(id: unknown): Promise<void> {
    if (!validId(id)) {
      this.skipped++;
      return;
    }
    let message: GmailMessage;
    try {
      message = await getJson<GmailMessage>(
        ID,
        this.ctx.api,
        `${GMAIL_API}/messages/${id}?format=raw`,
      );
    } catch (error) {
      // Deleted between listing and fetching: a deletion, not a failure.
      if (error instanceof IntegrationSyncError && error.status === 404) return this.remove(id);
      throw error;
    }
    const labelIds = Array.isArray(message?.labelIds) ? message.labelIds : [];
    if (labelIds.includes("SPAM")) return this.remove(id);
    const source = webUrl(id);
    // Anything kept from here on is not swept by a full sync, even if it cannot be re-read.
    this.seen.add(source);
    if (typeof message?.raw !== "string" || message.raw.length > (MAX_RAW_BYTES * 4) / 3 + 4) {
      this.skipped++;
      return;
    }
    const raw = decodeBase64Url(message.raw);
    if (!raw) {
      this.skipped++;
      return;
    }
    const folders = labelIds.flatMap((label) => this.labels.get(label) ?? []);
    if (!labelIds.some((label) => ["INBOX", "SENT", "DRAFT", "TRASH"].includes(label)))
      folders.push({ key: "Archive", title: "Archive" });
    const received = Number(message.internalDate);
    let stored: StoredMail;
    const previous = this.index.entries.get(source);
    await this.index.begin();
    try {
      stored = await this.mail.add({
        raw,
        folders,
        read: !labelIds.includes("UNREAD"),
        threadKey: validId(message.threadId) ? `gmail-${message.threadId}` : undefined,
        fallbackId: `gmail-${id}`,
        documentId: previous && messageIdOf(this.account, previous.slug),
        sourceUrl: source,
        receivedAt: Number.isFinite(received) && received > 0 ? new Date(received) : undefined,
      });
    } catch (error) {
      // One malformed message must not block the mailbox.
      if (!(error instanceof MailParseError)) throw error;
      this.skipped++;
      return;
    }
    this.index.set(source, { slug: stored.slug, thread: stored.thread });
    this.done++;
    if (this.done % 25 === 0)
      this.ctx.progress({ label: `Saved ${this.done} messages…`, done: this.done });
  }

  private async remove(id: string): Promise<void> {
    const source = webUrl(id);
    const entry = this.index.entries.get(source);
    if (entry) await this.drop(source, entry);
  }

  private async drop(source: string, entry: Indexed): Promise<void> {
    await this.index.begin();
    // A stale entry (its run failed before the index was saved) may name a document that
    // another Gmail message now owns: only the owner's document is removed.
    const stored = await this.ctx.read(entry.slug);
    const iri = `${this.ctx.resolve(entry.slug)}#it`;
    if (!stored || new Provenance(iri, stored, DataFactory).derivedFrom.has(source))
      await this.mail.removeMessage(entry.slug, entry.thread);
    this.index.delete(source);
  }
}

/** Strict base64url (Gmail `raw`); undefined for malformed input. */
function decodeBase64Url(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(value)) return undefined;
  try {
    return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
      c.charCodeAt(0),
    );
  } catch {
    return undefined;
  }
}
