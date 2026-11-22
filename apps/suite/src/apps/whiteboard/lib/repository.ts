// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { createTypeIndex, type TypeIndex } from "@jeswr/pod-type-index";
import { DRAW_SCENE_IRI } from "@jeswr/solid-drawing";
import { createPodClient, type StorageClient, StorageError } from "@jeswr/storage-client";
import type { PodSession } from "@/lib/session/pod-session";
import { drawingDemoTransport } from "../demo/transport";
import type { Board } from "./drawing-io";
import { DrawingIO } from "./drawing-io";

export type { Board } from "./drawing-io";
export class WhiteboardRepository extends DrawingIO {
  readonly unreadable: string[] = [];
  truncated = false;
  async list(): Promise<Board[]> {
    const boards: Board[] = [];
    this.unreadable.length = 0;
    let scanned = 0;
    this.truncated = false;
    for await (const entry of this.storage.listAll(this.container, { maxBytes: 2 * 1024 * 1024 })) {
      if (
        entry.kind !== "resource" ||
        !(entry.url.endsWith(".ttl") || entry.types.includes(DRAW_SCENE_IRI))
      )
        continue;
      if (++scanned > 100) {
        this.truncated = true;
        break;
      }
      try {
        boards.push(await this.read(entry.url));
      } catch {
        this.unreadable.push(entry.url);
      }
    }
    return boards.sort((a, b) => a.title.localeCompare(b.title));
  }
}
export async function prepareWhiteboards(
  storage: StorageClient,
  index: TypeIndex,
): Promise<WhiteboardRepository> {
  let container = new URL("whiteboards/", storage.root).href;
  const locations = await index.find(DRAW_SCENE_IRI);
  for (const url of locations.slice(0, 100)) {
    if (storage.isWithinStorage(url) && (await storage.head(url)).kind === "container") {
      container = url;
      break;
    }
  }
  try {
    await storage.head(container);
  } catch (error) {
    if (!(error instanceof StorageError) || error.code !== "not-found") throw error;
    try {
      container = (
        await storage.create(storage.root, null, { name: "whiteboards", kind: "container" })
      ).url;
    } catch (created) {
      if (!(created instanceof StorageError) || created.code !== "conflict") throw created;
      await storage.head(container);
    }
  }
  const hint = await index.register(DRAW_SCENE_IRI, { container }, { index: "private" });
  return new WhiteboardRepository(storage, container, hint);
}
export async function openWhiteboards(session: PodSession) {
  const fetch =
    session.mode === "demo"
      ? drawingDemoTransport(session.fetch, session.storageUrl)
      : session.fetch;
  // Read-back certification must bypass the browser HTTP cache.
  const freshFetch: typeof globalThis.fetch = (input, init) =>
    fetch(input, { ...init, cache: "no-store" });
  const client = await createPodClient({ fetch: freshFetch, storage: session.storageUrl });
  const index = createTypeIndex({
    storage: client.storage,
    features: client.features,
    profile: session.webId,
    fetch: freshFetch,
  });
  return prepareWhiteboards(client.storage, index);
}
export function isConflict(error: unknown): boolean {
  return error instanceof StorageError && error.code === "precondition-failed";
}

export type BoardAccess = Pick<WhiteboardRepository, "save" | "read">;
/** Retained drafts remain editable before a disconnected pod can be opened. */
export const disconnectedBoards: BoardAccess = {
  async save() {
    throw new Error("Reconnect to save this board");
  },
  async read() {
    throw new Error("Reconnect to load the other version");
  },
};
