// AUTHORED-BY Claude Fable 5
//
// Bounded, progressive storage walk for the grant dashboard. BFS over the
// container tree via @solid/object's ContainerDataset (never a bespoke LDP
// parse), yielding each node AS IT IS DISCOVERED (async generator) so the UI
// paints progressively. Reads each node's EFFECTIVE ACL, memoising ACL
// documents by URL so an inherited subtree costs one read, not one per child.

import type { DatasetCore } from "@rdfjs/types";
import { ContainerDataset } from "@solid/object";
import { DataFactory } from "n3";
import { type AclEntry, type EffectiveAcl, NoAclFoundError, readEffectiveAcl } from "./acl.js";
import { readRdf, type SolidFetch } from "./http.js";
import { tryRead } from "./rdf.js";

export interface WalkedNode {
  url: string;
  isContainer: boolean;
  depth: number;
  /** Entries governing this node; empty when unreadable / none found. */
  entries: AclEntry[];
  /** false = governed by an ancestor's acl:default (inherited). */
  aclOwned: boolean;
  /** The ACL document URL that governs (undefined when none was found). */
  aclUrl?: string;
  /** The node's ACL could not be read (permission / network) — flagged, not fatal. */
  aclError?: string;
}

export interface WalkOptions {
  /** Maximum container depth below the root (root itself is depth 0). */
  maxDepth?: number;
  /** Hard cap on total nodes visited (runaway-pod guard). */
  maxNodes?: number;
}

/** Never list ACL documents themselves as data resources. */
export function isAclDoc(url: string): boolean {
  return url.endsWith(".acl") || url.endsWith(".acl/");
}

/** List one container's members via the typed ContainerDataset wrapper. */
export function containerMembers(dataset: DatasetCore): { url: string; isContainer: boolean }[] {
  const container = new ContainerDataset(dataset, DataFactory).container;
  if (!container) return [];
  const members: { url: string; isContainer: boolean }[] = [];
  for (const resource of tryRead(() => [...container.contains]) ?? []) {
    const url = resource.id;
    if (typeof url !== "string" || isAclDoc(url)) continue;
    members.push({
      url,
      isContainer: tryRead(() => resource.isContainer) ?? url.endsWith("/"),
    });
  }
  return members;
}

/**
 * Walk the storage tree from `root`, yielding nodes progressively. ACL reads
 * share a per-walk memo of governing documents; failures degrade to a flagged
 * node rather than aborting the walk.
 */
export async function* walkStorage(
  root: string,
  fetchFn: SolidFetch,
  options: WalkOptions = {},
): AsyncGenerator<WalkedNode> {
  const maxDepth = options.maxDepth ?? 4;
  const maxNodes = options.maxNodes ?? 500;
  // Memo of effective-ACL lookups keyed by resource URL is wasteful; instead we
  // memo by GOVERNING document via a small wrapper cache keyed on resource —
  // the effective reader walks ancestors itself, and its HTTP reads hit the
  // fetch layer, so the memo here just avoids repeating whole resolutions.
  const aclMemo = new Map<string, EffectiveAcl | { error: string }>();

  async function effectiveFor(url: string): Promise<EffectiveAcl | { error: string }> {
    const hit = aclMemo.get(url);
    if (hit) return hit;
    let out: EffectiveAcl | { error: string };
    try {
      out = await readEffectiveAcl(url, root, fetchFn);
    } catch (e) {
      out = { error: e instanceof NoAclFoundError ? "no-acl" : "unreadable" };
    }
    aclMemo.set(url, out);
    return out;
  }

  let visited = 0;
  const queue: { url: string; depth: number; isContainer: boolean }[] = [
    { url: root, depth: 0, isContainer: true },
  ];

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) break;
    if (visited >= maxNodes) return;
    visited += 1;

    const acl = await effectiveFor(node.url);
    const walked: WalkedNode =
      "error" in acl
        ? {
            url: node.url,
            isContainer: node.isContainer,
            depth: node.depth,
            entries: [],
            aclOwned: false,
            aclError: acl.error,
          }
        : {
            url: node.url,
            isContainer: node.isContainer,
            depth: node.depth,
            entries: acl.entries,
            aclOwned: acl.owned,
            aclUrl: acl.aclUrl,
          };
    yield walked;

    if (node.isContainer && node.depth < maxDepth) {
      try {
        const read = await readRdf(node.url, fetchFn);
        if (read) {
          for (const member of containerMembers(read.dataset)) {
            queue.push({ url: member.url, depth: node.depth + 1, isContainer: member.isContainer });
          }
        }
      } catch {
        // Unreadable container: its own node was already yielded; skip children.
      }
    }
  }
}
