// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import {
  archiveMessage,
  folderCounts,
  pageThreads,
  setMembership,
  threadMessages,
} from "./helpers.js";
import { type LoadedMail, MailError, type MailStore } from "./io.js";
import { MailboxDataset } from "./mailbox.js";
import { systemFolderDocument } from "./paths.js";

/** Load folders and their messages to produce counts for a consistent loaded snapshot. */
export async function loadFolders(store: MailStore, root: string) {
  // Only the container itself may be absent; referenced resource failures must surface.
  let children: string[];
  try {
    children = await store.list(new URL("folders/", root).href);
  } catch (error) {
    if (error instanceof RdfFetchError && error.status === 404) return [];
    if (error instanceof RdfFetchError && (error.status === 401 || error.status === 403))
      throw new MailError("forbidden", error.status);
    throw error;
  }
  const folders = await store.snapshot(children);
  // Counts tolerate dangling references (a deleted message, an interrupted thread merge):
  // a missing document is skipped rather than hiding every folder.
  const messages = await snapshotPresent(
    store,
    [...folders.folders].flatMap((f) => [...f.messageIris].map(documentOf)),
  );
  const threads = await snapshotPresent(
    store,
    [...messages.messages].flatMap((message) =>
      message.partOfThread ? [documentOf(message.partOfThread)] : [],
    ),
  );
  const loaded = new Set([...messages.messages].map((message) => documentOf(message.value)));
  const members = await snapshotPresent(
    store,
    [...threads.threads]
      .flatMap((thread) => [...thread.messageIris].map(documentOf))
      .filter((url) => !loaded.has(url)),
  );
  const combined = combine([folders, messages, threads, members]);
  return folderCounts(combined).map((count) => ({
    ...count,
    unreadThreads: pageThreads(
      combined,
      count.folder.value,
      0,
      Number.MAX_SAFE_INTEGER,
    ).items.filter((row) => row.messages.some((message) => !message.isRead)).length,
  }));
}
export async function loadThreads(store: MailStore, folderIri: string, offset = 0, limit = 50) {
  const folder = await store.load(documentOf(folderIri));
  const messages = await snapshotPresent(
    store,
    [...folder.mailbox.folder(folderIri).messageIris].map(documentOf),
  );
  const threads = await snapshotPresent(
    store,
    [...messages.messages].flatMap((m) => (m.partOfThread ? [documentOf(m.partOfThread)] : [])),
  );
  const members = await snapshotPresent(
    store,
    [...threads.threads].flatMap((t) => [...t.messageIris].map(documentOf)),
  );
  return pageThreads(
    combine([folder.mailbox, messages, threads, members]),
    folderIri,
    offset,
    limit,
  );
}
export async function loadThread(store: MailStore, threadIri: string) {
  const thread = await store.load(documentOf(threadIri));
  const message = thread.mailbox.findMessage(threadIri);
  if (message) return [message];
  const messages = await snapshotPresent(
    store,
    [...thread.mailbox.thread(threadIri).messageIris].map(documentOf),
  );
  return threadMessages(combine([thread.mailbox, messages]), threadIri);
}
/** Loads documents with bounded concurrency, skipping ones that no longer exist (404). */
async function snapshotPresent(store: MailStore, urls: string[]): Promise<MailboxDataset> {
  const unique = [...new Set(urls)];
  const dataset = new Store();
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < unique.length) {
      const url = unique[next++] as string;
      try {
        dataset.addQuads([...(await store.load(url)).mailbox]);
      } catch (error) {
        if (error instanceof MailError && error.code === "not-found") continue;
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, unique.length) }, worker));
  return new MailboxDataset(dataset, DataFactory);
}
export function documentOf(iri: string): string {
  const url = new URL(iri);
  url.hash = "";
  return url.href;
}
function combine(datasets: MailboxDataset[]): MailboxDataset {
  const dataset = new Store();
  for (const source of datasets) dataset.addQuads([...source]);
  return new MailboxDataset(dataset, DataFactory);
}
export async function setRead(
  store: MailStore,
  messageIri: string,
  read: boolean,
  at: Date,
): Promise<void> {
  if (!Number.isFinite(at.getTime())) throw new TypeError("Invalid read date");
  await store.mutate(documentOf(messageIri), (mailbox) => {
    const message = mailbox.findMessage(messageIri);
    if (!message) throw new MailError("not-found", 404);
    message.setRead(read, at);
  });
}
/** Labels and stars share the collection membership model. Every changed document uses its own ETag. */
export async function setLabel(
  store: MailStore,
  messageIri: string,
  folderIri: string,
  present: boolean,
): Promise<void> {
  const docs = await loadDistinct(store, [documentOf(messageIri), documentOf(folderIri)]);
  const combined = combine(docs.map((d) => d.mailbox));
  setMembership(combined, messageIri, folderIri, present);
  await saveSubjects(store, docs, combined);
}
export async function setStarred(
  store: MailStore,
  root: string,
  messageIri: string,
  starred: boolean,
): Promise<void> {
  const url = systemFolderDocument(root, "starred");
  const folder = await store.load(url, true);
  if (!folder.exists) {
    folder.mailbox.createFolder(`${url}#it`).title = "Starred";
    await store.save(folder);
  }
  await setLabel(store, messageIri, `${url}#it`, starred);
}
export async function archive(store: MailStore, root: string, messageIri: string): Promise<void> {
  const inbox = `${systemFolderDocument(root, "inbox")}#it`;
  const target = `${systemFolderDocument(root, "archive")}#it`;
  const docs = [await store.load(documentOf(messageIri))];
  for (const [iri, title] of [
    [inbox, "Inbox"],
    [target, "Archive"],
  ] as const) {
    const loaded = await store.load(documentOf(iri), true);
    if (!loaded.mailbox.findFolder(iri)) loaded.mailbox.createFolder(iri).title = title;
    docs.push(loaded);
  }
  const combined = combine(docs.map((d) => d.mailbox));
  archiveMessage(combined, messageIri, inbox, target);
  // Preserve graph assembly order, but make the destination discoverable before
  // changing either source membership. The destination folder is the last document.
  await saveSubjects(store, [...docs.slice(-1), ...docs.slice(0, -1)], combined);
}
async function loadDistinct(store: MailStore, urls: string[]): Promise<LoadedMail[]> {
  const docs: LoadedMail[] = [];
  for (const url of new Set(urls)) docs.push(await store.load(url));
  return docs;
}
async function saveSubjects(
  store: MailStore,
  docs: LoadedMail[],
  combined: MailboxDataset,
): Promise<void> {
  // Keep unrelated subjects and triples in their original document; replace only known subjects.
  for (const doc of docs) {
    const subjects = new Set([...doc.mailbox].map((q) => q.subject.value));
    const dataset = new Store([...combined].filter((q) => subjects.has(q.subject.value)));
    await store.save(doc, dataset);
  }
}
