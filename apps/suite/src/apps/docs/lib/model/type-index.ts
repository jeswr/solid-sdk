// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6 — recover missing linked indexes
// AUTHORED-BY Codex — preferences and extended-profile discovery
// Ported from apps/pod-docs/src/type-index.ts.
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Solid Type Index — read + bootstrap-write, via typed `@rdfjs/wrapper`
 * subclasses (never inline quads). The Type Index is how a pod owner advertises
 * *where* a given RDF class is stored, so independent apps discover each other's
 * data; Pod Docs registers its `pd:Document` container so the documents also
 * surface in a Pod Manager's "My data".
 *
 * CSS does not seed these files, so reads tolerate their absence and the app
 * bootstraps a private index when missing.
 */
import { type FetchedRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import {
  assertWithinPodScope,
  createPodScopedFetch,
  normalizePodBase,
  podScopedUrl,
  refuseRedirects,
} from "@jeswr/guarded-fetch";
import { NS } from "@jeswr/solid-docs/vocab";
import { canonicalize } from "@jeswr/suite-vocab";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { ResourceWriteError } from "./errors.js";
import { readRdf, writeRdf } from "./rdf-io.js";
import { verifyPrivateIndexAccess } from "./type-index-access.js";

const SOLID = NS.SOLID;

export {
  ProfileTypeIndexAnchor,
  type RegisteredLocation,
  TypeIndexDataset,
  TypeIndexDocument,
  type TypeIndexLinks,
  TypeRegistration,
  typeIndexLinks,
} from "@jeswr/solid-docs/type-index";

import {
  ProfileTypeIndexAnchor,
  type RegisteredLocation,
  TypeIndexDataset,
  TypeIndexDocument,
  TypeRegistration,
} from "@jeswr/solid-docs/type-index";
/** A registration the caller wants present: class → container. */
export interface DesiredRegistration {
  forClass: string;
  /** Container URL (must end in `/`). */
  container: string;
}

/** Result of {@link ensureTypeRegistrations}. */
export interface EnsureRegistrationsResult {
  /** The index document the registrations live in. */
  indexUrl: string;
  /** How many registrations were newly added (0 = all already present). */
  added: number;
  /** True when private index bootstrap ran (linking it from preferences if needed). */
  bootstrapped: boolean;
}

const INDEX_PREFIXES = { solid: SOLID };

/** The profile *document* URL a WebID lives in (fragment stripped). */
function documentUrl(webId: string): string {
  const u = new URL(webId);
  u.hash = "";
  return u.toString();
}

/** Follow the WebID's extended profiles, then its Preferences Documents.
 * Only the WebID subject supplies index links. Every linked document is scoped,
 * fragments/cycles are de-duplicated, and an incomplete graph cannot prove absence.
 */
export async function discoverProfileLinks(
  webId: string,
  profile: DatasetCore,
  fetchImpl: typeof fetch,
  podRoot: string,
  requireReadable: boolean,
  publicFetch?: typeof fetch,
): Promise<{ publicIndexes: string[]; privateIndexes: string[]; preferences: string[] }> {
  const scopedFetch = createPodScopedFetch(podRoot, { fetch: fetchImpl });
  const documents = new Map<string, DatasetCore | undefined>([[documentUrl(webId), profile]]);
  const publicIndexes = new Set<string>();
  const privateIndexes = new Set<string>();
  const preferences = new Set<string>();
  const checked = (url: string) => documentUrl(assertWithinPodScope(podRoot, url));
  const publicDocument = (value: string) => {
    if (!publicFetch) return checked(value);
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error("Invalid public profile document URL.");
    return documentUrl(url.href);
  };
  const addPrivate = (values: Iterable<string>, into: Set<string>) => {
    for (const value of values) {
      // Confined sessions cannot read private metadata outside their storage grant.
      if (publicFetch && !podScopedUrl(podRoot, value)) continue;
      into.add(checked(value));
    }
  };
  const read = async (url: string, http = scopedFetch): Promise<DatasetCore | undefined> => {
    if (documents.has(url)) return documents.get(url);
    if (documents.size >= 32) throw new Error("Too many linked Type Index profile documents.");
    let dataset: DatasetCore | undefined;
    try {
      dataset = (await readRdf(url, http)).dataset;
    } catch (error) {
      if (
        !(
          error instanceof RdfFetchError &&
          (error.status === 404 || (!requireReadable && error.status === 403))
        )
      )
        throw error;
    }
    documents.set(url, dataset);
    return dataset;
  };
  const profiles = new Set([documentUrl(webId)]);
  for (const url of profiles) {
    const dataset = await read(url, publicFetch ?? scopedFetch);
    if (!dataset) continue;
    const anchor = new ProfileTypeIndexAnchor(webId, dataset, DataFactory);
    for (const index of anchor.publicIndexes) publicIndexes.add(publicDocument(index));
    addPrivate(anchor.privateIndexes, privateIndexes);
    addPrivate(anchor.preferencesFiles, preferences);
    for (const extended of anchor.extendedProfiles) profiles.add(publicDocument(extended));
  }
  for (const url of preferences) {
    const dataset = await read(url);
    if (!dataset) continue;
    addPrivate(
      new ProfileTypeIndexAnchor(webId, dataset, DataFactory).privateIndexes,
      privateIndexes,
    );
  }
  return {
    publicIndexes: [...publicIndexes],
    privateIndexes: [...privateIndexes],
    preferences: [...preferences],
  };
}

/** Deterministic fragment for a registration (FNV-1a over class|container). */
function fragmentFor(reg: DesiredRegistration): string {
  const input = `${reg.forClass}|${reg.container}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Mint a fresh, empty private type index. Tolerates "already exists" (412). */
async function createIndexDocument(indexUrl: string, fetchImpl: typeof fetch): Promise<void> {
  const store = new Store();
  new TypeIndexDocument(indexUrl, store, DataFactory).markUnlistedIndex();
  try {
    await writeRdf(indexUrl, store, {
      createOnly: true,
      fetchImpl,
      prefixes: INDEX_PREFIXES,
    });
  } catch (e) {
    // 412 under If-None-Match:* = the document already exists — fine, link + reuse.
    if (e instanceof ResourceWriteError && e.status === 412) return;
    throw e;
  }
}

/**
 * Ensure every desired registration exists in the user's type index.
 *
 * Uses only the private index; bootstraps
 * `settings/privateTypeIndex.ttl` under the pod root — and links it from the
 * Preferences Document — when no private index exists. A linked index returning 404 is created
 * at its advertised URL. Idempotent: existing registrations are left untouched.
 *
 * @param fetchImpl - required account-scoped fetch implementation.
 */
export async function ensureTypeRegistrations(opts: {
  webId: string;
  podRoot: string;
  registrations: DesiredRegistration[];
  fetchImpl: typeof fetch;
}): Promise<EnsureRegistrationsResult> {
  const { webId, registrations } = opts;
  const podRoot = normalizePodBase(opts.podRoot);
  const fetchImpl = createPodScopedFetch(podRoot, { fetch: opts.fetchImpl });
  const profileFetch = refuseRedirects(opts.fetchImpl);
  assertWithinPodScope(new URL(".", webId).href, webId);
  for (const registration of registrations) assertWithinPodScope(podRoot, registration.container);

  let indexUrl: string;
  let bootstrapped = false;
  // Re-discover after a conflict, including preferences and extended profiles,
  // so a competing client's established private index wins over our fallback.
  for (let attempt = 0; ; attempt++) {
    const { dataset: profileDs, etag: profileEtag } = await readRdf(webId, profileFetch);
    const links = await discoverProfileLinks(webId, profileDs, fetchImpl, podRoot, true);
    const linked = links.privateIndexes[0];
    if (linked) {
      indexUrl = assertWithinPodScope(podRoot, linked);
      break;
    }
    try {
      const preferencesUrl = links.preferences[0] ?? new URL("settings/prefs.ttl", podRoot).href;
      let preferencesDs: DatasetCore;
      let preferencesEtag: string | null = null;
      let missing = false;
      try {
        const fetched = await readRdf(preferencesUrl, fetchImpl);
        preferencesDs = fetched.dataset;
        preferencesEtag = fetched.etag;
      } catch (error) {
        if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
        preferencesDs = new Store();
        missing = true;
      }
      const anchor = new ProfileTypeIndexAnchor(webId, preferencesDs, DataFactory);
      const existing = anchor.privateIndex;
      indexUrl = existing
        ? documentUrl(assertWithinPodScope(podRoot, existing))
        : new URL("settings/privateTypeIndex.ttl", podRoot).href;
      if (!existing) {
        await createIndexDocument(indexUrl, fetchImpl);
        bootstrapped = true;
      }
      await verifyPrivateIndexAccess(indexUrl, webId, podRoot, fetchImpl);
      await verifyPrivateIndexAccess(preferencesUrl, webId, podRoot, fetchImpl);
      if (!existing) {
        anchor.privateIndex = indexUrl;
        await writeRdf(preferencesUrl, preferencesDs, {
          etag: preferencesEtag,
          createOnly: missing,
          fetchImpl,
        });
      }
      if (!links.preferences.length) {
        new ProfileTypeIndexAnchor(webId, profileDs, DataFactory).preferencesFiles.add(
          preferencesUrl,
        );
        await writeRdf(documentUrl(webId), profileDs, {
          etag: profileEtag,
          fetchImpl: profileFetch,
        });
      }
      break;
    } catch (error) {
      if (!(error instanceof ResourceWriteError && error.status === 412) || attempt >= 3)
        throw error;
    }
  }

  // Re-read and reapply on a concurrent registration instead of replaying stale RDF.
  for (let attempt = 0; ; attempt++) {
    let fetched: FetchedRdf;
    try {
      fetched = await readRdf(indexUrl, fetchImpl);
    } catch (error) {
      if (!(error instanceof RdfFetchError && error.status === 404) || attempt >= 3) throw error;
      await createIndexDocument(indexUrl, fetchImpl);
      bootstrapped = true;
      continue;
    }
    await verifyPrivateIndexAccess(indexUrl, webId, podRoot, fetchImpl);
    const { dataset: indexDs, etag: indexEtag } = fetched;
    const index = new TypeIndexDataset(indexDs, DataFactory);

    let added = 0;
    for (const desired of registrations) {
      const classIri = canonicalize(desired.forClass);
      const exists = index
        .all()
        .some((l) => l.forClass === classIri && l.container === desired.container);
      if (exists) continue;
      const reg = new TypeRegistration(
        `${indexUrl}#reg-${fragmentFor({ ...desired, forClass: classIri })}`,
        indexDs,
        DataFactory,
      );
      reg.markRegistration();
      reg.forClass = classIri;
      reg.instanceContainer = desired.container;
      added += 1;
    }

    try {
      if (added > 0) {
        await writeRdf(indexUrl, indexDs, { etag: indexEtag, fetchImpl, prefixes: INDEX_PREFIXES });
      }
      return { indexUrl, added, bootstrapped };
    } catch (error) {
      if (!(error instanceof ResourceWriteError && error.status === 412) || attempt >= 3)
        throw error;
    }
  }
}

/**
 * Read a WebID profile's type indexes and return every registered location.
 * The profile dataset must already be fetched (it carries the index links).
 * A missing/unreadable index (404/403) contributes nothing rather than failing.
 * Set `requireReadable` for bootstrap decisions: an inaccessible index cannot
 * prove absence and must prevent creating a competing registration. A 404 is
 * confirmed absence in either mode.
 * `publicFetch` separates credential-free profile/public-index reads from storage-scoped
 * private metadata. Off-storage private links are skipped in this read-only mode.
 */
export async function discoverRegistrations(
  webId: string,
  profile: DatasetCore,
  fetchImpl: typeof fetch,
  podRoot: string,
  requireReadable = false,
  publicFetch?: typeof fetch,
): Promise<RegisteredLocation[]> {
  const links = await discoverProfileLinks(
    webId,
    profile,
    fetchImpl,
    podRoot,
    requireReadable,
    publicFetch,
  );
  const checked = new Set([...links.publicIndexes, ...links.privateIndexes]);
  const scopedFetch = createPodScopedFetch(podRoot, { fetch: fetchImpl });
  const out: RegisteredLocation[] = [];
  for (const url of checked) {
    try {
      const { dataset } = await readRdf(
        url,
        publicFetch && links.publicIndexes.includes(url) ? publicFetch : scopedFetch,
      );
      for (const location of new TypeIndexDataset(dataset, DataFactory).all()) {
        if (location.instance && !podScopedUrl(podRoot, location.instance)) continue;
        if (location.container && !podScopedUrl(podRoot, location.container)) continue;
        out.push(location);
      }
    } catch (e) {
      if (
        e instanceof RdfFetchError &&
        (e.status === 404 || (!requireReadable && e.status === 403))
      )
        continue;
      throw e;
    }
  }
  return out;
}

/**
 * Discover before bootstrap, failing if the profile or an existing advertised
 * index cannot be read. Order is public then private, preserving each index's
 * registration order so callers can consistently choose the first match.
 * Supplying `publicFetch` enables best-effort discovery for confined storage sessions;
 * this result must not be used to decide whether to bootstrap missing registrations.
 */
export async function discoverProfileRegistrations(
  webId: string,
  fetchImpl: typeof fetch,
  podRoot: string,
  publicFetch?: typeof fetch,
): Promise<RegisteredLocation[]> {
  const profileFetch = publicFetch ? refuseRedirects(publicFetch) : undefined;
  const { dataset } = await readRdf(webId, profileFetch ?? refuseRedirects(fetchImpl));
  return discoverRegistrations(webId, dataset, fetchImpl, podRoot, !publicFetch, profileFetch);
}
