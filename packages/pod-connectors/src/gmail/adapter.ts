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
import { IntegrationSyncError } from "../core/errors.js";
import { getJson } from "../core/fixture-fetch.js";
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
      await sync.full();
      cursor = profile.historyId;
    }
    ctx.progress({ label: "Updating folders and conversations…", done: sync.done });
    const known = new Map<string, MailFolder>();
    for (const key of SYSTEM_FOLDERS) known.set(key, { key, title: key });
    for (const folder of labels.values()) known.set(folder.key, folder);
    await mail.flush([...known.values()]);
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

const webUrl = (id: string) => `https://mail.google.com/mail/#all/${id}`;
/** Opaque source ids only; cap their length before using them in URLs or document names. */
const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[0-9a-zA-Z_-]{1,256}$/.test(id);

class Sync {
  done = 0;
  skipped = 0;
  private readonly seen = new Set<string>();
  constructor(
    private readonly ctx: ImportContext,
    private readonly mail: MailWriter,
    private readonly labels: ReadonlyMap<string, MailFolder>,
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
    const container = `${accountRoot(this.account)}messages/`;
    const listing = await this.ctx.read(container);
    if (!listing) return;
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
    this.seen.add(messageSlug(this.account, `gmail-${id}`));
    if (
      !validId(message?.threadId) ||
      typeof message.raw !== "string" ||
      message.raw.length > (MAX_RAW_BYTES * 4) / 3 + 4
    ) {
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
    try {
      await this.mail.add({
        raw,
        folders,
        read: !labelIds.includes("UNREAD"),
        threadKey: `gmail-${message.threadId}`,
        fallbackId: `gmail-${id}`,
        documentId: `gmail-${id}`,
        sourceUrl: source,
        receivedAt: Number.isFinite(received) && received > 0 ? new Date(received) : undefined,
      });
    } catch (error) {
      // One malformed message must not block the mailbox.
      if (!(error instanceof MailParseError)) throw error;
      this.skipped++;
      return;
    }
    this.done++;
    if (this.done % 25 === 0)
      this.ctx.progress({ label: `Saved ${this.done} messages…`, done: this.done });
  }

  private async remove(id: string): Promise<void> {
    await this.mail.removeMessage(messageSlug(this.account, `gmail-${id}`));
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
