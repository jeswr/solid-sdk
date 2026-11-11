// AUTHORED-BY Codex (GPT-6.1 Sol)
import { parseScene, serializeScene } from "@jeswr/excalidraw-scene";
import type { Board } from "./repository";
/** Only unsaved whiteboard snapshots, scoped to the active account and pod. */
export interface DraftStorage {
  readonly length?: number;
  key?(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const PREFIX = "whiteboard.drafts.v1:";
const OWNER_KEY = "whiteboard.drafts.owner";
/** Called on sign-out/account changes; stale asynchronous saves cannot restore another account's drafts. */
export function activateDraftOwner(storage: DraftStorage, owner: string | null): void {
  const keep = owner === null ? null : `${PREFIX}${encodeURIComponent(owner)}:`;
  for (let i = (storage.length ?? 0) - 1; i >= 0; i--) {
    const name = storage.key?.(i);
    if (name?.startsWith(PREFIX) && (!keep || !name.startsWith(keep))) storage.removeItem(name);
  }
  storage.setItem(OWNER_KEY, owner ?? "");
}
const key = (owner: string, root: string) =>
  `whiteboard.drafts.v1:${encodeURIComponent(owner)}:${encodeURIComponent(root)}`;
export function readDrafts(storage: DraftStorage, owner: string, root: string): Board[] {
  try {
    activateDraftOwner(storage, owner);
    const raw = storage.getItem(key(owner, root));
    if (!raw || raw.length > 16 * 1024 * 1024) return [];
    const envelope = JSON.parse(raw);
    if (
      envelope.owner !== owner ||
      envelope.root !== root ||
      !Array.isArray(envelope.boards) ||
      envelope.boards.length > 100
    )
      return [];
    return envelope.boards.map((b: Board & { json: string }) => {
      if (
        typeof b.id !== "string" ||
        typeof b.title !== "string" ||
        typeof b.descriptor !== "string" ||
        typeof b.blob !== "string" ||
        !b.metadata ||
        typeof b.metadata.sceneDocument !== "string" ||
        (b.etag !== null && typeof b.etag !== "string") ||
        (b.descriptorEtag !== null && typeof b.descriptorEtag !== "string")
      )
        throw new Error("Invalid draft");
      return {
        id: b.id,
        title: b.title,
        descriptor: b.descriptor,
        blob: b.blob,
        etag: b.etag,
        descriptorEtag: b.descriptorEtag,
        metadata: b.metadata,
        scene: parseScene(b.json),
      };
    });
  } catch {
    return [];
  }
}
/** Return false so the UI can explain when local retention is unavailable. */
export function writeDrafts(
  storage: DraftStorage,
  owner: string,
  root: string,
  boards: Board[],
): boolean {
  try {
    const active = storage.getItem(OWNER_KEY);
    if (!owner || (active !== null && active !== owner)) return false;
    if (!boards.length) storage.removeItem(key(owner, root));
    else
      storage.setItem(
        key(owner, root),
        JSON.stringify({
          owner,
          root,
          boards: boards.map(({ scene, ...b }) => ({ ...b, json: serializeScene(scene) })),
        }),
      );
    return true;
  } catch {
    return false;
  }
}
