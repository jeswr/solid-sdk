// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { RdfFetchError } from "@jeswr/fetch-rdf";
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import { sanitizeMessageHtml } from "../mime";
import {
  archive,
  createDraft,
  type Draft,
  type DraftInput,
  discardDraft,
  documentOf,
  importMbox,
  isAppDraft,
  loadFolders,
  loadThread,
  loadThreads,
  MailError,
  MailStore,
  type Message,
  mailDocument,
  mailRoot,
  persistImportedMail,
  readDraft,
  type SavedDraft,
  type SentDemoDraft,
  sendDemoDraft,
  setLabel,
  setRead,
  setStarred,
  updateDraft,
} from "../model";
import { mailAddressName, mailAttachments, privateMailIndex } from "../model/client-support";
import { type QuotedText, QuoteError, splitQuotedText } from "../quotes";
import { evaluateQuery, parseQuery } from "../search";
import { isMissing } from "./errors";
import { folderIriFromKey, folderKey, SYSTEM_KEYS } from "./keys";
import type {
  BatchResult,
  FolderView,
  ImportOptions,
  ImportResult,
  MessageView,
  ThreadPage,
  ThreadRow,
  ThreadView,
} from "./types";

function address(iri: string): string {
  return decodeURIComponent(iri.replace(/^mailto:/i, ""));
}
function displayAddress(message: Message, iri: string, owner: string): string {
  if (address(iri).toLowerCase() === address(owner).toLowerCase()) return "me";
  return mailAddressName(message, iri) ?? address(iri);
}
function headerAddress(message: Message, iri: string, owner: string): string {
  const label = displayAddress(message, iri, owner);
  const email = address(iri);
  return label === email ? email : `${label} <${email}>`;
}
function searchAddress(message: Message, iri: string): string {
  const name = mailAddressName(message, iri);
  const email = address(iri);
  return name ? `${name} <${email}>` : email;
}
function quotedBody(text: string): { quoted: QuotedText; truncated: boolean } {
  try {
    return { quoted: splitQuotedText(text), truncated: false };
  } catch (error) {
    if (!(error instanceof QuoteError)) throw error;
    // Invalid text stays local to this message; keep the raw text and .eml for fidelity.
    const preview = text
      .slice(0, 64 * 1024)
      .toWellFormed()
      .replace(/\0/g, "\uFFFD");
    return {
      quoted: {
        segments: [{ kind: "body", text: preview, depth: 0 }],
        visibleText: preview,
        hasQuotedHistory: false,
      },
      truncated: true,
    };
  }
}
function row(iri: string, messages: Message[], owner: string): ThreadRow {
  const newest = [...messages].sort(
    (a, b) => (b.dateSent?.getTime() ?? 0) - (a.dateSent?.getTime() ?? 0),
  );
  const latest = newest[0];
  return {
    iri,
    subject: latest?.subjectLine ?? "(No subject)",
    participants: [
      ...new Set(
        newest.flatMap((m) =>
          [m.sender, ...m.to, ...m.cc]
            .filter((s): s is string => s !== undefined)
            .map((iri) => displayAddress(m, iri, owner)),
        ),
      ),
    ],
    snippet: (latest?.body ?? "").replace(/\s+/g, " ").trim().slice(0, 140),
    latest: latest?.dateSent ?? new Date(0),
    count: messages.length,
    unread: messages.some((m) => !m.isRead),
    starred: messages.some((m) => [...m.folderIris].some((f) => folderKey(f) === "starred")),
    hasAttachment: messages.some((m) => m.attachments.size > 0),
  };
}
export class MailClient {
  readonly store: MailStore;
  readonly binaryFetch: typeof globalThis.fetch;
  readonly storageUrl: string;
  readonly webId: string;
  constructor(
    fetch: typeof globalThis.fetch,
    storageUrl: string,
    webId?: string,
    private readonly mode: "demo" | "solid" | "extension" = "solid",
  ) {
    this.storageUrl = new URL(".", storageUrl.endsWith("/") ? storageUrl : `${storageUrl}/`).href;
    this.store = new MailStore(fetch, this.storageUrl);
    this.binaryFetch = createPodScopedFetch(this.storageUrl, { fetch });
    this.webId = webId ?? new URL("profile/card#me", this.storageUrl).href;
  }
  root(account: string): string {
    if (account === "attachments")
      throw new TypeError("The account name attachments is reserved. Choose another name.");
    return mailRoot(this.storageUrl, account);
  }
  private rootOf(iri: string): string {
    const url = new URL(iri);
    const base = new URL("mail/", this.storageUrl);
    const relative = url.pathname.slice(base.pathname.length);
    const parts = relative.split("/");
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith(base.pathname) ||
      parts.length !== 3 ||
      !parts[0] ||
      !["messages", "threads", "folders"].includes(String(parts[1]))
    )
      throw new TypeError("Invalid mail resource");
    return new URL(`${parts[0]}/`, base).href;
  }
  private async absent<T>(operation: () => Promise<T>, empty: T): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (isMissing(error)) return empty;
      if (error instanceof RdfFetchError && (error.status === 401 || error.status === 403))
        throw new MailError("forbidden", error.status);
      throw error;
    }
  }
  async accounts(): Promise<string[]> {
    const base = new URL("mail/", this.storageUrl);
    const children = await this.absent(() => this.store.list(base.href), []);
    return children
      .filter((child) => {
        const url = new URL(child);
        return (
          url.origin === base.origin &&
          url.pathname.startsWith(base.pathname) &&
          url.pathname.slice(base.pathname.length).split("/").length === 2 &&
          url.pathname.endsWith("/") &&
          child !== base.href &&
          !url.search &&
          !url.hash
        );
      })
      .map((child) =>
        decodeURIComponent(
          (new URL(child).pathname.split("/").at(-2) as string).replace(/~([0-9A-F]{2})/g, "%$1"),
        ),
      )
      .filter((slug) => slug !== "attachments")
      .sort();
  }
  async folders(account: string): Promise<FolderView[]> {
    const root = this.root(account);
    const counts = await loadFolders(this.store, root);
    const folders = counts.map(({ folder, total, unreadThreads }) => {
      const key = folderKey(folder.value);
      return {
        iri: folder.value,
        key,
        title: folder.title ?? key,
        system: !key.startsWith("label:"),
        total,
        unread: unreadThreads,
      };
    });
    if (!folders.some((f) => f.key === "inbox"))
      folders.push({
        iri: folderIriFromKey(root, "inbox"),
        key: "inbox",
        title: "Inbox",
        system: true,
        total: 0,
        unread: 0,
      });
    return folders.sort((a, b) => {
      const rank = (f: FolderView) =>
        f.system ? (SYSTEM_KEYS as readonly string[]).indexOf(f.key) : SYSTEM_KEYS.length;
      return rank(a) - rank(b) || a.title.localeCompare(b.title);
    });
  }
  async threads(account: string, folderIri: string, offset = 0, limit = 50): Promise<ThreadPage> {
    if (this.rootOf(folderIri) !== this.root(account))
      throw new TypeError("Invalid account folder");
    // Only the folder's 404 means an empty page; dangling members must surface errors.
    const folder = await this.store.load(documentOf(folderIri), true);
    if (!folder.exists) return { items: [], total: 0, next: null };
    const page = await loadThreads(this.store, folderIri, offset, limit);
    return {
      ...page,
      items: page.items.map(({ thread, messages }) => row(thread.value, messages, this.webId)),
    };
  }
  async thread(threadIri: string): Promise<ThreadView> {
    this.rootOf(threadIri);
    const messages = await loadThread(this.store, threadIri);
    const views: MessageView[] = [];
    for (const message of messages) {
      const text = message.body ?? "";
      const body = quotedBody(text);
      views.push({
        iri: message.value,
        from: message.sender
          ? headerAddress(message, message.sender, this.webId)
          : "Unknown sender",
        to: [...message.to].map((iri) => headerAddress(message, iri, this.webId)),
        cc: [...message.cc].map((iri) => headerAddress(message, iri, this.webId)),
        date: message.dateSent ?? new Date(0),
        subject: message.subjectLine ?? "(No subject)",
        text,
        ...(message.bodyHtml === undefined ? {} : { html: sanitizeMessageHtml(message.bodyHtml) }),
        quoted: body.quoted,
        truncated: body.truncated,
        ...(message.encoding === undefined ? {} : { originalUrl: message.encoding }),
        read: message.isRead,
        starred: [...message.folderIris].some((f) => folderKey(f) === "starred"),
        draft:
          isAppDraft(this.rootOf(message.value), message.value) &&
          [...message.folderIris].some((f) => folderKey(f) === "drafts"),
        demoSent:
          isAppDraft(this.rootOf(message.value), message.value) &&
          message.folderIris.has(folderIriFromKey(this.rootOf(message.value), "sent")),
        labels: [...message.folderIris],
        attachments: await mailAttachments(this.store, message.value),
      });
    }
    return { iri: threadIri, subject: views[0]?.subject ?? "(No subject)", messages: views };
  }
  private async batch(
    iris: string[],
    operation: (iri: string) => Promise<void>,
  ): Promise<BatchResult> {
    const result: BatchResult = { done: [], failed: [] };
    for (const iri of new Set(iris)) {
      try {
        await operation(iri);
        result.done.push(iri);
      } catch (error) {
        result.failed.push({ iri, error });
      }
    }
    return result;
  }
  markRead(iris: string[], read: boolean): Promise<BatchResult> {
    return this.batch(iris, async (iri) => {
      this.rootOf(iri);
      await setRead(this.store, iri, read, new Date());
    });
  }
  async star(iri: string, on: boolean): Promise<void> {
    await setStarred(this.store, this.rootOf(iri), iri, on);
  }
  archive(iris: string[]): Promise<BatchResult> {
    return this.batch(iris, async (iri) => {
      const root = this.rootOf(iri);
      try {
        await archive(this.store, root, iri);
      } catch (error) {
        if (!(error instanceof MailError) || error.code !== "conflict") throw error;
        // Reconcile both sides after a partial write using fresh documents and validators.
        await archive(this.store, root, iri);
      }
    });
  }
  async label(iri: string, folderIri: string, on: boolean): Promise<void> {
    if (this.rootOf(iri) !== this.rootOf(folderIri))
      throw new TypeError("Labels must belong to the same account");
    await setLabel(this.store, iri, folderIri, on);
  }
  /**
   * Saves a new draft (no `draft`) or rewrites the version the caller read (its ETag); returns
   * the draft and its new validator. A newer version saved elsewhere fails with `conflict`.
   */
  async saveDraft(account: string, input: DraftInput, draft?: SavedDraft): Promise<SavedDraft> {
    const root = this.root(account);
    if (draft === undefined)
      return createDraft(this.store, root, this.webId, input, crypto.randomUUID(), new Date());
    if (this.rootOf(draft.iri) !== root)
      throw new TypeError("Drafts must belong to the same account");
    return updateDraft(this.store, root, draft, input, new Date());
  }
  async draft(iri: string): Promise<Draft> {
    return readDraft(this.store, this.rootOf(iri), iri);
  }
  /** Files in Sent inside the demo pod; never delivers mail to a recipient. */
  async sendDemo(draftIri: string, etag: string | null): Promise<SentDemoDraft> {
    if (this.mode !== "demo") throw new MailError("forbidden", 403);
    return sendDemoDraft(this.store, this.rootOf(draftIri), { iri: draftIri, etag }, new Date());
  }
  async discardDraft(draft: SavedDraft): Promise<void> {
    await discardDraft(this.store, this.rootOf(draft.iri), draft, async (url, etag) => {
      const response = await this.binaryFetch(url, {
        method: "DELETE",
        ...(etag ? { headers: { "if-match": etag } } : {}),
      });
      // Already gone is the goal state.
      if (!response.ok && response.status !== 404)
        throw new MailError(
          response.status === 401 || response.status === 403
            ? "forbidden"
            : response.status === 412
              ? "conflict"
              : "http",
          response.status,
        );
    });
  }
  async createLabel(account: string, title: string): Promise<string> {
    const name = title.trim();
    if (
      !name ||
      name.length > 100 ||
      /^system:/i.test(name) ||
      Array.from(name).some((char) => char.charCodeAt(0) < 32)
    )
      throw new TypeError("Choose a label of 1–100 characters without a reserved system: prefix");
    const folders = await this.folders(account);
    if (folders.some((f) => f.title.toLocaleLowerCase() === name.toLocaleLowerCase()))
      throw new TypeError("A label with this name already exists");
    const url = mailDocument(this.root(account), "folders", name);
    const loaded = await this.store.load(url, true);
    if (loaded.exists) throw new MailError("conflict", 412);
    const iri = `${url}#it`;
    loaded.mailbox.createFolder(iri).title = name;
    await this.store.save(loaded);
    return iri;
  }
  async search(account: string, query: string, limit = 200): Promise<ThreadRow[]> {
    const ast = parseQuery(query);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("Invalid search limit");
    const folders = await this.folders(account);
    const snapshot = await this.store.snapshot(
      folders
        .map((f) => documentOf(f.iri))
        .filter(
          (url) =>
            !url.endsWith("system:inbox.ttl") ||
            folders.some((f) => f.key === "inbox" && f.total > 0),
        ),
    );
    const iris = [...snapshot.folders].flatMap((f) => [...f.messageIris].map(documentOf));
    const messages = [...(await this.store.snapshot(iris)).messages]
      .sort((a, b) => (b.dateSent?.getTime() ?? 0) - (a.dateSent?.getTime() ?? 0))
      .slice(0, 5000);
    const threads = new Set(
      messages
        .filter((m) =>
          evaluateQuery(ast, {
            from: m.sender ? searchAddress(m, m.sender) : "",
            to: [...m.to, ...m.cc].map((iri) => searchAddress(m, iri)),
            subject: m.subjectLine ?? "",
            snippet: (m.body ?? "").replace(/\s+/g, " ").slice(0, 140),
            hasAttachment: m.attachments.size > 0,
            unread: !m.isRead,
            dateSent: m.dateSent?.getTime() ?? 0,
          }),
        )
        .map((m) => m.partOfThread)
        .filter((iri): iri is string => iri !== undefined),
    );
    const rows: ThreadRow[] = [];
    for (const iri of threads) rows.push(row(iri, await loadThread(this.store, iri), this.webId));
    return rows
      .sort((a, b) => b.latest.getTime() - a.latest.getTime() || a.iri.localeCompare(b.iri))
      .slice(0, limit);
  }
  async registerTypeIndex(account: string): Promise<"registered" | "missing"> {
    const index = await privateMailIndex(this.store, this.webId);
    if (!index) return "missing";
    await this.store.register(index, this.root(account));
    return "registered";
  }
  async importMailbox(
    account: string,
    source: AsyncIterable<Uint8Array>,
    options: ImportOptions = {},
  ): Promise<ImportResult> {
    this.root(account);
    const result: ImportResult = {
      messages: 0,
      attachments: 0,
      bytes: 0,
      failed: 0,
      failures: [],
      aborted: false,
      typeIndex: "missing",
    };
    const progress = () =>
      options.onProgress?.({
        messages: result.messages,
        attachments: result.attachments,
        bytes: result.bytes,
        failed: result.failed,
      });
    const mint = options.mintId ?? (() => crypto.randomUUID());
    const storage = this.storageUrl;
    async function* counted() {
      for await (const chunk of source) {
        if (options.signal?.aborted) return;
        result.bytes += chunk.byteLength;
        yield chunk;
      }
    }
    // A single splitter owns recovery and ancestry; no lookahead can discard its predecessor.
    for await (const item of importMbox(counted(), storage, account, mint, {
      onError: (error) => {
        result.failed++;
        result.failures.push({ iri: `Message ${result.messages + result.failed}`, error });
        progress();
      },
    })) {
      if (options.signal?.aborted) break;
      try {
        await persistImportedMail(this.store, item);
        result.messages++;
        result.attachments += item.attachments.length;
      } catch (error) {
        result.failed++;
        result.failures.push({ iri: item.message, error });
      }
      progress();
    }
    result.aborted = options.signal?.aborted === true;
    try {
      result.typeIndex = await this.registerTypeIndex(account);
    } catch (error) {
      result.typeIndex = "failed";
      result.typeIndexError = error;
    }
    return result;
  }
}
