// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/**
 * Type-Index write path — make sure a set of `(forClass, container)` pairs is
 * registered, bootstrapping a private index when the profile has none (CSS
 * seeds none; DESIGN.md §9). Idempotent: existing registrations are left
 * untouched, so re-running an import never duplicates index entries.
 *
 * All RDF goes through the typed wrappers in `type-index.ts` — never inline
 * quads (house rule).
 */
import {
  assertWithinPodScope,
  isWithinPodScope,
  PodScopeError,
  refuseRedirects,
  snapshotFetchInput,
} from "@jeswr/guarded-fetch";
import type { DatasetCore } from "@rdfjs/types";
import { Agent } from "@solid/object";
import { DataFactory, Store } from "n3";
import { freshRdf } from "./rdf-read.js";
import { ResourceWriteError, writeResource } from "./resource.js";
import {
  ProfileTypeIndexAnchor,
  TypeIndexDataset,
  TypeIndexDocument,
  TypeRegistration,
  typeIndexLinks,
} from "./type-index.js";

/** A registration the caller wants present: class → container. */
export interface DesiredRegistration {
  forClass: string;
  /** Container URL (must end in `/`). */
  container: string;
}

export interface EnsureRegistrationsResult {
  /** The index document the registrations live in. */
  indexUrl: string;
  /** How many registrations were newly added (0 = all already present). */
  added: number;
  /** True when a fresh private index was created and linked. */
  bootstrapped: boolean;
}

const PREFIXES = { solid: "http://www.w3.org/ns/solid/terms#" };

/** Select exactly one profile-linked index (or bootstrap target) inside advertised storage. */
export function validatedTypeIndexTarget(webId: string, profile: DatasetCore, podRoot: string) {
  const links = typeIndexLinks(webId, profile);
  const target =
    links.privateIndex ??
    links.publicIndex ??
    new URL("settings/privateTypeIndex.ttl", podRoot).href;
  const storageRoots = new Agent(webId, profile, DataFactory).storageUrls;
  const storageRoot = [...storageRoots].find((root) =>
    isWithinPodScope(root, target, { allowRoot: false }),
  );
  if (!storageRoot) throw new PodScopeError("Type Index is outside every advertised storage root.");
  return {
    indexUrl: documentUrl(assertWithinPodScope(storageRoot, target, { allowRoot: false })),
    storageRoot,
  };
}

/**
 * Ensure every desired registration exists in the user's type index.
 *
 * Prefers the private index (imported account data is private by default);
 * falls back to the public one; bootstraps `settings/privateTypeIndex.ttl`
 * under the pod root — and links it from the profile — when neither exists.
 *
 * Connector hosts supply the Pod transport explicitly. Only the profile document and
 * its selected index within an advertised storage are accessible; redirects are refused.
 */
export async function ensureTypeRegistrations(opts: {
  webId: string;
  /** Host-resolved document URL; legacy direct callers default to the WebID document. */
  profileDocumentUrl?: string;
  podRoot: string;
  registrations: DesiredRegistration[];
  fetchImpl?: typeof fetch;
}): Promise<EnsureRegistrationsResult> {
  const { webId, podRoot, registrations } = opts;
  const profileDocument = documentUrl(opts.profileDocumentUrl ?? webId);
  const profileUrl = new URL(profileDocument);
  if (
    !["http:", "https:"].includes(profileUrl.protocol) ||
    profileUrl.username ||
    profileUrl.password
  ) {
    throw new PodScopeError("Profile document must be an HTTP(S) URL without credentials.");
  }
  const authenticatedFetch = refuseRedirects(opts.fetchImpl);
  const profileFetch = documentFetch(profileDocument, authenticatedFetch);

  // Read-modify-write: both reads MUST revalidate — a heuristically cached
  // copy would carry a stale ETag into If-Match (spurious 412 on the write).
  const { dataset: profileDs, etag: profileEtag } = await freshRdf(profileDocument, profileFetch);
  const links = typeIndexLinks(webId, profileDs);
  let indexUrl = links.privateIndex ?? links.publicIndex;
  let bootstrapped = false;
  // The profile's trusted storage roots are independent of the import destination.
  const { indexUrl: selectedIndex, storageRoot: indexStorage } = validatedTypeIndexTarget(
    webId,
    profileDs,
    podRoot,
  );
  // Bind index access to the one profile-linked document (or bootstrap target).
  // A valid Pod URL alone does not grant access to unrelated Pod documents.
  const indexFetch = documentFetch(selectedIndex, authenticatedFetch);
  const fetchImpl: typeof fetch = (input, init) => {
    const snapshot = snapshotFetchInput(input, init, { forward: true, initSemantics: "direct" });
    assertWithinPodScope(indexStorage, snapshot.url, { allowRoot: false });
    return indexFetch(snapshot.input, snapshot.init);
  };

  if (!indexUrl) {
    indexUrl = new URL("settings/privateTypeIndex.ttl", podRoot).toString();
    await createIndexDocument(indexUrl, fetchImpl);
    // Link it from the profile (read-modify-write, ETag-guarded).
    const anchor = new ProfileTypeIndexAnchor(webId, profileDs, DataFactory);
    anchor.privateIndex = indexUrl;
    await writeResource(profileDocument, profileDs, {
      etag: profileEtag,
      fetchImpl: profileFetch,
    });
    bootstrapped = true;
  }

  const { dataset: indexDs, etag: indexEtag } = await freshRdf(indexUrl, fetchImpl);
  const index = new TypeIndexDataset(indexDs, DataFactory);

  let added = 0;
  for (const desired of registrations) {
    const exists = index.locate(desired.forClass).some((l) => l.container === desired.container);
    if (exists) continue;
    const reg = new TypeRegistration(
      `${indexUrl}#reg-${fragmentFor(desired)}`,
      indexDs,
      DataFactory,
    );
    reg.markRegistration();
    reg.forClass = desired.forClass;
    reg.instanceContainer = desired.container;
    added += 1;
  }

  if (added > 0) {
    await writeResource(indexUrl, indexDs, {
      etag: indexEtag,
      fetchImpl,
      prefixes: PREFIXES,
    });
  }
  return { indexUrl, added, bootstrapped };
}

/** Pin authenticated access to exactly one document, independently of its RDF subjects. */
function documentFetch(document: string, fetchImpl: typeof fetch): typeof fetch {
  return (input, init) => {
    const snapshot = snapshotFetchInput(input, init, { forward: true, initSemantics: "direct" });
    if (documentUrl(snapshot.url) !== document) {
      throw new PodScopeError("Type Index request is outside the selected document.");
    }
    return fetchImpl(snapshot.input, snapshot.init);
  };
}

/** Mint a fresh, empty private type index. Tolerates "already exists" (412). */
async function createIndexDocument(indexUrl: string, fetchImpl?: typeof fetch): Promise<void> {
  const store = new Store();
  new TypeIndexDocument(indexUrl, store, DataFactory).markUnlistedIndex();
  try {
    await writeResource(indexUrl, store, {
      createOnly: true,
      fetchImpl,
      prefixes: PREFIXES,
    });
  } catch (e) {
    // 412 under If-None-Match:* = the document already exists (e.g. created
    // out-of-band but never linked) — that is fine, we link and reuse it.
    if (e instanceof ResourceWriteError && e.status === 412) return;
    throw e;
  }
}

/** The profile *document* URL a WebID lives in (fragment stripped). */
function documentUrl(webId: string): string {
  const u = new URL(webId);
  u.hash = "";
  return u.toString();
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
