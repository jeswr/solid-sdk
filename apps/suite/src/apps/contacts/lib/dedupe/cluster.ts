// AUTHORED-BY Codex GPT-6.1-Sol
import type { ContactCluster, DedupeContact, DedupeOptions } from "./types";
import { type PreparedContact, prepareContacts } from "./validation";

class Node {
  parent: Node = this;
  size = 1;
  constructor(readonly contact: PreparedContact) {}
}

function find(node: Node): Node {
  while (node.parent !== node) {
    node.parent = node.parent.parent;
    node = node.parent;
  }
  return node;
}

function union(a: Node, b: Node): void {
  let left = find(a);
  let right = find(b);
  if (left === right) return;
  if (left.size < right.size) [left, right] = [right, left];
  right.parent = left;
  left.size += right.size;
}

/** Input must already be ID-sorted and validated. Names never establish identity. */
export function partition(contacts: PreparedContact[]): PreparedContact[][] {
  const nodes = contacts.map((contact) => new Node(contact));
  const seen = new Map<string, Node>();
  for (const node of nodes) {
    for (const field of ["webIds", "emails", "phones"] as const) {
      for (const value of node.contact[field]) {
        // Namespace each signal, so unrelated identity types cannot collide.
        const key = `${field}:${value}`;
        const previous = seen.get(key);
        if (previous) union(node, previous);
        else seen.set(key, node);
      }
    }
  }
  const groups = new Map<Node, PreparedContact[]>();
  for (const node of nodes) {
    const root = find(node);
    const group = groups.get(root);
    if (group) group.push(node.contact);
    else groups.set(root, [node.contact]);
  }
  // Insertion order follows the first (lowest-ID) member of each cluster.
  return [...groups.values()];
}

export function clusterContacts(
  contacts: readonly DedupeContact[],
  options: DedupeOptions = {},
): ContactCluster[] {
  return partition(prepareContacts(contacts, options)).map((members) => ({
    id: (members[0] as PreparedContact).id,
    contactIds: members.map((member) => member.id),
  }));
}
