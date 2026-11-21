// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * Gmail → Mail (CON-07). Full sync lists every message and stores its raw RFC 822 source
 * through the shared MailWriter (pod-mail layout, `.eml` beside each message). The cursor
 * is the mailbox `historyId`; later runs replay `users.history.list` (added, deleted and
 * relabelled messages). An expired history id (404) falls back to a full sync, which also
 * sweeps the messages container for documents Gmail no longer lists.
 */
import { Container } from "@solid/object";
import { DataFactory } from "n3";
import { createGoogleOAuthConfig, GOOGLE_SCOPES } from "../adapters/google/oauth.js";
import { ResponseTooLargeError, RunBudgetExceededError } from "../core/budget.js";
import { IntegrationSyncError } from "../core/errors.js";
import { getJson } from "../core/fixture-fetch.js";
import { SourceTimeoutError } from "../core/source-timeout.js";
import type { ImportContext, ImportOutcome, IntegrationAdapter } from "../core/types.js";
import { accountRoot, messageSlug, SYSTEM_FOLDERS } from "../mail/paths.js";
import { MAIL_CLASSES, MailMessage } from "../mail/vocab.js";
import {
  createMailWriter,
  type MailFolder,
  MailParseError,
  type MailWriter,
} from "../mail/writer.js";
import {
  GMAIL_API,
  GMAIL_FIXTURES,
  type GmailHistoryList,
  type GmailLabelList,
  type GmailMessage,
  type GmailMessageList,
  type GmailProfile,
  type GmailThread,
} from "./fixtures.js";
import { FullSyncJournal } from "./full-sync.js";

const ID = "gmail";
/** Gmail's own per-message cap; larger raw payloads are skipped, never buffered. */
export const MAX_RAW_BYTES = 36 * 1024 * 1024;
/** The `format=raw` JSON answer: base64url of a message at the cap, plus JSON framing. */
const MAX_MESSAGE_JSON_BYTES = Math.ceil((MAX_RAW_BYTES * 4) / 3) + 64 * 1024;

/** System labels with a pod-mail folder; other system labels (categories, IMPORTANT) are dropped. */
export const SYSTEM_LABELS: Readonly<Record<string, string>> = {
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
    const budget = ctx.budget;
    ctx.progress({ label: "Connecting to your mailbox…", done: 0 });
    const profile = await getJson<GmailProfile>(ID, ctx.api, `${GMAIL_API}/profile`, undefined);
    if (typeof profile?.emailAddress !== "string" || typeof profile.historyId !== "string")
      throw new IntegrationSyncError(ID, "Gmail returned an incomplete mailbox profile.");
    budget.items(1);
    const account = profile.emailAddress;
    const labels = await labelFolders(ctx);
    const mail = createMailWriter(ctx, account);
    const sync = new Sync(ctx, mail, labels, account);

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
      cursor = await sync.full(profile.historyId);
    }
    ctx.progress({ label: "Updating folders and conversations…", done: sync.done });
    const known = new Map<string, MailFolder>();
    for (const key of SYSTEM_FOLDERS) known.set(key, { key, title: key });
    for (const folder of labels.values()) known.set(folder.key, folder);
    await sync.finish([...known.values()]);
    ctx.progress({ label: "Done", done: sync.done, total: sync.done });
    // The journal outlives this call: the runner clears it only after reporting the cursor.
    return { cursor, skipped: sync.skipped || undefined, commit: sync.commit };
  },
};

/** Label id → folder. System folders are keyed by name, user labels by their stable id. */
async function labelFolders(ctx: ImportContext): Promise<Map<string, MailFolder>> {
  const list = await getJson<GmailLabelList>(ID, ctx.api, `${GMAIL_API}/labels`, undefined);
  ctx.budget.items(list?.labels?.length ?? 0);
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

const webUrl = (id: string) => `https://mail.google.com/mail/#all/${id}`;
/** Opaque source ids only; cap their length before using them in URLs or document names. */
const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[0-9a-zA-Z_-]{1,256}$/.test(id);

class Sync {
  done = 0;
  skipped = 0;
  private readonly seen = new Set<string>();
  private journal?: FullSyncJournal;
  /** Per-run metadata cache, including threads with no usable Message-ID headers. */
  private readonly parents = new Map<string, ReadonlyMap<string, string>>();
  constructor(
    private readonly ctx: ImportContext,
    private readonly mail: MailWriter,
    private readonly labels: ReadonlyMap<string, MailFolder>,
    private readonly account: string,
  ) {}

  /** Lists every message (Spam and Trash included) and removes stored ones no longer listed. */
  async full(historyId: string): Promise<string> {
    const journal = await FullSyncJournal.load(this.ctx, accountRoot(this.account), historyId);
    this.journal = journal;
    const resumed = new Set(journal.completed);
    for (const slug of journal.seen) this.seen.add(slug);
    let restarted = false;
    let unsaved = false;
    try {
      for (;;) {
        const params = new URLSearchParams({ maxResults: "100", includeSpamTrash: "true" });
        if (journal.pageToken) params.set("pageToken", journal.pageToken);
        let page: GmailMessageList;
        try {
          page = await getJson<GmailMessageList>(
            ID,
            this.ctx.api,
            `${GMAIL_API}/messages?${params}`,
          );
        } catch (error) {
          if (
            !(error instanceof IntegrationSyncError) ||
            error.status !== 400 ||
            !journal.pageToken ||
            restarted
          )
            throw error;
          // Tokens expire and deletions can shift pages. Rebuild the reconciliation manifest
          // from a fresh listing, but keep completed IDs so their payloads need not be fetched.
          restarted = true;
          journal.restart();
          this.seen.clear();
          await journal.save();
          continue;
        }
        for (const row of page?.messages ?? []) {
          const id = row?.id;
          const slug = validId(id) ? messageSlug(this.account, `gmail-${id}`) : undefined;
          if (slug && journal.completed.has(slug)) {
            // A row charged by an earlier run is exempt once; later occurrences in this run count.
            if (!resumed.delete(slug)) this.ctx.budget.items(1);
            journal.remember(slug);
            this.seen.add(slug);
            continue;
          }
          // A completed ID was charged on its original run. New and malformed rows still
          // count before filtering, and incomplete payloads are retried even if RDF exists.
          this.ctx.budget.items(1);
          if (slug) journal.remember(slug);
          if ((await this.store(id)) && slug) {
            journal.complete(slug);
            unsaved = true;
          }
        }
        journal.pageToken = page?.nextPageToken || undefined;
        // After the last page too, when it completed payloads: a failure or cancel during
        // the sweep or the final membership flush then resumes without refetching them.
        if (journal.pageToken || unsaved) {
          await this.mail.flush();
          await journal.save();
          unsaved = false;
        }
        if (!journal.pageToken) break;
      }
    } catch (error) {
      if (
        error instanceof RunBudgetExceededError &&
        (!this.ctx.signal?.aborted || this.ctx.signal.reason === error)
      ) {
        // Commit memberships before journalling completed messages. A partial raw/body
        // failure never marks its ID complete, so the next run retries all its bytes.
        try {
          await this.mail.flush();
          await journal.save();
        } catch {
          /* Preserve the original budget failure if storage also fails. */
        }
      }
      throw error;
    }
    const container = `${accountRoot(this.account)}messages/`;
    const listing = await this.ctx.read(container);
    if (!listing) return journal.historyId;
    const base = this.ctx.resolve(container);
    for (const child of new Container(base, listing, DataFactory).contains) {
      if (!child.value.startsWith(base)) continue;
      const name = child.value.slice(base.length);
      if (!/^[^/?#]+\.ttl$/.test(name)) continue;
      const slug = `${container}${name}`;
      if (this.seen.has(slug)) continue;
      const stored = await this.ctx.read(slug);
      // Ignore containers, .eml siblings and documents outside the Gmail message model.
      if (
        stored &&
        new MailMessage(`${this.ctx.resolve(slug)}#it`, stored, DataFactory).types.has(
          MAIL_CLASSES.EmailMessage,
        )
      )
        await this.mail.removeMessage(slug);
    }
    return journal.historyId;
  }

  async finish(known: readonly MailFolder[]): Promise<void> {
    await this.mail.flush(known);
  }

  /**
   * Runner-invoked once the run has reported its cursor. Keeping the journal until then means
   * a run that fails after the sweep (a Pod error or a cancel) resumes from completed IDs.
   */
  readonly commit = async (): Promise<void> => {
    await this.journal?.clear();
  };

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
        undefined,
      );
      this.ctx.budget.items(page?.history?.length ?? 0);
      for (const record of page?.history ?? []) {
        for (const group of [
          record?.messagesDeleted,
          record?.messagesAdded,
          record?.labelsAdded,
          record?.labelsRemoved,
        ])
          this.ctx.budget.items(group?.length ?? 0);
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
    for (const id of changed) {
      this.ctx.budget.items(1);
      await this.store(id);
    }
    return latest;
  }

  /** False when the message must be retried by a resumed run (a source timeout). */
  private async store(id: unknown): Promise<boolean> {
    if (!validId(id)) {
      this.skipped++;
      return true;
    }
    let message: GmailMessage;
    try {
      message = await getJson<GmailMessage>(
        ID,
        this.ctx.api,
        `${GMAIL_API}/messages/${id}?format=raw`,
        undefined,
        MAX_MESSAGE_JSON_BYTES,
      );
    } catch (error) {
      // Deleted between listing and fetching: a deletion, not a failure.
      if (error instanceof IntegrationSyncError && error.status === 404) {
        await this.remove(id);
        return true;
      }
      // Over the message cap, or a stalled response: keep any stored copy (not swept) and
      // skip it, counted in `skipped`. A timed-out message is not journalled as complete.
      if (error instanceof ResponseTooLargeError || error instanceof SourceTimeoutError) {
        this.seen.add(messageSlug(this.account, `gmail-${id}`));
        this.skipped++;
        return !(error instanceof SourceTimeoutError);
      }
      throw error;
    }
    const labelIds = Array.isArray(message?.labelIds) ? message.labelIds : [];
    if (labelIds.includes("SPAM")) {
      await this.remove(id);
      return true;
    }
    const source = webUrl(id);
    // Anything kept from here on is not swept by a full sync, even if it cannot be re-read.
    this.seen.add(messageSlug(this.account, `gmail-${id}`));
    if (
      !validId(message?.threadId) ||
      typeof message.raw !== "string" ||
      message.raw.length > (MAX_RAW_BYTES * 4) / 3 + 4
    ) {
      this.skipped++;
      return true;
    }
    const raw = decodeBase64Url(message.raw);
    if (!raw) {
      this.skipped++;
      return true;
    }
    const folders = labelIds.flatMap((label) => this.labels.get(label) ?? []);
    if (!labelIds.some((label) => ["INBOX", "SENT", "DRAFT", "TRASH"].includes(label)))
      folders.push({ key: "Archive", title: "Archive" });
    const received = Number(message.internalDate);
    try {
      await this.mail.add({
        raw,
        folders,
        read: !labelIds.includes("UNREAD"),
        threadKey: `gmail-${message.threadId}`,
        fallbackId: `gmail-${id}`,
        documentId: `gmail-${id}`,
        resolveParent: (messageId) => this.resolveParent(message.threadId, messageId),
        sourceUrl: source,
        receivedAt: Number.isFinite(received) && received > 0 ? new Date(received) : undefined,
      });
    } catch (error) {
      // One malformed message must not block the mailbox.
      if (!(error instanceof MailParseError)) throw error;
      this.skipped++;
      return true;
    }
    this.done++;
    if (this.done % 25 === 0)
      this.ctx.progress({ label: `Saved ${this.done} messages…`, done: this.done });
    return true;
  }

  private async remove(id: string): Promise<void> {
    await this.mail.removeMessage(messageSlug(this.account, `gmail-${id}`));
  }

  private async resolveParent(threadId: string, messageId: string): Promise<string | undefined> {
    let parents = this.parents.get(threadId);
    if (!parents) {
      const params = new URLSearchParams({ format: "metadata", metadataHeaders: "Message-ID" });
      const metadata = await getJson<GmailThread>(
        ID,
        this.ctx.api,
        `${GMAIL_API}/threads/${threadId}?${params}`,
        undefined,
      );
      this.ctx.budget.items(metadata?.messages?.length ?? 0);
      const found = new Map<string, string>();
      if (metadata?.id === threadId && Array.isArray(metadata.messages))
        for (const member of metadata.messages) {
          if (!validId(member?.id) || member.threadId !== threadId) continue;
          const headers = member.payload?.headers;
          if (!Array.isArray(headers)) continue;
          for (const header of headers) {
            if (
              typeof header?.name !== "string" ||
              header.name.toLowerCase() !== "message-id" ||
              typeof header.value !== "string"
            )
              continue;
            const value = header.value.trim();
            if (/^<[^<>\s]+>$/.test(value)) found.set(value, `gmail-${member.id}`);
          }
        }
      parents = found;
      this.parents.set(threadId, parents);
    }
    return parents.get(messageId);
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
