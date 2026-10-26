// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6 — recover missing linked indexes
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
import { canonicalize, termsEqual } from "@jeswr/suite-vocab";
import type { DatasetCore } from "@rdfjs/types";
import {
  DatasetWrapper,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { ResourceWriteError } from "./errors.js";
import { readRdf, writeRdf } from "./rdf-io.js";
import { verifyPrivateIndexAccess } from "./type-index-access.js";
import { NS, RDF_TYPE } from "./vocab.js";

const SOLID = NS.SOLID;

/** One `solid:TypeRegistration` entry in a type-index document. */
export class TypeRegistration extends TermWrapper {
  get forClass(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}forClass`, NamedNodeAs.string);
  }
  set forClass(v: string | undefined) {
    OptionalAs.object(this, `${SOLID}forClass`, v, NamedNodeFrom.string);
  }
  get instance(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}instance`, NamedNodeAs.string);
  }
  set instance(v: string | undefined) {
    OptionalAs.object(this, `${SOLID}instance`, v, NamedNodeFrom.string);
  }
  get instanceContainer(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}instanceContainer`, NamedNodeAs.string);
  }
  set instanceContainer(v: string | undefined) {
    OptionalAs.object(this, `${SOLID}instanceContainer`, v, NamedNodeFrom.string);
  }
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  markRegistration(): void {
    this.types.add(`${SOLID}TypeRegistration`);
  }
}

/** A located registration: where data for a class lives. */
export interface RegisteredLocation {
  forClass: string;
  instance?: string | undefined;
  container?: string | undefined;
}

/** A type-index document, wrapped whole. */
export class TypeIndexDataset extends DatasetWrapper {
  get registrations(): Iterable<TypeRegistration> {
    return this.instancesOf(`${SOLID}TypeRegistration`, TypeRegistration);
  }
  all(): RegisteredLocation[] {
    const out: RegisteredLocation[] = [];
    for (const reg of this.registrations) {
      const forClass = reg.forClass;
      if (!forClass) continue;
      out.push({ forClass, instance: reg.instance, container: reg.instanceContainer });
    }
    return out;
  }
  locate(classIri: string): RegisteredLocation[] {
    return this.all().filter((l) => termsEqual(l.forClass, classIri));
  }
}

/** The two type-index links advertised on a WebID profile (either may be absent). */
export interface TypeIndexLinks {
  publicIndex?: string | undefined;
  privateIndex?: string | undefined;
}

/** The WebID subject's type-index links, readable AND (privateIndex) writable. */
export class ProfileTypeIndexAnchor extends TermWrapper {
  get publicIndex(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}publicTypeIndex`, NamedNodeAs.string);
  }
  get privateIndex(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}privateTypeIndex`, NamedNodeAs.string);
  }
  set privateIndex(v: string | undefined) {
    OptionalAs.object(this, `${SOLID}privateTypeIndex`, v, NamedNodeFrom.string);
  }
}

/** The type-index document's own subject — used when minting a fresh index. */
export class TypeIndexDocument extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  markUnlistedIndex(): void {
    this.types.add(`${SOLID}TypeIndex`);
    this.types.add(`${SOLID}UnlistedDocument`);
  }
}

/** Read both `solid:*TypeIndex` links off the WebID subject of a profile dataset. */
export function typeIndexLinks(webId: string, profile: DatasetCore): TypeIndexLinks {
  const subject = new ProfileTypeIndexAnchor(webId, profile, DataFactory);
  return { publicIndex: subject.publicIndex, privateIndex: subject.privateIndex };
}

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
  /** True when private index bootstrap ran (linking it from the profile if needed). */
  bootstrapped: boolean;
}

const INDEX_PREFIXES = { solid: SOLID };

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
 * profile — when no private index exists. A linked index returning 404 is created
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
  // Linking races with other first-use clients too: always re-read the profile
  // after a conflict and prefer the link that the other writer established.
  for (let attempt = 0; ; attempt++) {
    const { dataset: profileDs, etag: profileEtag } = await readRdf(webId, profileFetch);
    const linked = typeIndexLinks(webId, profileDs).privateIndex;
    if (linked) {
      indexUrl = assertWithinPodScope(podRoot, linked);
      break;
    }
    indexUrl = new URL("settings/privateTypeIndex.ttl", podRoot).toString();
    await createIndexDocument(indexUrl, fetchImpl);
    bootstrapped = true;
    await verifyPrivateIndexAccess(indexUrl, webId, podRoot, fetchImpl);
    new ProfileTypeIndexAnchor(webId, profileDs, DataFactory).privateIndex = indexUrl;
    try {
      await writeRdf(documentUrl(webId), profileDs, {
        etag: profileEtag ?? "*",
        fetchImpl: profileFetch,
      });
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
 */
export async function discoverRegistrations(
  webId: string,
  profile: DatasetCore,
  fetchImpl: typeof fetch,
  podRoot: string,
): Promise<RegisteredLocation[]> {
  const links = typeIndexLinks(webId, profile);
  const urls = [links.publicIndex, links.privateIndex].filter((u): u is string => Boolean(u));
  const checked = urls.map((url) => assertWithinPodScope(podRoot, url));
  const scopedFetch = createPodScopedFetch(podRoot, { fetch: fetchImpl });
  const out: RegisteredLocation[] = [];
  for (const url of checked) {
    try {
      const { dataset } = await readRdf(url, scopedFetch);
      for (const location of new TypeIndexDataset(dataset, DataFactory).all()) {
        if (location.instance && !podScopedUrl(podRoot, location.instance)) continue;
        if (location.container && !podScopedUrl(podRoot, location.container)) continue;
        out.push(location);
      }
    } catch (e) {
      if (e instanceof RdfFetchError && (e.status === 404 || e.status === 403)) continue;
      throw e;
    }
  }
  return out;
}
