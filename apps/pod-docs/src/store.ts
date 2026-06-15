// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * The Pod-Docs CRUD store — the ONE place the app touches pod I/O for documents.
 *
 * Storage model: one resource per document under a dedicated container
 * (`pod-docs/`) at the pod root, the container registered in the user's Type
 * Index for cross-app discovery. One-resource-per-document keeps each write
 * small and conflict-scoped, lets per-document ACLs differ later, and maps onto
 * the Type-Index `solid:instanceContainer` model.
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
import {
  type BuildDocumentInput,
  buildDocument,
  type PodDocument,
  parseDocument,
} from "./document.js";
import { OutOfScopeError } from "./errors.js";
import { deleteRdf, nameFromUrl, readRdf, writeRdf } from "./rdf-io.js";
import { ensureTypeRegistrations } from "./type-index.js";
import { DOCUMENT_CLASS, PREFIXES } from "./vocab.js";

/** Container slug under the pod root where Pod-Docs documents live. */
export const DOCS_SLUG = "pod-docs/";

/** A stored document the UI consumes: stable `url`, `etag`, parsed `data`. */
export interface StoredDocument {
  url: string;
  /** ETag from the last read — pass back on save to guard against clobbering. */
  etag: string | null;
  data: PodDocument;
}

/** One browsable entry in the documents container (a listing row). */
export interface DocumentEntry {
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
 * A typed CRUD handle for Pod-Docs documents, bound to a pod root + WebID.
 * Construct via {@link createDocsStore}. Production callers pass NO `fetchImpl`
 * (the auth-patched global runs); tests inject one.
 */
export class DocsStore {
  private readonly containerUrl: string;

  constructor(
    private readonly podRoot: string,
    private readonly webId: string,
    private readonly fetchImpl?: typeof fetch,
  ) {
    this.containerUrl = new URL(DOCS_SLUG, podRoot).toString();
  }

  /** The container documents live in (always ends in `/`). */
  get container(): string {
    return this.containerUrl;
  }

  /**
   * Fail closed unless `url` is a single document *resource* strictly inside the
   * store's container: same origin, path prefixed by the container, the
   * remainder one non-empty segment with no (real or encoded) slash, and no
   * query/fragment (the builders append `#it`/`#rev-n`, so a supplied fragment
   * would mint a mismatched subject). Rejects the container root, sub-containers
   * and nested descendants.
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
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      throw new OutOfScopeError(url, this.containerUrl);
    }
    const rest = parsed.pathname.slice(containerPath.length);
    const isDirectChild = rest.length > 0 && !rest.includes("/") && !/%2f/i.test(rest);
    if (!isDirectChild) {
      throw new OutOfScopeError(url, this.containerUrl);
    }
  }

  /**
   * Mint a fresh, collision-resistant document resource URL inside the
   * container. `slugHint` (e.g. the title) seeds a readable, URI-safe prefix; a
   * random suffix guarantees uniqueness without a round-trip. Never contains `:`.
   */
  newDocumentUrl(slugHint?: string): string {
    const slug = toSlug(slugHint);
    const rand = Math.random().toString(36).slice(2, 8);
    const file = slug ? `${slug}-${rand}.ttl` : `${rand}.ttl`;
    return `${this.containerUrl}${file}`;
  }

  /**
   * List every document in the container. Skips sub-containers and any resource
   * that doesn't parse to a `pd:Document`. Unreadable individual rows are
   * skipped rather than failing the whole list.
   */
  async list(): Promise<DocumentEntry[]> {
    const url = this.containerUrl;
    let dataset: DatasetCore;
    try {
      ({ dataset } = await readRdf(url, this.fetchImpl));
    } catch (e) {
      if (e instanceof RdfFetchError && (e.status === 404 || e.status === 403)) return [];
      throw e;
    }
    const container = new ContainerDataset(dataset, DataFactory).container;
    const out: DocumentEntry[] = [];
    for (const r of container?.contains ?? []) {
      if (r.id === url) continue; // the container's self-description
      if (r.isContainer) continue; // sub-containers are not documents
      out.push({
        url: r.id,
        name: r.name,
        isContainer: r.isContainer,
        modified: r.modified?.toISOString(),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Read one document by URL. Returns `undefined` when the resource holds no
   * `pd:Document`. A 404 surfaces as `RdfFetchError` with `.status === 404`.
   */
  async read(url: string): Promise<StoredDocument | undefined> {
    this.assertInContainer(url);
    const { dataset, etag } = await readRdf(url, this.fetchImpl);
    const data = parseDocument(url, dataset);
    if (data === undefined) return undefined;
    return { url, etag, data };
  }

  /**
   * Create a new document. Registers the container in the Type Index on first
   * use (idempotent), then writes the resource create-only so a colliding URL is
   * never silently overwritten. The first save materialises revision `rev-0`.
   *
   * @returns the new document URL and its ETag.
   */
  async create(
    input: Omit<BuildDocumentInput, "priorRevisions">,
    slugHint?: string,
  ): Promise<{ url: string; etag: string | null }> {
    await this.ensureRegistered();
    const url = this.newDocumentUrl(slugHint ?? input.title);
    const dataset = buildDocument(url, { ...input, priorRevisions: [] });
    const { etag } = await writeRdf(url, dataset, {
      createOnly: true,
      fetchImpl: this.fetchImpl,
      prefixes: PREFIXES,
    });
    return { url, etag };
  }

  /**
   * Save an edit to an existing document, appending a new `prov:Entity`
   * revision to its history. Pass the prior `revisions` (from {@link read}) as
   * `priorRevisions` so the chain is preserved. Sends `If-Match` when an `etag`
   * is supplied so a concurrent edit fails with 412 instead of clobbering.
   */
  async save(
    url: string,
    input: BuildDocumentInput,
    etag?: string | null,
  ): Promise<{ etag: string | null }> {
    this.assertInContainer(url);
    const dataset = buildDocument(url, input);
    return writeRdf(url, dataset, { etag, fetchImpl: this.fetchImpl, prefixes: PREFIXES });
  }

  /** Delete a document (idempotent — a missing resource resolves to success). */
  async remove(url: string): Promise<void> {
    this.assertInContainer(url);
    await deleteRdf(url, this.fetchImpl);
  }

  /** Register the documents container in the user's Type Index (idempotent). */
  async ensureRegistered(): Promise<void> {
    await ensureTypeRegistrations({
      webId: this.webId,
      podRoot: this.podRoot,
      registrations: [{ forClass: DOCUMENT_CLASS, container: this.containerUrl }],
      fetchImpl: this.fetchImpl,
    });
  }
}

/** Build a Pod-Docs store bound to the active pod root + WebID. */
export function createDocsStore(opts: {
  podRoot: string;
  webId: string;
  fetchImpl?: typeof fetch;
}): DocsStore {
  return new DocsStore(opts.podRoot, opts.webId, opts.fetchImpl);
}

/** Re-export the friendly-name helper for callers that render listings. */
export { nameFromUrl };
