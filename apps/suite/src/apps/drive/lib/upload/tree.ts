// AUTHORED-BY Codex GPT-6.1-Sol
import { normalizeUploadName } from "./names";
import type { DroppedEntry, ExistingEntry, FolderChange, UploadKind, UploadPath } from "./types";
import { byteSize, hasControls, kind, path, record, requireValue } from "./validation";

interface Node {
  readonly kind: UploadKind;
  readonly path: UploadPath;
}

interface Drop extends Node {
  readonly sourcePath: UploadPath;
  readonly size: number;
}

interface Trees {
  readonly drops: readonly Drop[];
  readonly nodes: ReadonlyMap<string, Node>;
  readonly existing: ReadonlyMap<string, ExistingEntry>;
}

export function pathKey(parts: UploadPath): string {
  return parts.map((part) => encodeURIComponent(part)).join("/");
}

export function buildTrees(
  entries: readonly DroppedEntry[],
  listing: readonly ExistingEntry[],
): Trees {
  requireValue(Array.isArray(entries) && Array.isArray(listing), "invalid-input");
  const existing = new Map<string, ExistingEntry>();
  for (const item of listing) {
    record(item, ["kind", "path", "etag"]);
    kind(item.kind);
    path(item.path);
    requireValue(
      item.path.every((part) => !part.includes("/") && !part.includes("\\") && !hasControls(part)),
      "invalid-listing",
    );
    if ("etag" in item) {
      requireValue(
        typeof item.etag === "string" && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(item.etag),
        "invalid-listing",
      );
    }
    const key = pathKey(item.path);
    requireValue(!existing.has(key), "invalid-listing");
    existing.set(key, {
      kind: item.kind,
      path: [...item.path],
      ...("etag" in item ? { etag: item.etag as string } : {}),
    });
  }
  for (const item of existing.values()) {
    for (let depth = 1; depth < item.path.length; depth += 1) {
      requireValue(
        existing.get(pathKey(item.path.slice(0, depth)))?.kind === "folder",
        "invalid-listing",
      );
    }
  }

  const nodes = new Map<string, Node>();
  const folderSources = new Map<string, string>();
  const sourcePaths = new Set<string>();
  const drops: Drop[] = [];
  for (const item of entries) {
    record(item, ["kind", "path", "size"]);
    kind(item.kind);
    path(item.path);
    let size = 0;
    if (item.kind === "file") {
      byteSize(item.size);
      size = item.size;
    } else {
      requireValue(!("size" in item), "invalid-input");
    }
    const sourceKey = JSON.stringify(item.path);
    requireValue(!sourcePaths.has(sourceKey), "ambiguous-drop");
    sourcePaths.add(sourceKey);
    const sourcePath = item.path;
    const entryKind = item.kind;
    const normalized = sourcePath.map((part, index) =>
      normalizeUploadName(part, index === sourcePath.length - 1 ? entryKind : "folder"),
    );
    for (let depth = 1; depth <= normalized.length; depth += 1) {
      const parts = normalized.slice(0, depth);
      const entryKind = depth === normalized.length ? item.kind : "folder";
      const key = pathKey(parts);
      const previous = nodes.get(key);
      requireValue(!previous || previous.kind === entryKind, "kind-conflict");
      const remote = existing.get(key);
      requireValue(!remote || remote.kind === entryKind, "kind-conflict");
      if (entryKind === "folder") {
        const source = JSON.stringify(item.path.slice(0, depth));
        const previousSource = folderSources.get(key);
        requireValue(previousSource === undefined || previousSource === source, "ambiguous-drop");
        folderSources.set(key, source);
      }
      nodes.set(key, { kind: entryKind, path: parts });
    }
    drops.push({ kind: item.kind, sourcePath: [...item.path], path: normalized, size });
  }
  return { drops, nodes, existing };
}

export function folderChanges(trees: Trees): readonly FolderChange[] {
  return [...trees.nodes.values()]
    .filter((node) => node.kind === "folder")
    .sort((a, b) => (a.path.join("\0") < b.path.join("\0") ? -1 : 1))
    .map((node) => ({
      path: [...node.path],
      targetPath: `${pathKey(node.path)}/`,
      action: trees.existing.has(pathKey(node.path)) ? "skip" : "create",
    }));
}

/** Infer dropped parent folders; diff only folders touched by this drop, without writes/deletes. */
export function diffFolderTree(
  entries: readonly DroppedEntry[],
  existing: readonly ExistingEntry[],
): readonly FolderChange[] {
  return folderChanges(buildTrees(entries, existing));
}
