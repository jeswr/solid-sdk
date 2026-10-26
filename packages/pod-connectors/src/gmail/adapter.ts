// AUTHORED-BY Claude Opus 5.5
/**
 * Gmail → Mail (CON-07). Full sync lists every message and stores its raw RFC 822 source
 * through the shared MailWriter (pod-mail layout, `.eml` beside each message). The cursor
 * is the mailbox `historyId`; later runs replay `users.history.list` (added, deleted and
 * relabelled messages). An expired history id (404) falls back to a full sync.
 */
import { DataFactory, Store } from "n3";
import { createGoogleOAuthConfig, GOOGLE_SCOPES } from "../adapters/google/oauth.js";
import { IntegrationSyncError } from "../core/errors.js";
import { getJson } from "../core/fixture-fetch.js";
import { Provenance } from "../core/provenance.js";
import type { ImportContext, ImportOutcome, IntegrationAdapter } from "../core/types.js";
import { createMailWriter, type MailWriter } from "../mail/writer.js";
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
    const labels = await labelNames(ctx);
    const mail = createMailWriter(ctx, profile.emailAddress);
    const sync = new Sync(ctx, mail, labels);

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
    await mail.flush();
    ctx.progress({ label: "Done", done: sync.done, total: sync.done });
    return { cursor, skipped: sync.skipped || undefined };
  },
};

async function labelNames(ctx: ImportContext): Promise<Map<string, string>> {
  const list = await getJson<GmailLabelList>(ID, ctx.api, `${GMAIL_API}/labels`);
  const names = new Map<string, string>();
  for (const label of list?.labels ?? []) {
    if (!label || typeof label.id !== "string") continue;
    const name = SYSTEM_LABELS[label.id] ?? (label.type === "user" ? label.name : undefined);
    if (typeof name === "string" && name.trim()) names.set(label.id, name);
  }
  return names;
}

const webUrl = (id: string) => `https://mail.google.com/mail/#all/${encodeURIComponent(id)}`;
const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[0-9a-zA-Z_-]+$/.test(id);

class Sync {
  done = 0;
  skipped = 0;
  constructor(
    private readonly ctx: ImportContext,
    private readonly mail: MailWriter,
    private readonly labels: ReadonlyMap<string, string>,
  ) {}

  async full(): Promise<void> {
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ maxResults: "100" });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await getJson<GmailMessageList>(
        ID,
        this.ctx.api,
        `${GMAIL_API}/messages?${params}`,
      );
      for (const ref of page?.messages ?? []) await this.store(ref?.id, ref?.threadId);
      pageToken = page?.nextPageToken || undefined;
    } while (pageToken);
  }

  /** Replays history pages from `start`; returns the mailbox historyId to persist. */
  async history(start: string): Promise<string> {
    const changed = new Map<string, string | undefined>();
    const deleted = new Map<string, string | undefined>();
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
          deleted.set(message.id, message.threadId);
        }
        for (const group of [record?.messagesAdded, record?.labelsAdded, record?.labelsRemoved])
          for (const { message } of group ?? [])
            if (validId(message?.id) && !deleted.has(message.id))
              changed.set(message.id, message.threadId);
      }
      if (typeof page?.historyId === "string") latest = page.historyId;
      pageToken = page?.nextPageToken || undefined;
    } while (pageToken);
    for (const [id, threadId] of deleted) await this.remove(id, threadId);
    for (const [id, threadId] of changed) await this.store(id, threadId);
    return latest;
  }

  private async store(id: unknown, threadId: unknown): Promise<void> {
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
      if (error instanceof IntegrationSyncError && error.status === 404)
        return this.remove(id, validId(threadId) ? threadId : undefined);
      throw error;
    }
    const labelIds = Array.isArray(message?.labelIds) ? message.labelIds : [];
    if (labelIds.includes("SPAM")) return this.remove(id, message.threadId);
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
      folders.push("Archive");
    const received = Number(message.internalDate);
    await this.mail.add({
      raw,
      folders,
      read: !labelIds.includes("UNREAD"),
      threadKey: validId(message.threadId) ? `gmail-${message.threadId}` : undefined,
      fallbackId: `gmail-${id}`,
      sourceUrl: webUrl(id),
      receivedAt: Number.isFinite(received) && received > 0 ? new Date(received) : undefined,
    });
    this.done++;
    if (this.done % 25 === 0)
      this.ctx.progress({ label: `Saved ${this.done} messages…`, done: this.done });
  }

  /** Deleted Gmail ids are found through their thread, whose members carry the source URL. */
  private async remove(id: string, threadId: string | undefined): Promise<void> {
    if (!validId(threadId)) return;
    const source = webUrl(id);
    for (const slug of await this.mail.threadMessages(`gmail-${threadId}`)) {
      const dataset = await this.ctx.read(slug);
      const message = new Provenance(
        `${this.ctx.resolve(slug)}#it`,
        dataset ?? new Store(),
        DataFactory,
      );
      if (message.derivedFrom.has(source)) await this.mail.removeMessage(slug);
    }
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
