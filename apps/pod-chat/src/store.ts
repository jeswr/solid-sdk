// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * The Pod-Chat CRUD store — the ONE place the app touches pod I/O for rooms and
 * messages.
 *
 * Storage model: one resource per room under `pod-chat/rooms/`, one resource per
 * message under `pod-chat/messages/`, both under a dedicated `pod-chat/` tree at
 * the pod root. The rooms container is registered in the user's Type Index
 * (`solid:instanceContainer` for `pc:ChatRoom`) for cross-app discovery.
 * One-resource-per-message keeps each write small and conflict-scoped, lets
 * per-message ACLs differ later, and maps onto the AS 2.0 collection model (the
 * room descriptor is a forward `as:items` index over its message resources).
 *
 * Every caller-supplied URL is scope-guarded (a confused-deputy defence) before
 * any authenticated I/O, and conditional writes (`If-Match` / `If-None-Match`)
 * prevent silent clobbering. RDF is read via `@jeswr/fetch-rdf`, listed via
 * `@solid/object`'s `ContainerDataset`, and written via `n3.Writer` — never a
 * bespoke parser.
 */
import { RdfFetchError } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { ContainerDataset } from "@solid/object";
import { DataFactory } from "n3";
import { OutOfScopeError } from "./errors.js";
import { type BuildMessageInput, buildMessage, type ChatMessage, parseMessage } from "./message.js";
import { deleteRdf, ensureContainer, nameFromUrl, readRdf, writeRdf } from "./rdf-io.js";
import { type BuildRoomInput, buildRoom, type ChatRoom, parseRoom } from "./room.js";
import { ensureTypeRegistrations } from "./type-index.js";
import { CHAT_ROOM_CLASS, PREFIXES } from "./vocab.js";

/** Container slug under the pod root where the Pod-Chat tree lives. */
export const CHAT_SLUG = "pod-chat/";
/** Sub-container (under {@link CHAT_SLUG}) holding room descriptor resources. */
export const ROOMS_SLUG = "rooms/";
/** Sub-container (under {@link CHAT_SLUG}) holding message resources. */
export const MESSAGES_SLUG = "messages/";

/** A stored room the UI consumes: stable `url`, `etag`, parsed `data`. */
export interface StoredRoom {
  url: string;
  /** ETag from the last read — pass back on save to guard against clobbering. */
  etag: string | null;
  data: ChatRoom;
}

/** A stored message the UI consumes: stable `url`, `etag`, parsed `data`. */
export interface StoredMessage {
  url: string;
  /** ETag from the last read — pass back on save to guard against clobbering. */
  etag: string | null;
  data: ChatMessage;
}

/** One browsable entry in a container (a listing row). */
export interface ResourceEntry {
  url: string;
  name: string;
  isContainer: boolean;
  modified?: string;
}

/**
 * Lower-case, hyphenated, ASCII-only slug — URI-safe and `:`-free (an
 * ACL-matching hazard on some servers). Empty input yields `""` so the caller
 * falls back to a purely random name. Capped so URLs stay reasonable.
 */
export function toSlug(input: string | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

/**
 * Fail closed unless `url` is a single *resource* strictly inside `container`:
 * same origin, path prefixed by the container, the remainder one non-empty
 * segment with no (real or encoded) slash, and no query/fragment (the builders
 * append `#it`, so a supplied fragment would mint a mismatched subject). Rejects
 * the container root, sub-containers and nested descendants.
 */
function assertDirectChild(url: string, container: string): void {
  let parsed: URL;
  let containerUrl: URL;
  try {
    parsed = new URL(url);
    containerUrl = new URL(container);
  } catch {
    throw new OutOfScopeError(url, container);
  }
  const containerPath = containerUrl.pathname; // ends in "/"
  if (
    parsed.origin !== containerUrl.origin ||
    !parsed.pathname.startsWith(containerPath) ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new OutOfScopeError(url, container);
  }
  const rest = parsed.pathname.slice(containerPath.length);
  const isDirectChild = rest.length > 0 && !rest.includes("/") && !/%2f/i.test(rest);
  if (!isDirectChild) {
    throw new OutOfScopeError(url, container);
  }
}

/**
 * `.catch` handler for a save-time pre-read: a missing resource (404/410) means
 * "nothing to preserve", so resolve to `undefined`; any other error (403, 5xx,
 * network) is real and must NOT be masked — rethrow it so the save fails loudly
 * rather than silently dropping the original timestamp.
 */
function rethrowNon404(e: unknown): undefined {
  if (e instanceof RdfFetchError && (e.status === 404 || e.status === 410)) return undefined;
  throw e;
}

/** Mint a fresh, collision-resistant `.ttl` resource URL inside `container`. */
function mintUrl(container: string, slugHint?: string): string {
  const slug = toSlug(slugHint);
  const rand = Math.random().toString(36).slice(2, 8);
  const file = slug ? `${slug}-${rand}.ttl` : `${rand}.ttl`;
  return `${container}${file}`;
}

/**
 * A typed CRUD handle for Pod-Chat rooms + messages, bound to a pod root +
 * WebID. Construct via {@link createChatStore}. Production callers pass NO
 * `fetchImpl` (the auth-patched global runs); tests inject one.
 */
export class ChatStore {
  private readonly chatRoot: string;
  private readonly roomsUrl: string;
  private readonly messagesUrl: string;

  constructor(
    private readonly podRoot: string,
    private readonly webId: string,
    private readonly fetchImpl?: typeof fetch,
  ) {
    this.chatRoot = new URL(CHAT_SLUG, podRoot).toString();
    this.roomsUrl = new URL(ROOMS_SLUG, this.chatRoot).toString();
    this.messagesUrl = new URL(MESSAGES_SLUG, this.chatRoot).toString();
  }

  /** The container room descriptors live in (always ends in `/`). */
  get roomsContainer(): string {
    return this.roomsUrl;
  }

  /** The container message resources live in (always ends in `/`). */
  get messagesContainer(): string {
    return this.messagesUrl;
  }

  // ---- Rooms ----------------------------------------------------------------

  /**
   * List every room in the rooms container. Skips sub-containers and any
   * resource that doesn't parse to a `pc:ChatRoom`-bearing descriptor row.
   */
  async listRooms(): Promise<ResourceEntry[]> {
    return this.listContainer(this.roomsUrl);
  }

  /**
   * Read one room by URL. Returns `undefined` when the resource holds no
   * `pc:ChatRoom`. A 404 surfaces as `RdfFetchError` with `.status === 404`.
   */
  async readRoom(url: string): Promise<StoredRoom | undefined> {
    assertDirectChild(url, this.roomsUrl);
    const { dataset, etag } = await readRdf(url, this.fetchImpl);
    const data = parseRoom(url, dataset);
    if (data === undefined) return undefined;
    return { url, etag, data };
  }

  /**
   * Create a new room. Registers the rooms container in the Type Index on first
   * use (idempotent), then writes the descriptor create-only so a colliding URL
   * is never silently overwritten.
   *
   * @returns the new room URL and its ETag.
   */
  async createRoom(
    input: BuildRoomInput,
    slugHint?: string,
  ): Promise<{ url: string; etag: string | null }> {
    await this.ensureContainers();
    await this.ensureRegistered();
    const url = mintUrl(this.roomsUrl, slugHint ?? input.name);
    const dataset = buildRoom(url, input);
    const { etag } = await writeRdf(url, dataset, {
      createOnly: true,
      fetchImpl: this.fetchImpl,
      prefixes: PREFIXES,
    });
    return { url, etag };
  }

  /**
   * Overwrite an existing room descriptor (e.g. rename, add/remove a
   * participant, append message refs). Sends `If-Match` when an `etag` is
   * supplied so a concurrent edit fails with 412 instead of clobbering.
   *
   * The original `dct:created` is preserved on save: if the caller omits
   * `created`, the existing descriptor is read and its creation timestamp
   * carried forward, so an edit (rename, participant change) never silently
   * rewrites when the room was created. Pass an explicit `created` to override.
   */
  async saveRoom(
    url: string,
    input: BuildRoomInput,
    etag?: string | null,
  ): Promise<{ etag: string | null }> {
    assertDirectChild(url, this.roomsUrl);
    const created = input.created ?? (await this.existingRoomCreated(url));
    const dataset = buildRoom(url, { ...input, ...(created ? { created } : {}) });
    return writeRdf(url, dataset, { etag, fetchImpl: this.fetchImpl, prefixes: PREFIXES });
  }

  /** Delete a room descriptor (idempotent — a missing resource resolves to success). */
  async removeRoom(url: string): Promise<void> {
    assertDirectChild(url, this.roomsUrl);
    await deleteRdf(url, this.fetchImpl);
  }

  // ---- Messages -------------------------------------------------------------

  /** List every message resource in the messages container (skips sub-containers). */
  async listMessages(): Promise<ResourceEntry[]> {
    return this.listContainer(this.messagesUrl);
  }

  /**
   * Read one message by URL. Returns `undefined` when the resource holds no
   * `as:Note`. A 404 surfaces as `RdfFetchError` with `.status === 404`.
   */
  async readMessage(url: string): Promise<StoredMessage | undefined> {
    assertDirectChild(url, this.messagesUrl);
    const { dataset, etag } = await readRdf(url, this.fetchImpl);
    const data = parseMessage(url, dataset);
    if (data === undefined) return undefined;
    return { url, etag, data };
  }

  /**
   * Post a new message. Writes the resource create-only so a colliding URL is
   * never silently overwritten. The message carries an `as:context` link to its
   * room; appending the message ref to the room descriptor is the caller's job
   * (read-modify-write the room with {@link saveRoom}) so the two writes stay
   * independently conditional.
   *
   * @returns the new message URL and its ETag.
   */
  async postMessage(
    input: BuildMessageInput,
    slugHint?: string,
  ): Promise<{ url: string; etag: string | null }> {
    await this.ensureContainers();
    const url = mintUrl(this.messagesUrl, slugHint);
    const dataset = buildMessage(url, input);
    const { etag } = await writeRdf(url, dataset, {
      createOnly: true,
      fetchImpl: this.fetchImpl,
      prefixes: PREFIXES,
    });
    return { url, etag };
  }

  /**
   * Overwrite an existing message (e.g. edit the body, flip an actionable task's
   * state open↔closed). Sends `If-Match` when an `etag` is supplied so a
   * concurrent edit fails with 412 instead of clobbering.
   *
   * The original `as:published` is preserved on save: if the caller omits
   * `published`, the existing message is read and its publication timestamp
   * carried forward, so editing the body or closing a task never silently
   * rewrites when the message was posted. Pass an explicit `published` to
   * override.
   */
  async saveMessage(
    url: string,
    input: BuildMessageInput,
    etag?: string | null,
  ): Promise<{ etag: string | null }> {
    assertDirectChild(url, this.messagesUrl);
    const published = input.published ?? (await this.existingMessagePublished(url));
    const dataset = buildMessage(url, { ...input, ...(published ? { published } : {}) });
    return writeRdf(url, dataset, { etag, fetchImpl: this.fetchImpl, prefixes: PREFIXES });
  }

  /** Delete a message (idempotent — a missing resource resolves to success). */
  async removeMessage(url: string): Promise<void> {
    assertDirectChild(url, this.messagesUrl);
    await deleteRdf(url, this.fetchImpl);
  }

  // ---- Shared ---------------------------------------------------------------

  /** Register the rooms container in the user's Type Index (idempotent). */
  async ensureRegistered(): Promise<void> {
    await ensureTypeRegistrations({
      webId: this.webId,
      podRoot: this.podRoot,
      registrations: [{ forClass: CHAT_ROOM_CLASS, container: this.roomsUrl }],
      fetchImpl: this.fetchImpl,
    });
  }

  /**
   * Idempotently create the `pod-chat/`, `pod-chat/rooms/` and
   * `pod-chat/messages/` containers, shallowest-first. Servers that mint
   * intermediate containers on a deep resource PUT answer these redundant PUTs
   * with an "already exists" status that {@link ensureContainer} swallows;
   * servers that do NOT need them created up-front so the first room/message
   * write does not 404/409 on a missing parent.
   */
  async ensureContainers(): Promise<void> {
    await ensureContainer(this.chatRoot, this.fetchImpl);
    await ensureContainer(this.roomsUrl, this.fetchImpl);
    await ensureContainer(this.messagesUrl, this.fetchImpl);
  }

  /**
   * The `dct:created` of an existing room descriptor, or `undefined` when the
   * resource is absent (404/410) or holds no parseable room. Used to carry the
   * original creation timestamp forward across a save.
   */
  private async existingRoomCreated(url: string): Promise<Date | undefined> {
    const created = (await this.readRoom(url).catch(rethrowNon404))?.data.created;
    return created ? new Date(created) : undefined;
  }

  /**
   * The `as:published` of an existing message, or `undefined` when the resource
   * is absent (404/410) or holds no parseable message. Used to carry the
   * original publication timestamp forward across a save.
   */
  private async existingMessagePublished(url: string): Promise<Date | undefined> {
    const published = (await this.readMessage(url).catch(rethrowNon404))?.data.published;
    return published ? new Date(published) : undefined;
  }

  /**
   * List a container's direct resource children. Skips the container's own
   * self-description and any sub-containers. A 404/403 on the container itself
   * resolves to an empty list (the container hasn't been created yet).
   */
  private async listContainer(url: string): Promise<ResourceEntry[]> {
    let dataset: DatasetCore;
    try {
      ({ dataset } = await readRdf(url, this.fetchImpl));
    } catch (e) {
      if (e instanceof RdfFetchError && (e.status === 404 || e.status === 403)) return [];
      throw e;
    }
    const container = new ContainerDataset(dataset, DataFactory).container;
    const out: ResourceEntry[] = [];
    for (const r of container?.contains ?? []) {
      if (r.id === url) continue; // the container's self-description
      if (r.isContainer) continue; // sub-containers are not data rows
      out.push({
        url: r.id,
        name: r.name,
        isContainer: r.isContainer,
        modified: r.modified?.toISOString(),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}

/** Build a Pod-Chat store bound to the active pod root + WebID. */
export function createChatStore(opts: {
  podRoot: string;
  webId: string;
  fetchImpl?: typeof fetch;
}): ChatStore {
  return new ChatStore(opts.podRoot, opts.webId, opts.fetchImpl);
}

/** Re-export the friendly-name helper for callers that render listings. */
export { nameFromUrl };
