// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Container listing via `@solid/object`'s typed `ContainerDataset` (never
 * hand-parsed `ldp:contains`). Returns the direct children of a Solid
 * container as plain, serialisable items.
 *
 * A WAC-aware read: a `404`/`403`/`401` resolves to an empty list rather than
 * throwing, because a freshly-provisioned pod may have the container
 * registered (in the type index) but not yet created, or the reader may lack
 * read on a sibling container. Discovery is a hint, not a guarantee.
 */
import { RdfFetchError } from '@jeswr/fetch-rdf';
import { ContainerDataset } from '@solid/object';
import { DataFactory } from 'n3';
import { freshRdf } from './rdf.js';

/** One direct child of a container. */
export interface ContainerEntry {
  /** Resource URL. */
  url: string;
  /** Friendly name from the listing (else the URL tail). */
  name: string;
  /** True for a sub-container (URL ends in `/`). */
  isContainer: boolean;
  /** ISO-8601 last-modified, when the server advertised one. */
  modified?: string;
  /** Byte size, when advertised. */
  size?: number;
  /** MIME type, when advertised. */
  mimeType?: string;
}

/**
 * List a single container's direct children. A missing/forbidden container
 * resolves to `[]` (see module doc). Other errors propagate as `RdfFetchError`.
 *
 * @param fetchImpl - test-only override; **omit in production** so auth runs.
 */
export async function listContainer(
  containerUrl: string,
  fetchImpl?: typeof fetch,
): Promise<ContainerEntry[]> {
  const url = containerUrl.endsWith('/') ? containerUrl : `${containerUrl}/`;
  let dataset: import('@rdfjs/types').DatasetCore;
  try {
    ({ dataset } = await freshRdf(url, fetchImpl));
  } catch (e) {
    if (e instanceof RdfFetchError && (e.status === 404 || e.status === 403 || e.status === 401)) {
      return [];
    }
    throw e;
  }
  const container = new ContainerDataset(dataset, DataFactory).container;
  const out: ContainerEntry[] = [];
  for (const r of container?.contains ?? []) {
    if (r.id === url) continue; // skip the container's self-description
    const entry: ContainerEntry = {
      url: r.id,
      name: r.name,
      isContainer: r.isContainer,
    };
    const modified = r.modified?.toISOString();
    if (modified) entry.modified = modified;
    if (r.size !== undefined) entry.size = r.size;
    if (r.mimeType !== undefined) entry.mimeType = r.mimeType;
    out.push(entry);
  }
  return out.sort(byContainerThenName);
}

function byContainerThenName(a: ContainerEntry, b: ContainerEntry): number {
  if (a.isContainer !== b.isContainer) return a.isContainer ? -1 : 1;
  return a.name.localeCompare(b.name);
}
