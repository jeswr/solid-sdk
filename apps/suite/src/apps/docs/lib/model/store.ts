// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6 — fresh companion reservations
// CRUD and LDP listing ported from apps/pod-docs/src/store.ts.
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { refuseRedirects } from "@jeswr/guarded-fetch";
import { termsEqual } from "@jeswr/suite-vocab";
import { Container, ContainerDataset } from "@solid/object";
import { DataFactory, Store } from "n3";
import {
  type BuildDocumentInput,
  buildDocument,
  type PodDocument,
  parseDocument,
} from "./document.js";
import {
  OutOfScopeError,
  ResourceReadError,
  ResourceWriteError,
  TitleConflictError,
} from "./errors.js";
import { DOCS_SLUG, docContainerUrls, isDirectChild, LEGACY_DOCS_SLUG, toSlug } from "./layout.js";
import { nameFromUrl, REVALIDATE_HEADERS, readRdf, serializeTurtle, writeRdf } from "./rdf-io.js";
import { discoverRegistrations, ensureTypeRegistrations } from "./type-index.js";
import { DOCUMENT_CLASS, NS, PREFIXES } from "./vocab.js";

export interface StoredDocument {
  url: string;
  etag: string | null;
  data: PodDocument;
}
export interface DocumentEntry {
  url: string;
  name: string;
  title: string;
  isContainer: false;
  legacy: boolean;
  readOnly: boolean;
  modified: string | undefined;
}
export interface Snapshot {
  body: string;
  /** Captured with the body so remote format changes cannot reinterpret it. */
  format: string;
  wordCount?: number | undefined;
}
export interface SaveOptions {
  /** Regenerate body and format together from the live editor after each conflict. */
  regenerate: () => Snapshot | Promise<Snapshot>;
  /** Injectable clock/backoff seam; default uses real timers. */
  wait?: ((milliseconds: number) => Promise<void>) | undefined;
}
/** Callbacks must use one captured editor state so its log, body and format agree. */
export interface CopyState {
  /** Resume the same private reservation after an interrupted copy. */
  reservation?: StoredDocument | undefined;
  onReserved?: ((copy: StoredDocument) => Promise<void>) | undefined;
  /** Only referenced assets, not every file left in the source container. */
  assets: readonly string[];
  snapshot: (assetUrls: ReadonlyMap<string, string>) => Snapshot | Promise<Snapshot>;
  /** Persist a clone of the captured state with the same remapped asset references. */
  persistFullState: (
    updates: string,
    fetchImpl: typeof fetch,
    assetUrls: ReadonlyMap<string, string>,
  ) => Promise<void>;
}

/** All I/O uses the supplied account fetch; no auth globals or editor imports. */
export class DocsStore {
  readonly container: string;
  readonly legacyContainer: string;
  constructor(
    private readonly podRoot: string,
    private readonly webId: string,
    private readonly fetchImpl: typeof fetch,
  ) {
    // Account requests, including copy adapters and profile reads, must never
    // follow a server-selected destination with the caller's credentials.
    this.fetchImpl = refuseRedirects(fetchImpl);
    this.container = new URL(DOCS_SLUG, podRoot).href;
    this.legacyContainer = new URL(LEGACY_DOCS_SLUG, podRoot).href;
  }

  docContainerUrls(slug: string) {
    return docContainerUrls(slug, this.container);
  }

  private assertScope(url: string, write = false): void {
    if (
      !isDirectChild(url, this.container) &&
      (write || !isDirectChild(url, this.legacyContainer))
    ) {
      throw new OutOfScopeError(url, this.container);
    }
  }

  async read(url: string): Promise<StoredDocument | undefined> {
    this.assertScope(url);
    const { dataset, etag } = await readRdf(url, this.fetchImpl);
    const data = parseDocument(url, dataset);
    return data === undefined ? undefined : { url, etag, data };
  }

  /** Default location plus registered legacy location; legacy rows are read-only. */
  async list(): Promise<DocumentEntry[]> {
    const { dataset: profile } = await readRdf(this.webId, this.fetchImpl);
    const registrations = await discoverRegistrations(
      this.webId,
      profile,
      this.fetchImpl,
      this.podRoot,
    );
    const containers = [this.container];
    if (
      registrations.some(
        (r) => termsEqual(r.forClass, DOCUMENT_CLASS) && r.container === this.legacyContainer,
      )
    ) {
      containers.push(this.legacyContainer);
    }
    const out: DocumentEntry[] = [];
    for (const url of containers) {
      let listing: ContainerDataset;
      try {
        const { dataset } = await readRdf(url, this.fetchImpl);
        listing = new ContainerDataset(dataset, DataFactory);
      } catch (e) {
        if (e instanceof RdfFetchError && (e.status === 404 || e.status === 403)) continue;
        throw e;
      }
      for (const resource of listing.container?.contains ?? []) {
        if (!isDirectChild(resource.id, url) || resource.isContainer) continue;
        try {
          const doc = await this.read(resource.id);
          if (doc)
            out.push({
              url: doc.url,
              name: resource.name,
              title: doc.data.title,
              isContainer: false,
              modified: resource.modified?.toISOString(),
              legacy: url === this.legacyContainer,
              readOnly: url === this.legacyContainer,
            });
        } catch {
          // A single vanished, forbidden or malformed child must not hide the other rows.
        }
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async createContainer(url: string): Promise<void> {
    const dataset = new Store();
    const container = new Container(url, dataset, DataFactory);
    container.type.add(`${NS.LDP}BasicContainer`);
    await writeRdf(url, dataset, { createOnly: true, fetchImpl: this.fetchImpl });
  }

  /** Allocate the readable slug, using -2, -3, … on create-only collisions. */
  async create(
    input: Omit<BuildDocumentInput, "priorRevisions">,
    slugHint?: string,
  ): Promise<StoredDocument> {
    const slug = toSlug(slugHint ?? input.title) || crypto.randomUUID().slice(0, 8);
    return this.createAtSlug(input, slug);
  }

  private async createAtSlug(
    input: Omit<BuildDocumentInput, "priorRevisions">,
    slug: string,
  ): Promise<StoredDocument> {
    await this.ensureRegistered();
    for (let suffix = 1; ; suffix++) {
      const url = `${this.container}${slug}${suffix === 1 ? "" : `-${suffix}`}.ttl`;
      const layout = docContainerUrls(url);
      const dataset = buildDocument(url, {
        ...input,
        ...layout,
        creator: input.creator ?? this.webId,
      });
      let etag: string | null;
      try {
        // Reserve a fresh companion tree before publishing its links in the document.
        // A collision anywhere belongs to another document, even if its .ttl is gone.
        for (const child of [layout.container, layout.updateLog, layout.assets, layout.comments]) {
          await this.createContainer(child);
        }
        ({ etag } = await writeRdf(url, dataset, {
          createOnly: true,
          fetchImpl: this.fetchImpl,
          prefixes: PREFIXES,
        }));
      } catch (error) {
        if (error instanceof ResourceWriteError && error.status === 412) continue;
        throw error;
      }
      return { url, etag, data: parseDocument(url, dataset) as PodDocument };
    }
  }

  /** Conditional snapshot save, preserving remote history and unchanged metadata on 412. */
  async save(
    stored: StoredDocument,
    input: Partial<BuildDocumentInput>,
    options: SaveOptions,
  ): Promise<StoredDocument> {
    this.assertScope(stored.url, true);
    let current = stored;
    let snapshot: Snapshot = {
      body: input.body ?? stored.data.body,
      format: input.format ?? stored.data.format,
      wordCount: input.wordCount ?? stored.data.wordCount,
    };
    const localTitle = input.title ?? stored.data.title;
    const titleChanged = localTitle !== stored.data.title;
    const wait =
      options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 0; ; attempt++) {
      if (
        titleChanged &&
        current.data.title !== stored.data.title &&
        current.data.title !== localTitle
      ) {
        throw new TitleConflictError(stored.url, localTitle, current.data.title);
      }
      const dataset = buildDocument(stored.url, {
        ...current.data,
        ...input,
        ...snapshot,
        title: titleChanged ? localTitle : current.data.title,
        priorRevisions: current.data.revisions,
        editor: this.webId,
      });
      try {
        const { etag } = await writeRdf(stored.url, dataset, {
          etag: current.etag,
          fetchImpl: this.fetchImpl,
          prefixes: PREFIXES,
        });
        return { url: stored.url, etag, data: parseDocument(stored.url, dataset) as PodDocument };
      } catch (error) {
        if (!(error instanceof ResourceWriteError && error.status === 412) || attempt >= 3)
          throw error;
        await wait(2_000 * 2 ** attempt);
        const remote = await this.read(stored.url);
        if (!remote) throw new ResourceReadError(stored.url, 422);
        current = remote;
        snapshot = await options.regenerate();
      }
    }
  }

  /** Copy a live snapshot and its referenced assets; editor persistence is an injected seam. */
  async makeCopy(source: StoredDocument, state: CopyState): Promise<StoredDocument> {
    this.assertScope(source.url);
    const sourceAssets = source.data.assets ?? docContainerUrls(source.url).assets;
    const sourceLayout = docContainerUrls(source.url);
    if (sourceAssets !== sourceLayout.assets)
      throw new OutOfScopeError(sourceAssets, sourceLayout.assets);
    for (const asset of state.assets) {
      if (!isDirectChild(asset, sourceAssets)) throw new OutOfScopeError(asset, sourceAssets);
    }
    // Create reserves the name before dependent resources are copied. Failures propagate;
    // no success is returned until the new log, assets and final snapshot are durable.
    let copy = state.reservation;
    if (copy) {
      this.assertScope(copy.url, true);
      const current = await this.read(copy.url);
      if (!current || current.data.wasDerivedFrom !== `${source.url}#it`)
        throw new ResourceReadError(copy.url, 422);
      // Keep the reservation's validator: another client editing the visible
      // copy must cause a conflict rather than being overwritten by a retry.
      // Keep the reserved metadata too: retries must generate identical final bytes.
    } else
      copy = await this.createAtSlug(
        {
          title: `Copy of ${source.data.title}`.slice(0, 200),
          body: "",
          format: source.data.format,
          wasDerivedFrom: `${source.url}#it`,
        },
        `${toSlug(nameFromUrl(source.url).slice(0, -4)) || "document"}-copy`,
      );
    await state.onReserved?.(copy);
    const target = docContainerUrls(copy.url);
    const mapping = new Map<string, string>();
    for (const asset of new Set(state.assets)) {
      const destination = `${target.assets}${new URL(asset).pathname.split("/").at(-1)}`;
      const response = await this.fetchImpl(asset);
      if (!response.ok) throw new ResourceReadError(asset, response.status);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const written = await this.fetchImpl(destination, {
        method: "PUT",
        headers: {
          "content-type": response.headers.get("content-type") ?? "application/octet-stream",
          "if-none-match": "*",
        },
        body: bytes,
      });
      if (!written.ok) {
        // A retry may find an asset copied before the interruption. Reuse only
        // the same bytes; an unrelated occupant must never be overwritten.
        if (!state.reservation || written.status !== 412)
          throw new ResourceWriteError(destination, written.status);
        const existing = await this.fetchImpl(destination);
        if (!existing.ok) throw new ResourceReadError(destination, existing.status);
        const prior = new Uint8Array(await existing.arrayBuffer());
        if (prior.length !== bytes.length || prior.some((byte, index) => byte !== bytes[index]))
          throw new ResourceWriteError(destination, 412);
      }
      mapping.set(asset, destination);
    }
    await state.persistFullState(target.updateLog, this.fetchImpl, mapping);
    const snapshot = await state.snapshot(mapping);
    // Fresh copy history captures the copied content, never the reservation's empty body.
    const dataset = buildDocument(copy.url, {
      ...copy.data,
      ...snapshot,
      priorRevisions: [],
      now: new Date(copy.data.modified as string),
    });
    let etag: string | null;
    try {
      ({ etag } = await writeRdf(copy.url, dataset, {
        etag: copy.etag,
        fetchImpl: this.fetchImpl,
        prefixes: PREFIXES,
      }));
    } catch (error) {
      if (!(error instanceof ResourceWriteError && error.status === 412)) throw error;
      // An earlier final PUT may have committed and lost its acknowledgement.
      // Only our byte-identical intended snapshot settles that old reservation.
      const current = await this.fetchImpl(copy.url, { headers: REVALIDATE_HEADERS });
      if (!current.ok) throw new ResourceReadError(copy.url, current.status);
      if ((await current.text()) !== (await serializeTurtle(dataset, PREFIXES))) throw error;
      etag = current.headers.get("etag");
    }
    return { url: copy.url, etag, data: parseDocument(copy.url, dataset) as PodDocument };
  }

  async ensureRegistered(): Promise<void> {
    await ensureTypeRegistrations({
      webId: this.webId,
      podRoot: this.podRoot,
      registrations: [{ forClass: DOCUMENT_CLASS, container: this.container }],
      fetchImpl: this.fetchImpl,
    });
  }
}

export function createDocsStore(options: {
  podRoot: string;
  webId: string;
  fetchImpl: typeof fetch;
}): DocsStore {
  return new DocsStore(options.podRoot, options.webId, options.fetchImpl);
}
export { DOCS_SLUG, docContainerUrls, nameFromUrl, toSlug };
