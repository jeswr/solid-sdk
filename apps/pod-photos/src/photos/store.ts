// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * The pod-shaped CRUD store: one resource per item under a dedicated container
 * (`photos/`, `albums/`), with the container registered in the user's Type
 * Index so the data also surfaces in any other Solid app. This is the ONE place
 * the photo/album modules touch pod I/O — they supply only their container
 * slug, RDF class, prefix map, and a typed parse/serialise pair.
 *
 * One-resource-per-item (not one big collection doc) keeps each write small and
 * conflict-scoped, lets per-item ACLs differ later, and maps cleanly onto the
 * Type-Index `solid:instanceContainer` discovery model.
 *
 * Security: every caller-supplied URL is scope-checked against this store's own
 * container BEFORE any authenticated I/O (a confused-deputy guard — a crafted
 * `?id=` link must never redirect a read/write/delete elsewhere).
 */
import type { DatasetCore } from '@rdfjs/types';
import type { Store } from 'n3';
import { listContainer } from '../pod/container.js';
import { OutOfScopeError } from '../pod/errors.js';
import {
  deleteResource,
  ensureContainer,
  readResource,
  toSlug,
  writeResource,
} from '../pod/rdf.js';
import { ensureTypeRegistrations } from '../pod/type-index.js';

/** A stored item as the UI consumes it: a stable `url`, its `etag`, the payload. */
export interface StoredItem<T> {
  url: string;
  /** ETag from the last read — pass back on save to guard against clobbering. */
  etag: string | null;
  data: T;
}

/** Per-app config that turns the generic store into a typed one. */
export interface StoreConfig<T> {
  /** Container slug under the pod root, e.g. `"photos/"` (must end in `/`). */
  containerSlug: string;
  /** The RDF class registered in the Type Index for discovery. */
  forClass: string;
  /** Turtle prefix map for readable documents. */
  prefixes: Record<string, string>;
  /** File extension for new items (default `.ttl`). */
  extension?: string;
  /**
   * Parse a single item's dataset into the payload. `itemUrl` is the resource
   * URL (the item's subject is `${itemUrl}#it`). Return `undefined` when the
   * document holds no item of this class (so a stray file is skipped).
   */
  parse(itemUrl: string, dataset: DatasetCore): T | undefined;
  /** Serialise a payload into a fresh dataset rooted at `${itemUrl}#it`. */
  build(itemUrl: string, data: T): Store;
}

/**
 * A typed CRUD handle for one app surface, bound to a pod root. Construct via
 * {@link createStore}. Production callers pass NO `fetchImpl` (the auth-patched
 * global runs); tests inject one.
 */
export class PodStore<T> {
  private readonly containerUrl: string;
  private readonly extension: string;

  constructor(
    private readonly cfg: StoreConfig<T>,
    private readonly podRoot: string,
    private readonly webId: string,
    private readonly fetchImpl?: typeof fetch,
  ) {
    this.containerUrl = new URL(cfg.containerSlug, podRoot).toString();
    this.extension = cfg.extension ?? '.ttl';
  }

  /** The container these items live in (always ends in `/`). */
  get container(): string {
    return this.containerUrl;
  }

  /**
   * Fail closed unless `url` is a single item *resource* strictly inside this
   * store's container. Rejects the container root (both slash forms), any
   * sub-container, any nested descendant, and any URL carrying a query/fragment
   * (the builders append `#it`, so a caller fragment would mint a mismatched
   * subject). A confused-deputy guard — runs before any authenticated I/O.
   */
  private assertInContainer(url: string): void {
    let parsed: URL;
    let containerUrl: URL;
    try {
      parsed = new URL(url);
      containerUrl = new URL(this.containerUrl);
    } catch {
      throw new OutOfScopeError(url, this.containerUrl);
    }
    const containerPath = containerUrl.pathname; // ends in "/"
    if (
      parsed.origin !== containerUrl.origin ||
      !parsed.pathname.startsWith(containerPath) ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      throw new OutOfScopeError(url, this.containerUrl);
    }
    const rest = parsed.pathname.slice(containerPath.length);
    const isDirectChild = rest.length > 0 && !rest.includes('/') && !/%2f/i.test(rest);
    if (!isDirectChild) throw new OutOfScopeError(url, this.containerUrl);
  }

  /**
   * Mint a fresh, collision-resistant resource URL inside the container.
   * `slugHint` (e.g. a title) seeds a readable, URI-safe prefix; a random
   * suffix guarantees uniqueness without a round-trip. Never contains `:`.
   */
  newItemUrl(slugHint?: string): string {
    const slug = toSlug(slugHint);
    const rand = Math.random().toString(36).slice(2, 8);
    const file = slug ? `${slug}-${rand}${this.extension}` : `${rand}${this.extension}`;
    return `${this.containerUrl}${file}`;
  }

  /**
   * List every item in the container. Skips sub-containers and any resource
   * that doesn't parse to this app's class. Unreadable individual items are
   * skipped rather than failing the whole list (resilience over strictness).
   * A missing/forbidden container resolves to `[]`.
   */
  async list(): Promise<StoredItem<T>[]> {
    // `listContainer` already maps a missing/forbidden container to `[]` (it is
    // the single home of WAC-tolerant listing), so a non-WAC error here is a
    // genuine failure and propagates.
    const entries = await listContainer(this.containerUrl, this.fetchImpl);
    const items: StoredItem<T>[] = [];
    for (const entry of entries) {
      if (entry.url.endsWith('/')) continue; // sub-container
      try {
        const item = await this.read(entry.url);
        if (item) items.push(item);
      } catch {
        // Skip an item that vanished or failed to parse; the rest still load.
      }
    }
    return items;
  }

  /**
   * Read one item by URL. Returns `undefined` when the resource holds no item
   * of this class. Propagates `RdfFetchError` (branch on `.status`; 404 = gone).
   */
  async read(url: string): Promise<StoredItem<T> | undefined> {
    this.assertInContainer(url);
    const { dataset, etag } = await readResource(url, this.fetchImpl);
    const data = this.cfg.parse(url, dataset);
    if (data === undefined) return undefined;
    return { url, etag, data };
  }

  /**
   * Create a new item. Makes sure this app's container exists (for servers that
   * don't auto-create it on PUT) and registers it in the Type Index on first
   * use (both idempotent), then writes the resource create-only so a colliding
   * URL is never silently overwritten.
   */
  async create(data: T, slugHint?: string): Promise<{ url: string; etag: string | null }> {
    await ensureContainer(this.containerUrl, this.fetchImpl);
    await this.ensureRegistered();
    const url = this.newItemUrl(slugHint);
    const dataset = this.cfg.build(url, data);
    const { etag } = await writeResource(url, dataset, {
      createOnly: true,
      fetchImpl: this.fetchImpl,
      prefixes: this.cfg.prefixes,
    });
    return { url, etag };
  }

  /**
   * Overwrite an existing item. Sends `If-Match` when an `etag` is supplied so
   * a concurrent edit fails with 412 instead of clobbering (the caller re-reads
   * and retries).
   */
  async update(url: string, data: T, etag?: string | null): Promise<{ etag: string | null }> {
    this.assertInContainer(url);
    const dataset = this.cfg.build(url, data);
    return writeResource(url, dataset, {
      ...(etag !== undefined ? { etag } : {}),
      fetchImpl: this.fetchImpl,
      prefixes: this.cfg.prefixes,
    });
  }

  /** Delete an item (idempotent — a missing resource resolves to success). */
  async remove(url: string): Promise<void> {
    this.assertInContainer(url);
    await deleteResource(url, this.fetchImpl);
  }

  /** Register this app's container in the user's Type Index (idempotent). */
  async ensureRegistered(): Promise<void> {
    await ensureTypeRegistrations({
      webId: this.webId,
      podRoot: this.podRoot,
      registrations: [{ forClass: this.cfg.forClass, container: this.containerUrl }],
      ...(this.fetchImpl !== undefined ? { fetchImpl: this.fetchImpl } : {}),
    });
  }
}

/** Build a typed store for an app surface, bound to the active pod + WebID. */
export function createStore<T>(
  cfg: StoreConfig<T>,
  opts: { podRoot: string; webId: string; fetchImpl?: typeof fetch },
): PodStore<T> {
  return new PodStore(cfg, opts.podRoot, opts.webId, opts.fetchImpl);
}
