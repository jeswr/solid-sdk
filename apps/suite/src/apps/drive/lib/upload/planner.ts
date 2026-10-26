// AUTHORED-BY Codex GPT-6.1-Sol
import { planChunks } from "./chunks";
import { keepBothName } from "./names";
import { buildTrees, folderChanges, pathKey } from "./tree";
import type { PlannedFile, UploadPlan, UploadPlanInput } from "./types";
import { chunkSize, record, requireValue, targetContainer } from "./validation";

/** Pure snapshot plan. Callers execute folders first and honour every write precondition. */
export function planUploads(input: UploadPlanInput): UploadPlan {
  record(input, ["targetContainer", "entries", "existing", "policy", "chunkSize"]);
  targetContainer(input.targetContainer);
  chunkSize(input.chunkSize);
  requireValue(["keep-both", "replace", "skip"].includes(input.policy), "invalid-input");
  const trees = buildTrees(input.entries, input.existing);
  const folders = folderChanges(trees).map((folder) => ({
    ...folder,
    targetUrl: input.targetContainer + folder.targetPath,
  }));
  const occupied = new Map<string, Set<string>>();
  const reserve = (parts: readonly string[]) => {
    const parent = pathKey(parts.slice(0, -1));
    let names = occupied.get(parent);
    if (!names) {
      names = new Set();
      occupied.set(parent, names);
    }
    names.add(parts[parts.length - 1] as string);
  };
  for (const item of trees.existing.values()) reserve(item.path);
  for (const item of trees.nodes.values()) {
    if (item.kind === "folder") reserve(item.path);
  }

  const pending = new Set<string>();
  const files: PlannedFile[] = [];
  for (const drop of trees.drops) {
    if (drop.kind === "folder") continue;
    const parts = [...drop.path];
    const parent = pathKey(parts.slice(0, -1));
    const names = occupied.get(parent) ?? new Set<string>();
    const name = parts[parts.length - 1] as string;
    let operation: PlannedFile["operation"] = { action: "create", ifNoneMatch: "*" };
    if (names.has(name)) {
      if (input.policy === "keep-both") {
        parts[parts.length - 1] = keepBothName(name, [...names]);
      } else if (input.policy === "skip") {
        operation = { action: "skip" };
      } else {
        const key = pathKey(parts);
        requireValue(!pending.has(key), "ambiguous-drop");
        const etag = trees.existing.get(key)?.etag;
        requireValue(etag !== undefined, "missing-etag");
        operation = { action: "replace", ifMatch: etag };
      }
    }
    const targetPath = pathKey(parts);
    // Folder names were reserved above, so numbered candidates cannot overwrite them.
    if (operation.action !== "skip") {
      reserve(parts);
      pending.add(targetPath);
    }
    files.push({
      sourcePath: [...drop.sourcePath],
      path: parts,
      targetPath,
      targetUrl: input.targetContainer + targetPath,
      size: drop.size,
      chunks: operation.action === "skip" ? [] : planChunks(drop.size, input.chunkSize),
      operation,
    });
  }
  return { folders, files };
}
