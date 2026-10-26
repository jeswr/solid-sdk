// AUTHORED-BY Codex GPT-6.1-Sol
import { buildContainers, type Container, container, prune } from "./containers";
import { subjectInfo } from "./subject";
import type { MailThread, ThreadMessage, ThreadNode } from "./types";
import { compareId, compareMessages, validateMessages } from "./validation";

function firstMessage<T extends ThreadMessage>(root: Container<T>): T {
  if (root.message) return root.message;
  // After pruning, dummy roots have at least two real children.
  // biome-ignore lint/style/noNonNullAssertion: Pruning guarantees nonempty, real children here.
  return [...root.children].sort((a, b) => compareMessages(a.message!, b.message!))[0]!.message!;
}

function mergeSubjects<T extends ThreadMessage>(roots: Container<T>[]): Container<T>[] {
  roots.sort((a, b) => compareMessages(firstMessage(a), firstMessage(b)));
  const entries = roots.map((root) => ({ root, ...subjectInfo(firstMessage(root).subject) }));
  const subjects = new Map<string, (typeof entries)[number]>();
  for (const entry of entries) {
    if (!entry.base) continue;
    const old = subjects.get(entry.base);
    if (
      !old ||
      (!entry.root.message && old.root.message) ||
      (entry.root.message && old.root.message && old.isReply && !entry.isReply)
    ) {
      subjects.set(entry.base, entry);
    }
  }
  const removed = new Set<Container<T>>();
  for (const entry of entries) {
    const chosen = subjects.get(entry.base);
    if (!chosen || chosen === entry) continue;
    const target = chosen.root;
    const source = entry.root;
    removed.add(source);
    if (!source.message && !target.message) {
      for (const child of source.children) {
        target.children.push(child);
        child.parent = target;
      }
    } else if (!target.message || (entry.isReply && !chosen.isReply)) {
      target.children.push(source);
      source.parent = target;
    } else {
      // Neither root is a reply to the other: preserve both under a synthetic parent.
      const parent = container<T>(null);
      parent.children.push(target, source);
      target.parent = parent;
      source.parent = parent;
      removed.add(target);
      roots.push(parent);
      chosen.root = parent;
    }
  }
  return roots.filter((root) => !removed.has(root));
}

function summarize<T extends ThreadMessage>(root: Container<T>): MailThread<T> {
  const tree: ThreadNode<T> = { message: root.message, children: [] };
  const queue = [{ source: root, output: tree }];
  const messages: T[] = [];
  for (const { source, output } of queue) {
    if (source.message) messages.push(source.message);
    source.children.sort((a, b) => compareMessages(firstMessage(a), firstMessage(b)));
    for (const child of source.children) {
      const next: ThreadNode<T> = { message: child.message, children: [] };
      output.children.push(next);
      queue.push({ source: child, output: next });
    }
  }
  messages.sort(compareMessages);
  // biome-ignore lint/style/noNonNullAssertion: Every pruned root contains at least one message.
  const latest = messages[messages.length - 1]!;
  const participants = new Set<string>();
  let unreadCount = 0;
  let id = firstMessage(root).id;
  for (const message of messages) {
    if (compareId(message.id, id) < 0) id = message.id;
    participants.add(message.from);
    for (const recipient of message.to) participants.add(recipient);
    for (const recipient of message.cc ?? []) participants.add(recipient);
    if (!message.isRead) unreadCount++;
  }
  return {
    id,
    root: tree,
    subject: subjectInfo(firstMessage(root).subject).base,
    messages,
    latestTimestamp: latest.timestamp,
    participants: [...participants].sort(compareId),
    unreadCount,
    snippet: Array.from(latest.text.replace(/\s+/gu, " ").trim()).slice(0, 160).join(""),
  };
}

/** JWZ containers and subject fallback; newest conversations first. Never mutates inputs. */
export function buildThreads<T extends ThreadMessage>(messages: readonly T[]): MailThread<T>[] {
  const roots = buildContainers(validateMessages(messages));
  prune(roots);
  return mergeSubjects(roots)
    .map(summarize)
    .sort((a, b) => b.latestTimestamp - a.latestTimestamp || compareId(a.id, b.id));
}
