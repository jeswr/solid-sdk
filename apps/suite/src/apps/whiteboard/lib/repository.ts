// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  emptyScene,
  newId,
  parseSceneStream,
  type Scene,
  serializeScene,
} from "@jeswr/excalidraw-scene";
import { createTypeIndex, type TypeHint, type TypeIndex } from "@jeswr/pod-type-index";
import {
  DRAW_SCENE_IRI,
  serializeScene as descriptorTtl,
  parseSceneTtl,
  type SceneData,
} from "@jeswr/solid-drawing";
import {
  createPodClient,
  type StorageClient,
  StorageError,
  type WriteResult,
} from "@jeswr/storage-client";
import type { PodSession } from "@/lib/session/pod-session";
import { drawingDemoTransport } from "../demo/transport";
export interface Board {
  id: string;
  title: string;
  scene: Scene;
  descriptor: string;
  blob: string;
  etag: string | null;
  descriptorEtag: string | null;
  metadata: SceneData;
}
function validator(etag: string | null): string {
  if (!etag || etag.startsWith("W/"))
    throw new Error("Your pod did not provide a safe version for this board");
  return etag;
}
function responseVersion(result: WriteResult): string | null {
  // A follow-up HEAD may describe another writer's bytes. Never adopt it for a write.
  return result.etagSource === "response" ? result.etag : null;
}
export class WhiteboardRepository {
  readonly unreadable: string[] = [];
  constructor(
    readonly storage: StorageClient,
    readonly container: string,
    private hint?: TypeHint,
  ) {}
  async read(url: string): Promise<Board> {
    const description = await this.storage.read(url, { accept: "text/turtle" });
    const metadata = await parseSceneTtl(url, await description.text(), description.contentType);
    if (!metadata) throw new TypeError("This board has an invalid drawing descriptor");
    if (!this.storage.isWithinStorage(metadata.sceneDocument))
      throw new Error("This canvas is outside your pod");
    const canvas = await this.storage.read(metadata.sceneDocument, { accept: "application/json" });
    return {
      id: url,
      title: metadata.title ?? "Untitled board",
      scene: await parseSceneStream(canvas.body),
      descriptor: url,
      blob: metadata.sceneDocument,
      etag: canvas.etag,
      descriptorEtag: description.etag,
      metadata,
    };
  }
  async list(): Promise<Board[]> {
    const boards: Board[] = [];
    this.unreadable.length = 0;
    let scanned = 0;
    for await (const entry of this.storage.listAll(this.container, { maxBytes: 2 * 1024 * 1024 })) {
      if (
        entry.kind !== "resource" ||
        !(entry.url.endsWith(".ttl") || entry.types.includes(DRAW_SCENE_IRI))
      )
        continue;
      if (++scanned > 100) throw new Error("This first cut supports up to 100 boards");
      try {
        boards.push(await this.read(entry.url));
      } catch (error) {
        if (error instanceof TypeError) this.unreadable.push(entry.url);
        else throw error;
      }
    }
    return boards.sort((a, b) => a.title.localeCompare(b.title));
  }
  async create(title: string, scene: Scene = emptyScene()): Promise<Board> {
    const titleValue = title.trim().slice(0, 200) || "Untitled board";
    const id = newId();
    const blob = await this.storage.create(this.container, serializeScene(scene), {
      name: `${id}.excalidraw`,
      contentType: "application/json",
    });
    // Allocate before naming the descriptor subject: storage may assign its own URL.
    const descriptor = await this.storage.create(this.container, "", {
      name: `${id}.ttl`,
      contentType: "text/turtle",
      ...this.hint,
    });
    const fresh = await this.storage.read(descriptor.url);
    if ((await fresh.text()) !== "")
      throw new Error("The new descriptor changed before it could be initialised");
    const metadata: SceneData = {
      sceneDocument: blob.url,
      title: titleValue,
      created: new Date().toISOString(),
      schemaVersion: "2",
    };
    const written = await this.storage.write(
      descriptor.url,
      await descriptorTtl(descriptor.url, metadata),
      { contentType: "text/turtle", ifMatch: validator(fresh.etag) },
    );
    return {
      id: descriptor.url,
      title: titleValue,
      scene,
      descriptor: descriptor.url,
      blob: blob.url,
      etag: responseVersion(blob),
      descriptorEtag: responseVersion(written),
      metadata,
    };
  }
  async save(board: Board, scene: Scene, keepalive = false): Promise<Board> {
    const json = serializeScene(scene);
    const result = await this.storage.write(board.blob, json, {
      contentType: "application/json",
      ifMatch: validator(board.etag),
      keepalive: keepalive && new TextEncoder().encode(json).length <= 65536,
    });
    return { ...board, scene, etag: responseVersion(result) };
  }
  async rename(board: Board, title: string): Promise<Board> {
    const value = title.trim().slice(0, 200);
    if (!value) throw new TypeError("Enter a board name");
    const metadata = { ...board.metadata, title: value, modified: new Date().toISOString() };
    const result = await this.storage.write(
      board.descriptor,
      await descriptorTtl(board.descriptor, metadata),
      { contentType: "text/turtle", ifMatch: validator(board.descriptorEtag) },
    );
    return { ...board, title: value, metadata, descriptorEtag: responseVersion(result) };
  }
  async remove(board: Board): Promise<void> {
    const ownsCanvas = (await this.storage.parentOf(board.blob)) === this.container;
    // Delete the descriptor first; an orphan blob is preferable to a broken visible board.
    await this.storage.delete(board.descriptor, { ifMatch: validator(board.descriptorEtag) });
    if (ownsCanvas) await this.storage.delete(board.blob, { ifMatch: validator(board.etag) });
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
  const client = await createPodClient({ fetch, storage: session.storageUrl });
  const index = createTypeIndex({
    storage: client.storage,
    features: client.features,
    profile: session.webId,
    fetch,
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
