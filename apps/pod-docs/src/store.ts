// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/** Document persistence over the discovered SDK client, with logical containment checks. */
import { type AccessClientOptions, type AccessGrant, createAccessClient } from "@jeswr/pod-access";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import {
  type BuildDocumentInput,
  buildDocument,
  type PodDocument,
  parseDocument,
} from "./document.js";
import { OutOfScopeError } from "./errors.js";
import {
  deleteRdf,
  nameFromUrl,
  readRdf,
  requireEtag,
  serializeTurtle,
  storageFor,
  writeRdf,
} from "./rdf-io.js";
import { ensureTypeRegistrations } from "./type-index.js";
import { DOCUMENT_CLASS, PREFIXES } from "./vocab.js";

export const DOCS_SLUG = "pod-docs/";
export interface StoredDocument {
  url: string;
  etag: string | null;
  data: PodDocument;
}
/** One browsable entry in the documents container (a listing row). */
export interface DocumentEntry {
  url: string;
  /** Friendly name from the container listing (the URL tail). */
  name: string;
  /** The document's `dct:title` (parsed), if any. */
  title: string;
  /** Always `false` — `list()` only returns document resources. */
  isContainer: boolean;
  modified?: string;
}

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

/** Supply container when reopening a server-assigned LWS collection identifier. */
export type DocsStoreOptions = {
  podRoot: string;
  webId: string;
  fetchImpl?: typeof fetch;
  storage?: StorageClient;
  /** Canonical description.id when injecting a discovered storage client. */
  storageId?: string;
  /** Trusted ACP server semantics; absent means ACP sharing is unsupported. */
  acpDialect?: AccessClientOptions["acpDialect"];
  container?: string;
  /** Called as soon as storage assigns a new collection, even if document creation later fails. */
  onContainerChange?: (container: string) => void;
};

export class DocsStore {
  private containerUrl: string;
  private pending: Promise<StorageClient> | undefined;
  private preparation: Promise<StorageClient> | undefined;
  private readonly explicitContainer: boolean;
  constructor(
    private readonly podRoot: string,
    private readonly webId: string,
    private readonly fetchImpl?: typeof fetch,
    private readonly storage?: StorageClient,
    container?: string,
    private readonly onContainerChange?: (container: string) => void,
    private storageId?: string,
    private readonly acpDialect?: AccessClientOptions["acpDialect"],
  ) {
    this.explicitContainer = container !== undefined;
    this.containerUrl = container ?? new URL(DOCS_SLUG, podRoot).href;
  }
  get container(): string {
    return this.containerUrl;
  }
  private client(): Promise<StorageClient> {
    this.pending ??= storageFor(this.podRoot, this.fetchImpl, this.storage, (id) => {
      this.storageId = id;
    }).catch((error: unknown) => {
      this.pending = undefined;
      throw error;
    });
    return this.pending;
  }

  /** Reject foreign or ambiguous references before discovery; ask storage for logical parentage. */
  private async assertInContainer(url: string): Promise<StorageClient> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new OutOfScopeError(url, this.containerUrl);
    }
    const root = new URL(this.podRoot);
    if (
      parsed.origin !== root.origin ||
      parsed.href !== url ||
      parsed.username ||
      parsed.password ||
      url.includes("?") ||
      url.includes("#") ||
      url === this.containerUrl ||
      /%2f/i.test(parsed.pathname)
    ) {
      throw new OutOfScopeError(url, this.containerUrl);
    }
    const storage = await this.client();
    if (!storage.isWithinStorage(url)) throw new OutOfScopeError(url, this.containerUrl);
    const head =
      storage.protocol === "lws" ? await storage.head(url, { revalidate: true }) : undefined;
    const parent = head ? head.parent : await storage.parentOf(url);
    if (
      parent !== this.containerUrl ||
      head?.kind === "container" ||
      (!head && parsed.pathname.endsWith("/"))
    ) {
      throw new OutOfScopeError(url, this.containerUrl);
    }
    return storage;
  }

  /** A name hint only. Creation always uses the SDK's returned URL. */
  newDocumentUrl(slugHint?: string): string {
    const slug = toSlug(slugHint);
    const rand = Math.random().toString(36).slice(2, 8);
    const file = slug ? `${slug}-${rand}.ttl` : `${rand}.ttl`;
    return `${this.containerUrl.replace(/\/?$/, "/")}${file}`;
  }

  /** List all SDK pages, omitting subcontainers, non-documents and unreadable children. */
  async list(): Promise<DocumentEntry[]> {
    const storage = await this.client();
    const out: DocumentEntry[] = [];
    let observedEntry = false;
    try {
      for await (const entry of storage.listAll(this.containerUrl, { revalidate: true })) {
        observedEntry = true;
        if (entry.kind === "container") continue;
        let doc: StoredDocument | undefined;
        try {
          doc = await this.read(entry.url);
        } catch {
          continue;
        }
        if (!doc) continue;
        out.push({
          url: entry.url,
          name: nameFromUrl(entry.url),
          title: doc.data.title,
          isContainer: false,
          modified: entry.modified?.toISOString(),
        });
      }
    } catch (error) {
      // StorageClient reports cursor failures at the cursor URL and rejects a
      // cursor equal to the initial container. Even an empty first page must not
      // turn a continuation failure into a successful empty collection.
      if (
        error instanceof StorageError &&
        !observedEntry &&
        error.url === this.containerUrl &&
        (error.code === "not-found" || error.code === "forbidden")
      )
        return [];
      throw error;
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async read(url: string): Promise<StoredDocument | undefined> {
    const storage = await this.assertInContainer(url);
    const { dataset, etag } = await readRdf(url, this.fetchImpl, storage);
    const data = parseDocument(url, dataset);
    return data === undefined ? undefined : { url, etag, data };
  }

  /** Create the collection if absent, retaining the server's identifier. */
  private ensureContainer(): Promise<StorageClient> {
    this.preparation ??= this.prepareContainer().catch((error: unknown) => {
      this.preparation = undefined;
      throw error;
    });
    return this.preparation;
  }

  private async prepareContainer(): Promise<StorageClient> {
    const storage = await this.client();
    try {
      await storage.head(this.containerUrl, { revalidate: true });
    } catch (error) {
      if (!(error instanceof StorageError) || error.code !== "not-found" || this.explicitContainer)
        throw error;
      this.containerUrl = (
        await storage.create(this.podRoot, null, { kind: "container", name: "pod-docs" })
      ).url;
      this.onContainerChange?.(this.containerUrl);
    }
    return storage;
  }

  async create(
    input: Omit<BuildDocumentInput, "priorRevisions">,
    slugHint?: string,
  ): Promise<{ url: string; etag: string | null }> {
    const storage = await this.ensureContainer();
    await this.ensureRegistered();
    const hint = this.newDocumentUrl(slugHint ?? input.title);
    const dataset = buildDocument("", { ...input, priorRevisions: [] });
    // Relative fragments bind #it and #rev-0 to the POST result, even when the server ignores Slug.
    const body = await serializeTurtle(dataset, PREFIXES);
    return storage.create(this.containerUrl, body, {
      contentType: "text/turtle",
      name: nameFromUrl(hint),
    });
  }

  /** Append a revision; thread created, creator and priorRevisions back from the preceding read. */
  async save(
    url: string,
    input: BuildDocumentInput,
    etag?: string | null,
  ): Promise<{ etag: string | null }> {
    const storage = await this.assertInContainer(url);
    requireEtag(etag, url);
    return writeRdf(url, buildDocument(url, input), { etag, storage, prefixes: PREFIXES });
  }

  async remove(url: string, etag?: string | null): Promise<void> {
    try {
      const storage = await this.assertInContainer(url);
      await deleteRdf(url, this.fetchImpl, storage, etag);
    } catch (error) {
      if (error instanceof StorageError && error.code === "not-found") return;
      throw error;
    }
  }

  async share(
    url: string,
    grant: AccessGrant,
    opts: { inherit?: boolean } = {},
  ): Promise<AccessGrant> {
    const storage = await this.assertInContainer(url);
    return createAccessClient({
      storage,
      storageId: this.storageId,
      acpDialect: this.acpDialect,
    }).share(url, grant, opts);
  }

  /** Solid Type Index registration is optional protocol metadata, absent on LWS. */
  async ensureRegistered(): Promise<void> {
    const storage = await this.client();
    if (storage.protocol === "solid")
      await ensureTypeRegistrations({
        webId: this.webId,
        podRoot: this.podRoot,
        registrations: [{ forClass: DOCUMENT_CLASS, container: this.containerUrl }],
        fetchImpl: this.fetchImpl,
        storage,
      });
  }
}

export function createDocsStore(opts: DocsStoreOptions): DocsStore {
  return new DocsStore(
    opts.podRoot,
    opts.webId,
    opts.fetchImpl,
    opts.storage,
    opts.container,
    opts.onContainerChange,
    opts.storageId,
    opts.acpDialect,
  );
}
export { nameFromUrl };
