// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
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
  /** The validator of the version read; pass it back so a save never overwrites newer edits. */
  etag: string | null;
}
export interface SavedDraft {
  iri: string;
  etag: string | null;
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
const DRAFT_ID = "draft-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** True only for drafts this app created: a UUID draft document under the account's messages. */
export function isAppDraft(root: string, iri: string, kind: "messages" | "threads" = "messages") {
  return (
    iri.startsWith(`${root}${kind}/`) &&
    new RegExp(`^${DRAFT_ID}\\.ttl#it$`).test(iri.slice(`${root}${kind}/`.length))
  );
}
function draftsFolder(root: string): string {
  return `${systemFolderDocument(root, "drafts")}#it`;
}
function address(iri: string): string {
  return decodeURIComponent(iri.replace(/^mailto:/i, ""));
}

/** Re-reads and retries shared folder membership when another tab changed the folder. */
async function fileUnderFolder(
  store: MailStore,
  root: string,
  kind: "drafts" | "sent",
  iri: string,
  on: boolean,
) {
  const folder = `${systemFolderDocument(root, kind)}#it`;
  for (let attempt = 0; ; attempt++) {
    const folderDoc = await store.load(documentOf(folder), true);
    let collection = folderDoc.mailbox.findFolder(folder);
    if (on === Boolean(collection?.messageIris.has(iri))) return;
    if (!collection) {
      collection = folderDoc.mailbox.createFolder(folder);
      collection.title = kind === "drafts" ? "Drafts" : "Sent";
    }
    if (on) collection.addMessage(iri);
    else collection.removeMessage(iri);
    try {
      await store.save(folderDoc);
      return;
    } catch (error) {
      if (!(error instanceof MailError && error.code === "conflict") || attempt === 2) throw error;
    }
  }
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
): Promise<SavedDraft> {
  const fields = draftFields(input);
  const url = mailDocument(root, "messages", `draft-${id}`);
  const threadUrl = mailDocument(root, "threads", `draft-${id}`);
  const iri = `${url}#it`;
  const thread = `${threadUrl}#it`;
  if (!isAppDraft(root, iri)) throw new TypeError("Invalid draft identifier");
  const loaded = await store.load(url, true);
  if (loaded.exists) throw new MailError("conflict", 412);
  const message = loaded.mailbox.createMessage(iri);
  message.identifier = `draft-${id}`;
  message.sender = sender;
  message.partOfThread = thread;
  message.dateRead = at;
  message.folderIris.add(draftsFolder(root));
  write(message, fields, at);
  await store.save(loaded);
  const threadDoc = await store.load(threadUrl, true);
  if (threadDoc.exists) throw new MailError("conflict", 412);
  const created = threadDoc.mailbox.createThread(thread);
  created.title = fields.subject || "(No subject)";
  created.addMessage(iri);
  await store.save(threadDoc);
  await fileUnderFolder(store, root, "drafts", iri, true);
  return { iri, etag: loaded.etag };
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
async function loadDraft(store: MailStore, root: string, iri: string, etag?: string | null) {
  if (!isAppDraft(root, iri)) throw new MailError("not-found", 404);
  const loaded = await store.load(documentOf(iri));
  const message = loaded.mailbox.findMessage(iri);
  // Only messages still filed under Drafts are editable; a sent or imported mail never is.
  if (!message?.folderIris.has(draftsFolder(root))) throw new MailError("not-found", 404);
  // The caller's validator covers the version the person was editing, not just this read.
  if (etag !== undefined && etag !== loaded.etag) throw new MailError("conflict", 412);
  return { loaded, message };
}
export async function readDraft(store: MailStore, root: string, iri: string): Promise<Draft> {
  const { loaded, message } = await loadDraft(store, root, iri);
  return {
    iri,
    thread: message.partOfThread ?? iri,
    to: [...message.to].map(address),
    cc: [...message.cc].map(address),
    subject: message.subjectLine ?? "",
    text: message.body ?? "",
    updated: message.dateSent ?? new Date(0),
    etag: loaded.etag,
  };
}
/** Rewrites the draft's fields under the caller's ETag, refiles it, then retitles its thread. */
export async function updateDraft(
  store: MailStore,
  root: string,
  draft: SavedDraft,
  input: DraftInput,
  at: Date,
): Promise<SavedDraft> {
  const fields = draftFields(input);
  const { loaded, message } = await loadDraft(store, root, draft.iri, draft.etag);
  write(message, fields, at);
  await store.save(loaded);
  // Repairs a Drafts entry lost to an earlier partial create.
  await fileUnderFolder(store, root, "drafts", draft.iri, true);
  const thread = message.partOfThread;
  if (thread && isAppDraft(root, thread, "threads"))
    await store.mutate(documentOf(thread), (mailbox) => {
      const found = mailbox.findThread(thread);
      if (found) found.title = fields.subject || "(No subject)";
    });
  return { iri: draft.iri, etag: loaded.etag };
}
/**
 * Demo-only filing, with no delivery transport. The message's caller-supplied ETag guards
 * the transition; shared folder writes use fresh validators and bounded conflict retries.
 * As with draft saves, cross-document failures may leave partial writes: callers reload.
 */
export async function sendDemoDraft(
  store: MailStore,
  root: string,
  draft: SavedDraft,
  now: Date,
): Promise<string> {
  if (!Number.isFinite(now.getTime())) throw new TypeError("Invalid send date");
  const { loaded, message } = await loadDraft(store, root, draft.iri, draft.etag);
  const fields = draftFields({
    to: [...message.to].map(address),
    cc: [...message.cc].map(address),
    subject: message.subjectLine ?? "",
    text: message.body ?? "",
  });
  if (fields.to.length + fields.cc.length === 0) throw new TypeError("Add at least one recipient");
  const threadIri =
    message.partOfThread ?? `${root}threads/${draft.iri.slice(`${root}messages/`.length)}`;
  if (!isAppDraft(root, threadIri, "threads")) throw new TypeError("Invalid draft thread");
  const threadDoc = await store.load(documentOf(threadIri), true);
  const thread = threadDoc.mailbox.createThread(threadIri);
  thread.title = fields.subject || "(No subject)";
  thread.created ??= now;
  thread.modified = now;
  thread.addMessage(draft.iri);
  write(message, fields, now);
  // A draft may know its own email address. A WebID alone is not a From address.
  if (!/^mailto:/i.test(message.sender ?? "")) message.sender = undefined;
  message.partOfThread = threadIri;
  message.folderIris.delete(draftsFolder(root));
  message.folderIris.add(`${systemFolderDocument(root, "sent")}#it`);
  // Claim the draft version first: a racing send/save must fail before touching folders.
  await store.save(loaded);
  await store.save(threadDoc);
  await fileUnderFolder(store, root, "sent", draft.iri, true);
  await fileUnderFolder(store, root, "drafts", draft.iri, false);
  return draft.iri;
}
/**
 * Discards a draft: leaves Drafts first, so a failed delete leaves a harmless orphan rather than
 * a folder entry pointing at a missing document; then deletes the message (under the caller's
 * ETag) and the draft's own thread document.
 */
export async function discardDraft(
  store: MailStore,
  root: string,
  draft: SavedDraft,
  remove: (url: string, etag: string | null) => Promise<void>,
): Promise<void> {
  const { loaded, message } = await loadDraft(store, root, draft.iri, draft.etag);
  await fileUnderFolder(store, root, "drafts", draft.iri, false);
  await remove(documentOf(draft.iri), loaded.etag);
  const thread = message.partOfThread;
  if (thread && isAppDraft(root, thread, "threads")) await remove(documentOf(thread), null);
}
