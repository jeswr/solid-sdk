// AUTHORED-BY Codex GPT-6.1-Sol

import { RdfFetchError } from "@jeswr/fetch-rdf";
import { sanitizeMessageHtml } from "../mime";
import {
  archive,
  documentOf,
  importMbox,
  loadFolders,
  loadThread,
  loadThreads,
  MailError,
  MailStore,
  type Message,
  mailDocument,
  mailRoot,
  parseEmail,
  persistImportedMail,
  setLabel,
  setRead,
  setStarred,
  splitMbox,
} from "../model";
import { mailAttachments, privateMailIndex } from "../model/client-support";
import { splitQuotedText } from "../quotes";
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
function row(iri: string, messages: Message[]): ThreadRow {
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
          [m.sender, ...m.to, ...m.cc].filter((s): s is string => s !== undefined).map(address),
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
  readonly storageUrl: string;
  readonly webId: string;
  constructor(fetch: typeof globalThis.fetch, storageUrl: string, webId?: string) {
    this.storageUrl = new URL(".", storageUrl.endsWith("/") ? storageUrl : `${storageUrl}/`).href;
    this.store = new MailStore(fetch, this.storageUrl);
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
    const counts = await this.absent(() => loadFolders(this.store, root), []);
    const folders = counts.map(({ folder, total, unread }) => {
      const key = folderKey(folder.value);
      return {
        iri: folder.value,
        key,
        title: folder.title ?? key,
        system: !key.startsWith("label:"),
        total,
        unread,
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
      items: page.items.map(({ thread, messages }) => row(thread.value, messages)),
    };
  }
  async thread(threadIri: string): Promise<ThreadView> {
    this.rootOf(threadIri);
    const messages = await loadThread(this.store, threadIri);
    const views: MessageView[] = [];
    for (const message of messages) {
      const text = message.body ?? "";
      views.push({
        iri: message.value,
        from: address(message.sender ?? "Unknown sender"),
        to: [...message.to].map(address),
        cc: [...message.cc].map(address),
        date: message.dateSent ?? new Date(0),
        subject: message.subjectLine ?? "(No subject)",
        text,
        ...(message.bodyHtml === undefined ? {} : { html: sanitizeMessageHtml(message.bodyHtml) }),
        quoted: splitQuotedText(text),
        read: message.isRead,
        starred: [...message.folderIris].some((f) => folderKey(f) === "starred"),
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
    return this.batch(iris, (iri) => archive(this.store, this.rootOf(iri), iri));
  }
  async label(iri: string, folderIri: string, on: boolean): Promise<void> {
    if (this.rootOf(iri) !== this.rootOf(folderIri))
      throw new TypeError("Labels must belong to the same account");
    await setLabel(this.store, iri, folderIri, on);
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
            from: address(m.sender ?? ""),
            to: [...m.to].map(address),
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
    for (const iri of threads) rows.push(row(iri, await loadThread(this.store, iri)));
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
    const ids: string[] = [];
    const storage = this.storageUrl;
    async function* counted() {
      for await (const chunk of source) {
        if (options.signal?.aborted) return;
        result.bytes += chunk.byteLength;
        yield chunk;
      }
    }
    // importMbox owns thread ancestry across the whole run. Preflight each bounded
    // RFC822 message so a MIME failure cannot close that generator permanently.
    async function* validMessages() {
      let attempted = 0;
      for await (const raw of splitMbox(counted())) {
        if (options.signal?.aborted) return;
        const id = mint();
        try {
          await parseEmail(raw, storage, account, id);
        } catch (error) {
          result.failed++;
          result.failures.push({ iri: `Message ${++attempted}`, error });
          progress();
          continue;
        }
        attempted++;
        ids.push(id);
        yield new TextEncoder().encode("From import@example.org Thu Jan 01 00:00:00 2026\n");
        // Reapply mboxrd escaping because splitMbox has already removed one level.
        let start = 0;
        for (let i = 0; i < raw.length; i++) {
          if (i > 0 && raw[i - 1] !== 10) continue;
          let marker = i;
          while (raw[marker] === 62) marker++;
          if (
            raw[marker] === 70 &&
            raw[marker + 1] === 114 &&
            raw[marker + 2] === 111 &&
            raw[marker + 3] === 109 &&
            raw[marker + 4] === 32
          ) {
            yield raw.subarray(start, i);
            yield new Uint8Array([62]);
            start = i;
          }
        }
        yield raw.subarray(start);
      }
    }
    for await (const item of importMbox(
      validMessages(),
      storage,
      account,
      () => ids.shift() as string,
    )) {
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
