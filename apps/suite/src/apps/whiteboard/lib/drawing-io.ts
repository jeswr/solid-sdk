// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
/** Descriptor + blob I/O seam. Keep RDF behind solid-drawing until its codegen migration lands. */
import {
  emptyScene,
  LIMITS,
  newId,
  parseSceneStream,
  type Scene,
  serializeScene,
} from "@jeswr/excalidraw-scene";
import type { TypeHint } from "@jeswr/pod-type-index";
import {
  serializeScene as descriptorTtl,
  parseSceneTtl,
  type SceneData,
} from "@jeswr/solid-drawing";
import { type StorageClient, StorageError, type WriteResult } from "@jeswr/storage-client";
export interface Board {
  id: string;
  title: string;
  scene: Scene;
  descriptor: string;
  blob: string;
  etag: string | null;
  descriptorEtag: string | null;
  /** Exact descriptor text observed with descriptorEtag; absent in legacy drafts. */
  descriptorText?: string | undefined;
  metadata: SceneData;
}
function validator(etag: string | null): string {
  if (!etag || etag.startsWith("W/"))
    throw new Error("Your pod did not provide a safe version for this board");
  return etag;
}
export interface DrawingAccess {
  read(url: string): Promise<Board>;
  create(title: string, scene?: Scene): Promise<Board>;
  save(board: Board, scene: Scene, keepalive?: boolean): Promise<Board>;
  rename(board: Board, title: string): Promise<Board>;
  remove(board: Board): Promise<void>;
}
/** The public storage API exposes a stream but no bounded text reader. */
async function boundedText(body: ReadableStream<Uint8Array> | null, url: string): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > LIMITS.bytes) {
        throw new StorageError("payload-too-large", { url, method: "GET" });
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
const freshRead = { headers: { "Cache-Control": "no-cache, no-store" } };
export class DrawingIO implements DrawingAccess {
  constructor(
    readonly storage: StorageClient,
    readonly container: string,
    private hint?: TypeHint,
  ) {}
  /** A version is safe only when observed alongside the bytes it protects. */
  private async matchingVersion(url: string, bytes: string | undefined): Promise<string> {
    if (bytes === undefined) throw new StorageError("precondition-failed", { url, method: "GET" });
    const resource = await this.storage.read(url, freshRead);
    if (
      (await boundedText(resource.body, url)) !== bytes ||
      !resource.etag ||
      resource.etag.startsWith("W/")
    )
      throw new StorageError("precondition-failed", { url, method: "GET" });
    return resource.etag;
  }
  private async responseVersion(result: WriteResult, bytes: string): Promise<string> {
    if (result.etagSource === "response" && result.etag && !result.etag.startsWith("W/"))
      return result.etag;
    return this.matchingVersion(result.url, bytes);
  }
  async read(url: string): Promise<Board> {
    const description = await this.storage.read(url, { ...freshRead, accept: "text/turtle" });
    const descriptorText = await boundedText(description.body, url);
    const metadata = await parseSceneTtl(url, descriptorText, description.contentType);
    if (!metadata) throw new TypeError("This board has an invalid drawing descriptor");
    if (!this.storage.isWithinStorage(metadata.sceneDocument))
      throw new Error("This canvas is outside your pod");
    const canvas = await this.storage
      .read(metadata.sceneDocument, { ...freshRead, accept: "application/json" })
      .catch((error: unknown) => {
        // Only a missing descriptor means deleted; a missing canvas is a damaged board.
        if (error instanceof StorageError && error.code === "not-found")
          throw new Error("This board's canvas is missing from your pod");
        throw error;
      });
    return {
      id: url,
      title: metadata.title ?? "Untitled board",
      scene: await parseSceneStream(canvas.body),
      descriptor: url,
      blob: metadata.sceneDocument,
      etag: canvas.etag,
      descriptorEtag: description.etag,
      descriptorText,
      metadata,
    };
  }
  async create(title: string, scene: Scene = emptyScene()): Promise<Board> {
    const titleValue = title.trim().slice(0, 200) || "Untitled board";
    const id = newId();
    const json = serializeScene(scene);
    const blob = await this.storage.create(this.container, json, {
      name: `${id}.excalidraw`,
      contentType: "application/json",
    });
    // Allocate before naming the descriptor subject: storage may assign its own URL.
    const descriptor = await this.storage.create(this.container, "", {
      name: `${id}.ttl`,
      contentType: "text/turtle",
      ...this.hint,
    });
    const fresh = await this.storage.read(descriptor.url, freshRead);
    if ((await boundedText(fresh.body, descriptor.url)) !== "")
      throw new Error("The new descriptor changed before it could be initialised");
    const metadata: SceneData = {
      sceneDocument: blob.url,
      title: titleValue,
      created: new Date().toISOString(),
      schemaVersion: "2",
    };
    const ttl = await descriptorTtl(descriptor.url, metadata);
    const written = await this.storage.write(descriptor.url, ttl, {
      contentType: "text/turtle",
      ifMatch: validator(fresh.etag),
    });
    return {
      id: descriptor.url,
      title: titleValue,
      scene,
      descriptor: descriptor.url,
      blob: blob.url,
      etag: await this.responseVersion(blob, json).catch(() => null),
      descriptorEtag: await this.responseVersion(written, ttl).catch(() => null),
      descriptorText: ttl,
      metadata,
    };
  }
  async save(board: Board, scene: Scene, keepalive = false): Promise<Board> {
    const json = serializeScene(scene);
    const result = await this.storage.write(board.blob, json, {
      contentType: "application/json",
      ifMatch: board.etag
        ? validator(board.etag)
        : await this.matchingVersion(board.blob, serializeScene(board.scene)),
      keepalive: keepalive && new TextEncoder().encode(json).length <= 65536,
    });
    return { ...board, scene, etag: await this.responseVersion(result, json) };
  }
  async rename(board: Board, title: string): Promise<Board> {
    const value = title.trim().slice(0, 200);
    if (!value) throw new TypeError("Enter a board name");
    const metadata = { ...board.metadata, title: value, modified: new Date().toISOString() };
    const ttl = await descriptorTtl(board.descriptor, metadata);
    const result = await this.storage.write(board.descriptor, ttl, {
      contentType: "text/turtle",
      ifMatch: board.descriptorEtag
        ? validator(board.descriptorEtag)
        : await this.matchingVersion(board.descriptor, board.descriptorText),
    });
    return {
      ...board,
      title: value,
      metadata,
      descriptorEtag: await this.responseVersion(result, ttl),
      descriptorText: ttl,
    };
  }
  async remove(board: Board): Promise<void> {
    // Delete the descriptor first; an orphan blob is preferable to a broken visible board.
    await this.storage.delete(board.descriptor, {
      ifMatch: board.descriptorEtag
        ? validator(board.descriptorEtag)
        : await this.matchingVersion(board.descriptor, board.descriptorText),
    });
    try {
      if ((await this.storage.parentOf(board.blob)) === this.container)
        await this.storage.delete(board.blob, { ifMatch: validator(board.etag) });
    } catch {
      // Descriptor deletion committed. A failed orphan cleanup must not resurrect the board.
    }
  }
}
