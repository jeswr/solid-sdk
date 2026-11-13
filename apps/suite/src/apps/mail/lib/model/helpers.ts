// AUTHORED-BY Codex GPT-6.1-Sol
import type { MailboxDataset } from "./mailbox.js";
import type { Message } from "./message.js";
import type { Thread } from "./thread.js";

/** Counts describe the loaded snapshot; dangling membership is counted but not assumed unread. */
export function folderCounts(mailbox: MailboxDataset) {
  const index = threadIndex(mailbox);
  const memberships = new Map<string, Set<string>>();
  for (const m of index.messages.values())
    for (const folder of m.folderIris) {
      if (!memberships.has(folder)) memberships.set(folder, new Set());
      memberships.get(folder)!.add(m.value);
    }
  const unreadRows = new Set(
    index.rows.filter((row) => row.messages.some((m) => !m.isRead)).map((row) => row.id),
  );
  return [...mailbox.folders].map((folder) => {
    const members = new Set([...folder.messageIris, ...(memberships.get(folder.value) ?? [])]);
    const unreadThreads = new Set<string>();
    let unread = 0;
    for (const iri of members) {
      const m = index.messages.get(iri);
      if (m && !m.isRead) unread++;
      for (const row of index.byMessage.get(iri) ?? [])
        if (unreadRows.has(row.id)) unreadThreads.add(row.id);
    }
    return {
      folder,
      total: members.size,
      unread,
      unreadThreads: unreadThreads.size,
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
export interface ThreadPageRow {
  id: string;
  thread: Thread | undefined;
  messages: Message[];
}
/** Index each membership direction once; no per-thread whole-mailbox scans. */
function threadIndex(mailbox: MailboxDataset) {
  const messages = new Map([...mailbox.messages].map((m) => [m.value, m]));
  const rows: ThreadPageRow[] = [...mailbox.threads].map((thread) => ({
    id: thread.value,
    thread,
    messages: [],
  }));
  const byThread = new Map(rows.map((row) => [row.id, row]));
  const byMessage = new Map<string, Set<ThreadPageRow>>();
  const add = (row: ThreadPageRow, message: Message) => {
    row.messages.push(message);
    if (!byMessage.has(message.value)) byMessage.set(message.value, new Set());
    byMessage.get(message.value)!.add(row);
  };
  for (const message of messages.values()) {
    const row = byThread.get(message.partOfThread as string);
    if (row) add(row, message);
  }
  for (const row of rows)
    for (const iri of row.thread!.messageIris) {
      const message = messages.get(iri);
      if (message && !byMessage.get(iri)?.has(row)) add(row, message);
    }
  for (const message of messages.values())
    if (!byMessage.has(message.value)) {
      const row = { id: message.value, thread: undefined, messages: [message] };
      rows.push(row);
      byMessage.set(message.value, new Set([row]));
    }
  return { messages, rows, byMessage };
}
export function pageThreads(mailbox: MailboxDataset, folder: string, offset = 0, limit = 50) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1)
    throw new TypeError("Invalid page");
  const members = mailbox.findFolder(folder)?.messageIris ?? new Set<string>();
  const inFolder = (m: Message) => members.has(m.value) || m.folderIris.has(folder);
  const threads = threadIndex(mailbox).rows.filter((row) => row.messages.some(inFolder));
  const dates = new Map<string, number>();
  for (const row of threads) {
    row.messages.sort((a, b) => sent(a) - sent(b) || a.value.localeCompare(b.value));
    dates.set(row.id, sent(row.messages[row.messages.length - 1]!));
  }
  threads.sort((a, b) => dates.get(b.id)! - dates.get(a.id)! || a.id.localeCompare(b.id));
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
