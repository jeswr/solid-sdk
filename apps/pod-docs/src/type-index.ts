// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
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
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import {
  assertSafeUrl,
  createGuardedFetch,
  isLoopbackAddress,
  isWithinPodScope,
} from "@jeswr/guarded-fetch";
import { type StorageClient, StorageError, toStorageError } from "@jeswr/storage-client";
import { canonicalize, NS as SUITE_NS, termsEqual } from "@jeswr/suite-vocab";
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
import { Agent } from "@solid/object";
import { DataFactory, Store } from "n3";
import {
  REVALIDATE_HEADERS,
  readRdf,
  requireEtag,
  serializeTurtle,
  storageFor,
  writeRdf,
} from "./rdf-io.js";
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
  instance?: string;
  container?: string;
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
  publicIndex?: string;
  privateIndex?: string;
}

export interface IdentityReadOptions {
  /** Development only: permit HTTP on localhost or a loopback IP, on every hop. */
  allowInsecureLoopback?: boolean;
}

/** The WebID subject's type-index links, readable AND (privateIndex) writable. */
export class ProfileTypeIndexAnchor extends TermWrapper {
  /** Preferences must resolve unambiguously before a public fallback is safe. */
  get preferencesFile(): string | undefined {
    const urls = [
      ...SetFrom.subjectPredicate(
        this,
        `${SUITE_NS.PIM}preferencesFile`,
        NamedNodeAs.string,
        NamedNodeFrom.string,
      ),
    ];
    if (urls.length > 1) throw new StorageError("conflict", { url: this.value, method: "GET" });
    return urls[0];
  }
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

/** Resolve the standard private pointer before selecting or discovering indexes. */
async function resolveTypeIndexLinks(
  webId: string,
  profile: DatasetCore,
  fetchImpl?: typeof fetch,
  storage?: StorageClient,
  options: IdentityReadOptions = {},
): Promise<TypeIndexLinks> {
  const links = typeIndexLinks(webId, profile);
  const preferences = new ProfileTypeIndexAnchor(webId, profile, DataFactory).preferencesFile;
  if (!preferences) return links;
  // Account metadata can live in another pod. Only this WebID's storage claims
  // vouch for additional roots; never discover storage from the identity document.
  const requireVouched = identityScope(webId, profile, storage, options);
  requireVouched(preferences);
  // Unreadable, missing or malformed linked preferences are not proof that no private
  // index exists. Propagate the failure rather than registering in the public index.
  const { dataset } = await readIdentityRdf(
    preferences,
    fetchImpl,
    storage,
    options,
    requireVouched,
  );
  const anchor = new ProfileTypeIndexAnchor(webId, dataset, DataFactory);
  const indexes = [
    ...SetFrom.subjectPredicate(
      anchor,
      `${SOLID}privateTypeIndex`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    ),
  ];
  if (indexes.length > 1) throw new StorageError("conflict", { url: preferences, method: "GET" });
  const privateIndex = indexes[0];
  if (privateIndex) {
    requireVouched(privateIndex);
    if (links.privateIndex && documentUrl(links.privateIndex) !== documentUrl(privateIndex))
      throw new StorageError("conflict", { url: preferences, method: "GET" });
    links.privateIndex = privateIndex;
  }
  return links;
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
  /** True when a fresh private index was created and linked. */
  bootstrapped: boolean;
}

const INDEX_PREFIXES = { solid: SOLID };

/** The profile *document* URL a WebID lives in (fragment stripped). */
function documentUrl(webId: string): string {
  const u = new URL(webId);
  u.hash = "";
  return u.toString();
}

/** HTTPS by default; explicit development HTTP is limited to loopback. */
function identityDocumentUrl(url: string, options: IdentityReadOptions): string {
  const target = new URL(url);
  const loopbackHttp =
    options.allowInsecureLoopback === true &&
    target.protocol === "http:" &&
    (target.hostname === "localhost" || isLoopbackAddress(target.hostname.replace(/^\[|\]$/g, "")));
  if (
    (target.protocol !== "https:" && !loopbackHttp) ||
    target.username ||
    target.password ||
    target.href !== url ||
    /%2f|%5c/i.test(target.pathname)
  )
    throw new StorageError("scope", { url, method: "GET" });
  return documentUrl(url);
}

/** Only the authenticated WebID's own storage claims can vouch for private metadata. */
function identityScope(
  webId: string,
  profile: DatasetCore,
  storage: StorageClient | undefined,
  options: IdentityReadOptions,
): (url: string) => void {
  const roots = [...new Agent(webId, profile, DataFactory).storageUrls];
  return (url) => {
    const target = identityDocumentUrl(url, options);
    if (
      !storage?.isWithinStorage(target) &&
      !roots.some((root) => isWithinPodScope(identityDocumentUrl(root, options), target))
    )
      throw new StorageError("scope", { url: target, method: "GET" });
  };
}

/** Profiles, preferences and indexes are identity documents, not storage discovery targets. */
async function readIdentityRdf(
  url: string,
  fetchImpl = globalThis.fetch,
  storage?: StorageClient,
  options: IdentityReadOptions = {},
  validateTarget?: (url: string) => void,
) {
  const target = identityDocumentUrl(url, options);
  validateTarget?.(target);
  if (storage?.isWithinStorage(target)) {
    try {
      return await readRdf(target, fetchImpl, storage);
    } catch (error) {
      // Storage refuses redirects, including browser-filtered status 0. Re-probe
      // these through the guard, which detects opaqueredirect before allowing follow.
      if (
        !(error instanceof StorageError) ||
        ![0, 301, 302, 303, 307, 308].includes(error.status ?? -1)
      )
        throw error;
    }
  }
  const guarded = createGuardedFetch({
    // Browser session fetch owns DNS and opaque redirects; it cannot use an undici dispatcher.
    requireDnsPinning: false,
    allowLoopback: options.allowInsecureLoopback === true,
    fetch: async (input, init) => {
      const hop = identityDocumentUrl(String(input), options);
      validateTarget?.(hop);
      const response = await fetchImpl(hop, { ...init, redirect: "manual" });
      if (response.type === "opaqueredirect") {
        void response.body?.cancel();
        // Browsers hide Location on manual redirects. Retry anonymously, retaining
        // the guard's deadline/body cap, then validate the observable final target.
        // Intermediate hops are opaque; never send cookies or token headers on them.
        const headers = new Headers(init?.headers);
        for (const name of ["authorization", "dpop", "cookie", "proxy-authorization"])
          headers.delete(name);
        const followed = await fetchImpl(hop, {
          ...init,
          headers,
          redirect: "follow",
          credentials: "omit",
        });
        try {
          if (
            !followed.url ||
            followed.status === 0 ||
            followed.redirected !== (followed.url !== hop)
          )
            throw new StorageError("scope", { url: hop, method: "GET" });
          const final = identityDocumentUrl(followed.url, options);
          if (new URL(hop).protocol === "https:" && new URL(final).protocol !== "https:")
            throw new StorageError("scope", { url: final, method: "GET" });
          validateTarget?.(final);
          await assertSafeUrl(final, { allowLoopback: options.allowInsecureLoopback === true });
          return followed;
        } catch (error) {
          void followed.body?.cancel();
          throw error;
        }
      }
      // A transport ignoring manual mode must not bypass visible-hop validation.
      if (response.status === 0 || response.redirected || (response.url && response.url !== hop)) {
        void response.body?.cancel();
        throw new StorageError("scope", { url: hop, method: "GET" });
      }
      return response;
    },
  });
  const result = await fetchRdf(target, {
    headers: REVALIDATE_HEADERS,
    // The guard follows and validates visible hops; its transport above stays manual.
    // Keep its sanitised errors: raw transport causes are deliberately not exposed.
    fetch: (input, init) => guarded(input, { ...init, redirect: "follow" }),
  });
  return { ...result, url: identityDocumentUrl(result.url, options) };
}

/** External profiles and indexes are RDF documents, independent of storage discovery. */
async function writeExternalRdf(
  url: string,
  dataset: DatasetCore,
  etag: string | null,
  fetchImpl = globalThis.fetch,
  prefixes?: Record<string, string>,
): Promise<void> {
  const response = await fetchImpl(url, {
    method: "PUT",
    redirect: "manual",
    headers: {
      "content-type": "text/turtle",
      "if-match": requireEtag(etag, url),
    },
    body: await serializeTurtle(dataset, prefixes),
  });
  void response.body?.cancel();
  if (!response.ok || response.redirected) throw toStorageError("PUT", url, response);
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
async function createIndexDocument(
  indexUrl: string,
  fetchImpl?: typeof fetch,
  storage?: StorageClient,
): Promise<void> {
  const store = new Store();
  new TypeIndexDocument(indexUrl, store, DataFactory).markUnlistedIndex();
  try {
    await writeRdf(indexUrl, store, {
      createOnly: true,
      storage,
      fetchImpl,
      prefixes: INDEX_PREFIXES,
    });
  } catch (e) {
    // 412 under If-None-Match:* = the document already exists — fine, link + reuse.
    if (e instanceof StorageError && e.code === "conflict") return;
    throw e;
  }
}

/**
 * Ensure every desired registration exists in the user's type index.
 *
 * Resolves private links through preferences (and legacy profile links) before
 * falling back to the public index. Unresolvable preferences fail closed. Bootstraps
 * `settings/privateTypeIndex.ttl` under the pod root — and links it from the
 * profile — when neither exists. Idempotent: existing registrations are left
 * untouched.
 *
 * @param fetchImpl - the session's authenticated fetch; defaults to the
 *   unauthenticated global fetch.
 */
export async function ensureTypeRegistrations(
  opts: {
    webId: string;
    podRoot: string;
    registrations: DesiredRegistration[];
    fetchImpl?: typeof fetch;
    storage?: StorageClient;
  } & IdentityReadOptions,
): Promise<EnsureRegistrationsResult> {
  const { webId, podRoot, registrations, fetchImpl } = opts;
  const storage = await storageFor(podRoot, fetchImpl, opts.storage);

  // A WebID can live outside every pod. It is an RDF document, not a storage root.
  const {
    dataset: profileDs,
    etag: profileEtag,
    url: profileUrl,
  } = await readIdentityRdf(webId, fetchImpl, storage, opts);
  const profileStorage = storage.isWithinStorage(profileUrl) ? storage : undefined;
  const links = await resolveTypeIndexLinks(webId, profileDs, fetchImpl, storage, opts);
  let indexUrl = links.privateIndex ?? links.publicIndex;
  let bootstrapped = false;

  if (!indexUrl) {
    indexUrl = new URL("settings/privateTypeIndex.ttl", podRoot).toString();
    const settings = new URL("settings/", podRoot).href;
    try {
      await storage.head(settings, { revalidate: true });
    } catch (error) {
      if (!(error instanceof StorageError) || error.code !== "not-found") throw error;
      await storage.create(podRoot, null, { kind: "container", name: "settings" });
    }
    await createIndexDocument(indexUrl, fetchImpl, storage);
    const anchor = new ProfileTypeIndexAnchor(webId, profileDs, DataFactory);
    anchor.privateIndex = indexUrl;
    if (profileStorage) {
      await writeRdf(profileUrl, profileDs, { etag: profileEtag, storage: profileStorage });
    } else {
      await writeExternalRdf(profileUrl, profileDs, profileEtag, fetchImpl);
    }
    bootstrapped = true;
  }

  const requireVouched = identityScope(webId, profileDs, storage, opts);
  const indexOrigin = new URL(indexUrl).origin;
  const {
    dataset: indexDs,
    etag: indexEtag,
    url: indexDocument,
  } = await readIdentityRdf(indexUrl, fetchImpl, storage, opts, (target) => {
    if (new URL(target).origin !== indexOrigin) requireVouched(target);
  });
  indexUrl = indexDocument;
  const indexStorage = storage.isWithinStorage(indexUrl) ? storage : undefined;
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

  if (added > 0) {
    if (indexStorage) {
      await writeRdf(indexUrl, indexDs, {
        etag: indexEtag,
        storage: indexStorage,
        prefixes: INDEX_PREFIXES,
      });
    } else {
      await writeExternalRdf(indexDocument, indexDs, indexEtag, fetchImpl, INDEX_PREFIXES);
    }
  }
  return { indexUrl, added, bootstrapped };
}

/**
 * Read a WebID profile's type indexes and return every registered location.
 * The profile dataset must already be fetched (it carries the index links).
 * Resolves private indexes via preferences as well as legacy profile links.
 * A missing/unreadable index (404/403) contributes nothing rather than failing;
 * unresolved linked preferences propagate so an incomplete discovery is not hidden.
 */
export async function discoverRegistrations(
  webId: string,
  profile: DatasetCore,
  fetchImpl?: typeof fetch,
  storage?: StorageClient,
  options: IdentityReadOptions = {},
): Promise<RegisteredLocation[]> {
  const links = await resolveTypeIndexLinks(webId, profile, fetchImpl, storage, options);
  const urls = [links.publicIndex, links.privateIndex].filter((u): u is string => Boolean(u));
  const out: RegisteredLocation[] = [];
  if (urls.length === 0) return out;
  for (const url of urls) {
    try {
      // Indexes are RDF documents; cold reads need no storage-discovery headers.
      const origin = new URL(url).origin;
      const requireVouched = identityScope(webId, profile, storage, options);
      const { dataset } = await readIdentityRdf(url, fetchImpl, storage, options, (target) => {
        if (new URL(target).origin !== origin) requireVouched(target);
      });
      out.push(...new TypeIndexDataset(dataset, DataFactory).all());
    } catch (e) {
      if (
        (e instanceof StorageError || e instanceof RdfFetchError) &&
        (e.status === 404 || e.status === 403)
      )
        continue;
      throw e;
    }
  }
  return out;
}
