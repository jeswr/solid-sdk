// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Solid Type Index — read + (bootstrap) write through typed `@rdfjs/wrapper`
 * subclasses (never inline quads). The Type Index is how a pod owner advertises
 * *where* a given RDF class is stored, so independent apps discover each other's
 * data. CSS seeds none, so reads tolerate absence and the app bootstraps a
 * private index when missing.
 *
 * Pod Photos registers its `schema:Photograph` and `schema:ImageGallery`
 * containers here so its photos/albums also surface in any other Solid app that
 * reads the index (and vice-versa).
 */
import type { DatasetCore } from '@rdfjs/types';
import {
  DatasetWrapper,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from '@rdfjs/wrapper';
import { DataFactory, Store } from 'n3';
import { ResourceWriteError } from './errors.js';
import { freshRdf, writeResource } from './rdf.js';

const SOLID = 'http://www.w3.org/ns/solid/terms#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const TYPE_INDEX_PREFIXES = { solid: SOLID } as const;

/** One `solid:TypeRegistration` entry in a type-index document. */
export class TypeRegistration extends TermWrapper {
  /** Live set of `rdf:type` IRIs. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, `${RDF}type`, NamedNodeAs.string, NamedNodeFrom.string);
  }
  /** The RDF class this entry indexes (an IRI). */
  get forClass(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}forClass`, NamedNodeAs.string);
  }
  set forClass(v: string | undefined) {
    OptionalAs.object(this, `${SOLID}forClass`, v, NamedNodeFrom.string);
  }
  /** A single resource holding instances of `forClass`. */
  get instance(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}instance`, NamedNodeAs.string);
  }
  set instance(v: string | undefined) {
    OptionalAs.object(this, `${SOLID}instance`, v, NamedNodeFrom.string);
  }
  /** A container listing instances of `forClass`. */
  get instanceContainer(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}instanceContainer`, NamedNodeAs.string);
  }
  set instanceContainer(v: string | undefined) {
    OptionalAs.object(this, `${SOLID}instanceContainer`, v, NamedNodeFrom.string);
  }
  /** Stamp the entry as a TypeRegistration (call once when minting). */
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
  /** Every `solid:TypeRegistration` subject in the document. */
  get registrations(): Iterable<TypeRegistration> {
    return this.instancesOf(`${SOLID}TypeRegistration`, TypeRegistration);
  }
  /** All registered locations across every class. */
  all(): RegisteredLocation[] {
    const out: RegisteredLocation[] = [];
    for (const reg of this.registrations) {
      const forClass = reg.forClass;
      if (!forClass) continue;
      const loc: RegisteredLocation = { forClass };
      if (reg.instance !== undefined) loc.instance = reg.instance;
      if (reg.instanceContainer !== undefined) loc.container = reg.instanceContainer;
      out.push(loc);
    }
    return out;
  }
  /** Find the location(s) registered for a class IRI. */
  locate(classIri: string): RegisteredLocation[] {
    return this.all().filter((l) => l.forClass === classIri);
  }
}

/** The WebID subject's type-index links, readable AND writable (for bootstrap). */
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

/** The fresh type-index document's own subject. */
export class TypeIndexDocument extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, `${RDF}type`, NamedNodeAs.string, NamedNodeFrom.string);
  }
  /** Stamp the document as a private (unlisted) type index. */
  markUnlistedIndex(): void {
    this.types.add(`${SOLID}TypeIndex`);
    this.types.add(`${SOLID}UnlistedDocument`);
  }
}

/** The two type indexes advertised on a WebID profile (either may be absent). */
export interface TypeIndexLinks {
  publicIndex?: string;
  privateIndex?: string;
}

/** Read both `solid:*TypeIndex` links off the WebID subject of a profile dataset. */
export function typeIndexLinks(webId: string, profile: DatasetCore): TypeIndexLinks {
  const subject = new ProfileTypeIndexAnchor(webId, profile, DataFactory);
  const links: TypeIndexLinks = {};
  if (subject.publicIndex !== undefined) links.publicIndex = subject.publicIndex;
  if (subject.privateIndex !== undefined) links.privateIndex = subject.privateIndex;
  return links;
}

/** The profile *document* URL a WebID lives in (fragment stripped). */
function documentUrl(webId: string): string {
  const u = new URL(webId);
  u.hash = '';
  return u.toString();
}

/** Deterministic fragment for a registration (FNV-1a over class|container). */
function fragmentFor(forClass: string, container: string): string {
  const input = `${forClass}|${container}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

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

/** Mint a fresh, empty private type index. Tolerates "already exists" (412). */
async function createIndexDocument(indexUrl: string, fetchImpl?: typeof fetch): Promise<void> {
  const store = new Store();
  new TypeIndexDocument(indexUrl, store, DataFactory).markUnlistedIndex();
  try {
    await writeResource(indexUrl, store, {
      createOnly: true,
      fetchImpl,
      prefixes: TYPE_INDEX_PREFIXES,
    });
  } catch (e) {
    // 412 under If-None-Match:* = the document already exists; reuse it.
    if (e instanceof ResourceWriteError && e.status === 412) return;
    throw e;
  }
}

/**
 * Ensure every desired registration exists in the user's type index. Prefers
 * the private index; falls back to the public one; bootstraps
 * `settings/privateTypeIndex.ttl` under the pod root (and links it from the
 * profile) when neither exists. Idempotent — existing registrations are left
 * untouched, so re-running never duplicates entries.
 *
 * @param fetchImpl - test-only override; **omit in production** so the
 *   auth-patched global fetch runs.
 */
export async function ensureTypeRegistrations(opts: {
  webId: string;
  podRoot: string;
  registrations: DesiredRegistration[];
  fetchImpl?: typeof fetch;
}): Promise<EnsureRegistrationsResult> {
  const { webId, podRoot, registrations, fetchImpl } = opts;

  // Read-modify-write: revalidate so If-Match never carries a stale ETag.
  const { dataset: profileDs, etag: profileEtag } = await freshRdf(webId, fetchImpl);
  const links = typeIndexLinks(webId, profileDs);
  let indexUrl = links.privateIndex ?? links.publicIndex;
  let bootstrapped = false;

  if (!indexUrl) {
    indexUrl = new URL('settings/privateTypeIndex.ttl', podRoot).toString();
    await createIndexDocument(indexUrl, fetchImpl);
    const anchor = new ProfileTypeIndexAnchor(webId, profileDs, DataFactory);
    anchor.privateIndex = indexUrl;
    await writeResource(documentUrl(webId), profileDs, { etag: profileEtag, fetchImpl });
    bootstrapped = true;
  }

  const { dataset: indexDs, etag: indexEtag } = await freshRdf(indexUrl, fetchImpl);
  const index = new TypeIndexDataset(indexDs, DataFactory);

  let added = 0;
  for (const desired of registrations) {
    const exists = index.locate(desired.forClass).some((l) => l.container === desired.container);
    if (exists) continue;
    const reg = new TypeRegistration(
      `${indexUrl}#reg-${fragmentFor(desired.forClass, desired.container)}`,
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
      prefixes: TYPE_INDEX_PREFIXES,
    });
  }
  return { indexUrl, added, bootstrapped };
}
