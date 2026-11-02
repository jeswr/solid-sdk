// AUTHORED-BY Claude Opus 5.5
import { mailtos } from "@jeswr/pod-connectors/mail";
import { MailError, type MailStore } from "./io.js";
import type { Message } from "./message.js";
import { documentOf } from "./operations.js";
import { mailDocument, systemFolderDocument } from "./paths.js";

/** Plain-text draft fields; addresses are bare email addresses. */
export interface DraftInput {
  to: readonly string[];
  cc: readonly string[];
  subject: string;
  text: string;
}
export interface Draft extends DraftInput {
  iri: string;
  thread: string;
  updated: Date;
}
const MAX_SUBJECT = 998;
const MAX_TEXT = 1024 * 1024;
const MAX_RECIPIENTS = 100;
const EMAIL = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/;

/** Validates and normalises draft fields; a draft may be incomplete but never malformed. */
export function draftFields(input: DraftInput): DraftInput {
  const list = (values: readonly string[]) => {
    if (!Array.isArray(values) || values.length > MAX_RECIPIENTS)
      throw new TypeError("Too many recipients");
    return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].map(
      (value) => {
        if (value.length > 254 || !EMAIL.test(value))
          throw new TypeError(`Not an email address: ${value}`);
        return value;
      },
    );
  };
  const subject = String(input.subject).replace(/[\r\n]+/g, " ");
  const text = String(input.text);
  if (subject.length > MAX_SUBJECT) throw new TypeError("Subject is too long");
  if (text.length > MAX_TEXT) throw new TypeError("Message is too long");
  return { to: list(input.to), cc: list(input.cc), subject, text };
}
function draftsFolder(root: string): string {
  return `${systemFolderDocument(root, "drafts")}#it`;
}
function address(iri: string): string {
  return decodeURIComponent(iri.replace(/^mailto:/i, ""));
}

/**
 * Creates a draft: its own message and thread documents (If-None-Match) and a Drafts folder
 * membership. The message is written first so the folder never lists a missing document.
 */
export async function createDraft(
  store: MailStore,
  root: string,
  sender: string,
  input: DraftInput,
  id: string,
  at: Date,
): Promise<string> {
  const fields = draftFields(input);
  const url = mailDocument(root, "messages", `draft-${id}`);
  const threadUrl = mailDocument(root, "threads", `draft-${id}`);
  const iri = `${url}#it`;
  const thread = `${threadUrl}#it`;
  const folder = draftsFolder(root);
  const loaded = await store.load(url, true);
  if (loaded.exists) throw new MailError("conflict", 412);
  const message = loaded.mailbox.createMessage(iri);
  message.identifier = `draft-${id}`;
  message.sender = sender;
  message.partOfThread = thread;
  message.dateRead = at;
  message.folderIris.add(folder);
  write(message, fields, at);
  await store.save(loaded);
  const threadDoc = await store.load(threadUrl, true);
  if (threadDoc.exists) throw new MailError("conflict", 412);
  const created = threadDoc.mailbox.createThread(thread);
  created.title = fields.subject || "(No subject)";
  created.addMessage(iri);
  await store.save(threadDoc);
  const folderDoc = await store.load(documentOf(folder), true);
  const drafts = folderDoc.mailbox.findFolder(folder) ?? folderDoc.mailbox.createFolder(folder);
  if (drafts.title === undefined) drafts.title = "Drafts";
  drafts.addMessage(iri);
  await store.save(folderDoc);
  return iri;
}
function write(message: Message, fields: DraftInput, at: Date): void {
  message.subjectLine = fields.subject || undefined;
  message.body = fields.text;
  message.to.clear();
  message.cc.clear();
  for (const iri of mailtos(fields.to.map((value) => ({ address: value, name: "" }))))
    message.to.add(iri);
  for (const iri of mailtos(fields.cc.map((value) => ({ address: value, name: "" }))))
    message.cc.add(iri);
  message.dateSent = at;
}
async function loadDraft(store: MailStore, root: string, iri: string) {
  if (documentOf(iri) === iri || !iri.startsWith(`${root}messages/draft-`))
    throw new MailError("not-found", 404);
  const loaded = await store.load(documentOf(iri));
  const message = loaded.mailbox.findMessage(iri);
  // Only messages still filed under Drafts are editable; a sent or imported mail never is.
  if (!message?.folderIris.has(draftsFolder(root))) throw new MailError("not-found", 404);
  return { loaded, message };
}
export async function readDraft(store: MailStore, root: string, iri: string): Promise<Draft> {
  const { message } = await loadDraft(store, root, iri);
  return {
    iri,
    thread: message.partOfThread ?? iri,
    to: [...message.to].map(address),
    cc: [...message.cc].map(address),
    subject: message.subjectLine ?? "",
    text: message.body ?? "",
    updated: message.dateSent ?? new Date(0),
  };
}
/** Rewrites the draft's fields under its ETag, then retitles its thread. */
export async function updateDraft(
  store: MailStore,
  root: string,
  iri: string,
  input: DraftInput,
  at: Date,
): Promise<void> {
  const fields = draftFields(input);
  const { loaded, message } = await loadDraft(store, root, iri);
  write(message, fields, at);
  await store.save(loaded);
  const thread = message.partOfThread;
  if (thread)
    await store.mutate(documentOf(thread), (mailbox) => {
      const found = mailbox.findThread(thread);
      if (found) found.title = fields.subject || "(No subject)";
    });
}
/**
 * Discards a draft: leaves Drafts first, so a failed delete leaves a harmless orphan rather than
 * a folder entry pointing at a missing document; then deletes the message and thread documents.
 */
export async function discardDraft(
  store: MailStore,
  root: string,
  iri: string,
  remove: (url: string) => Promise<void>,
): Promise<void> {
  const { message } = await loadDraft(store, root, iri);
  const folder = draftsFolder(root);
  const folderDoc = await store.load(documentOf(folder), true);
  const drafts = folderDoc.mailbox.findFolder(folder);
  if (drafts?.messageIris.has(iri)) {
    drafts.removeMessage(iri);
    await store.save(folderDoc);
  }
  await remove(documentOf(iri));
  const thread = message.partOfThread;
  if (thread?.startsWith(`${root}threads/draft-`)) await remove(documentOf(thread));
}
