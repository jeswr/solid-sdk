// AUTHORED-BY Codex GPT-6.1-Sol
import type { MailboxDataset } from "./mailbox.js";
import type { Message } from "./message.js";

/** Counts describe the loaded snapshot; dangling membership is counted but not assumed unread. */
export function folderCounts(mailbox: MailboxDataset) {
  return [...mailbox.folders].map((folder) => {
    const members = new Set(folder.messageIris);
    for (const m of mailbox.messages) if (m.folderIris.has(folder.value)) members.add(m.value);
    return {
      folder,
      total: members.size,
      unread: [...members].filter((iri) => {
        const m = mailbox.findMessage(iri);
        return m !== undefined && !m.isRead;
      }).length,
    };
  });
}
function sent(m: Message): number {
  return m.dateSent?.getTime() ?? 0;
}
export function threadMessages(mailbox: MailboxDataset, thread: string): Message[] {
  const members = mailbox.findThread(thread)?.messageIris ?? new Set<string>();
  return [...mailbox.messages]
    .filter((m) => members.has(m.value) || m.partOfThread === thread)
    .sort((a, b) => sent(a) - sent(b) || a.value.localeCompare(b.value));
}
/** Stable newest-first paging over the loaded snapshot. */
export function pageThreads(mailbox: MailboxDataset, folder: string, offset = 0, limit = 50) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1)
    throw new TypeError("Invalid page");
  const members = mailbox.findFolder(folder)?.messageIris ?? new Set<string>();
  const threads = [...mailbox.threads]
    .map((thread) => ({ thread, messages: threadMessages(mailbox, thread.value) }))
    .filter((row) => row.messages.some((m) => members.has(m.value) || m.folderIris.has(folder)))
    .sort(
      (a, b) =>
        Math.max(...b.messages.map(sent)) - Math.max(...a.messages.map(sent)) ||
        a.thread.value.localeCompare(b.thread.value),
    );
  const next = offset + limit;
  return {
    items: threads.slice(offset, next),
    total: threads.length,
    next: next < threads.length ? next : null,
  };
}
/** Update both directions, preserving other labels. */
export function setMembership(
  mailbox: MailboxDataset,
  message: string,
  folder: string,
  present: boolean,
): void {
  const m = mailbox.findMessage(message);
  const f = mailbox.findFolder(folder);
  if (!m || !f) throw new TypeError("Missing message or folder");
  if (present) {
    m.folderIris.add(folder);
    f.addMessage(message);
  } else {
    m.folderIris.delete(folder);
    f.removeMessage(message);
  }
}
export function archiveMessage(
  mailbox: MailboxDataset,
  message: string,
  inbox: string,
  archive: string,
): void {
  if (!mailbox.findFolder(inbox) || !mailbox.findFolder(archive))
    throw new TypeError("Missing archive or inbox");
  setMembership(mailbox, message, archive, true);
  setMembership(mailbox, message, inbox, false);
}
