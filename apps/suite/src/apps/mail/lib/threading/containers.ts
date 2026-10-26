// AUTHORED-BY Codex GPT-6.1-Sol
import type { ThreadMessage } from "./types";

export interface Container<T extends ThreadMessage> {
  message: T | null;
  parent: Container<T> | null;
  children: Container<T>[];
}

export function container<T extends ThreadMessage>(message: T | null): Container<T> {
  return { message, parent: null, children: [] };
}

/** Only attach unparented nodes; skip both self-links and ancestor loops. */
function link<T extends ThreadMessage>(parent: Container<T>, child: Container<T>): void {
  if (child.parent) return;
  for (let ancestor: Container<T> | null = parent; ancestor; ancestor = ancestor.parent) {
    if (ancestor === child) return;
  }
  child.parent = parent;
  parent.children.push(child);
}

export function buildContainers<T extends ThreadMessage>(messages: T[]): Container<T>[] {
  const table = new Map<string, Container<T>>();
  const all: Container<T>[] = [];
  function create(message: T | null): Container<T> {
    const node = container(message);
    all.push(node);
    return node;
  }
  function lookup(id: string): Container<T> {
    let node = table.get(id);
    if (!node) {
      node = create(null);
      table.set(id, node);
    }
    return node;
  }
  for (const message of messages) {
    let node: Container<T>;
    if (message.messageId === undefined) {
      node = create(message);
    } else {
      node = lookup(message.messageId);
      if (node.message) node = create(message);
      else node.message = message;
    }
    const references = message.references?.length
      ? message.references
      : message.inReplyTo === undefined
        ? []
        : [message.inReplyTo];
    let parent: Container<T> | null = null;
    for (const reference of references) {
      const current = lookup(reference);
      if (parent) link(parent, current);
      parent = current;
    }
    // A message's own ancestry overrides links inferred from another References chain.
    if (node.parent) {
      node.parent.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = null;
    }
    if (parent) link(parent, node);
  }
  return all.filter((node) => !node.parent);
}

/** Iterative postorder pruning keeps deep imported threads off the JS call stack. */
export function prune<T extends ThreadMessage>(roots: Container<T>[]): void {
  const order = [...roots];
  for (const node of order) {
    for (const child of node.children) order.push(child);
  }
  for (const node of order.reverse()) {
    if (node.message || (!node.parent && node.children.length > 1)) continue;
    const siblings = node.parent ? node.parent.children : roots;
    siblings.splice(siblings.indexOf(node), 1);
    for (const child of node.children) {
      child.parent = node.parent;
      siblings.push(child);
    }
  }
}
