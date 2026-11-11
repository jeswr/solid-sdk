// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
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
/** Purge only an account that has signed out, even when another account is active. */
export function purgeDraftOwner(storage: DraftStorage, owner: string): void {
  const prefix = `${PREFIX}${encodeURIComponent(owner)}:`;
  const keys: string[] = [];
  for (let i = 0; i < (storage.length ?? 0); i++) {
    const name = storage.key?.(i);
    if (name?.startsWith(prefix)) keys.push(name);
  }
  for (const name of keys) storage.removeItem(name);
  if (storage.getItem(OWNER_KEY) === owner) storage.setItem(OWNER_KEY, "");
}
/** Every account with stored drafts, including accounts that signed out while the app was closed. */
export function draftOwners(storage: DraftStorage): string[] {
  const owners = new Set<string>();
  for (let i = 0; i < (storage.length ?? 0); i++) {
    const name = storage.key?.(i);
    if (!name?.startsWith(PREFIX)) continue;
    const end = name.indexOf(":", PREFIX.length);
    if (end <= PREFIX.length) continue;
    try {
      owners.add(decodeURIComponent(name.slice(PREFIX.length, end)));
    } catch {
      // A malformed key cannot belong to a signed-in account's write path.
    }
  }
  return [...owners];
}
/** Switching accounts changes the write fence without discarding either account's drafts. */
export function activateDraftOwner(storage: DraftStorage, owner: string | null): void {
  const previous = storage.getItem(OWNER_KEY);
  if (owner === null && previous) purgeDraftOwner(storage, previous);
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
        (b.descriptorEtag !== null && typeof b.descriptorEtag !== "string") ||
        (b.descriptorText !== undefined && typeof b.descriptorText !== "string")
      )
        throw new Error("Invalid draft");
      return {
        id: b.id,
        title: b.title,
        descriptor: b.descriptor,
        blob: b.blob,
        etag: b.etag,
        descriptorEtag: b.descriptorEtag,
        ...(b.descriptorText === undefined ? {} : { descriptorText: b.descriptorText }),
        metadata: b.metadata,
        scene: parseScene(b.json),
      };
    });
  } catch {
    return [];
  }
}
/** False means storage failed; fenced callbacks are intentionally silent. */
export function writeDrafts(
  storage: DraftStorage,
  owner: string,
  root: string,
  boards: Board[],
): boolean | "fenced" {
  try {
    const active = storage.getItem(OWNER_KEY);
    if (!owner || (active !== null && active !== owner)) return "fenced";
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
