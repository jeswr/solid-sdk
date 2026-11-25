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
/**
 * Type Index registration is discovery metadata, never a precondition for using boards.
 * `unavailable`: the WebID profile is outside this storage, so there is no index to use.
 * `failed` keeps only the error code.
 */
export type WhiteboardRegistration =
  | { state: "registered" }
  | { state: "unavailable" }
  | { state: "failed"; reason: string };
export class WhiteboardRepository extends DrawingIO {
  registration: WhiteboardRegistration = { state: "unavailable" };
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
/** Definite "no usable index" outcomes. Anything else (network, timeout, 5xx, unknown) is
 * transient: it must surface, never lead to creating or registering a second collection. */
function indexUnusable(error: unknown): boolean {
  return (
    error instanceof StorageError &&
    ["not-found", "scope", "forbidden", "unsupported", "invalid-response", "not-rdf"].includes(
      error.code,
    )
  );
}
export async function prepareWhiteboards(
  storage: StorageClient,
  index: TypeIndex | undefined,
): Promise<WhiteboardRepository> {
  let container = new URL("whiteboards/", storage.root).href;
  // A definitive failure (absent, out-of-scope, forbidden or malformed index) only means there
  // is no usable index: the conventional folder is used instead. A transient failure surfaces,
  // so a registered folder is never missed and a duplicate created and registered.
  let locations: string[] = [];
  try {
    locations = (await index?.find(DRAW_SCENE_IRI)) ?? [];
  } catch (error) {
    if (!indexUnusable(error)) throw error;
  }
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
  // Registration is best-effort: a failure leaves the boards readable and writable. Only the
  // private index is ever targeted.
  let registration: WhiteboardRegistration = { state: "unavailable" };
  let hint: Awaited<ReturnType<TypeIndex["register"]>>;
  if (index) {
    try {
      hint = await index.register(DRAW_SCENE_IRI, { container }, { index: "private" });
      registration = { state: "registered" };
    } catch (error) {
      registration = {
        state: "failed",
        reason: error instanceof StorageError ? error.code : "unknown",
      };
    }
  }
  const repository = new WhiteboardRepository(storage, container, hint);
  repository.registration = registration;
  return repository;
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
  // A WebID outside this storage cannot be registered through it (`scope`); boards still work.
  let index: TypeIndex | undefined;
  try {
    index = createTypeIndex({
      storage: client.storage,
      features: client.features,
      profile: session.webId,
      fetch: freshFetch,
    });
  } catch (error) {
    if (!(error instanceof StorageError) || error.code !== "scope") throw error;
  }
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
