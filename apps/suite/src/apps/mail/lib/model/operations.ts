// AUTHORED-BY Codex GPT-6.1-Sol
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
import { mailDocument } from "./paths.js";

/** Load folders and their messages to produce counts for a consistent loaded snapshot. */
export async function loadFolders(store: MailStore, root: string) {
  const folders = await store.snapshot(await store.list(new URL("folders/", root).href));
  const messages = await store.snapshot(
    [...folders.folders].flatMap((f) => [...f.messageIris].map(documentOf)),
  );
  const combined = combine([folders, messages]);
  return folderCounts(combined);
}
export async function loadThreads(store: MailStore, folderIri: string, offset = 0, limit = 50) {
  const folder = await store.load(documentOf(folderIri));
  const messages = await store.snapshot(
    [...folder.mailbox.folder(folderIri).messageIris].map(documentOf),
  );
  const threads = await store.snapshot(
    [...messages.messages].flatMap((m) => (m.partOfThread ? [documentOf(m.partOfThread)] : [])),
  );
  return pageThreads(combine([folder.mailbox, messages, threads]), folderIri, offset, limit);
}
export async function loadThread(store: MailStore, threadIri: string) {
  const thread = await store.load(documentOf(threadIri));
  const messages = await store.snapshot(
    [...thread.mailbox.thread(threadIri).messageIris].map(documentOf),
  );
  return threadMessages(combine([thread.mailbox, messages]), threadIri);
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
  const url = mailDocument(root, "folders", "starred");
  const folder = await store.load(url, true);
  if (!folder.exists) {
    folder.mailbox.createFolder(`${url}#it`).title = "Starred";
    await store.save(folder);
  }
  await setLabel(store, messageIri, `${url}#it`, starred);
}
export async function archive(store: MailStore, root: string, messageIri: string): Promise<void> {
  const inbox = `${mailDocument(root, "folders", "inbox")}#it`;
  const target = `${mailDocument(root, "folders", "archive")}#it`;
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
  await saveSubjects(store, docs, combined);
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
