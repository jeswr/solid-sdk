// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Private type-index registration (DESIGN §2.3, solid-type-index skill). Registers
 * `diet:Meal` → the meals container and `diet:Symptom` → the symptoms container in
 * the pod owner's **PRIVATE** type index (never the public one — the diary is
 * sensitive), so Pod Manager and future apps can discover the diary privately.
 *
 * Read-and-create-and-link: read `solid:privateTypeIndex` off the profile; if
 * absent, create `${storageRoot}settings/privateTypeIndex.ttl` (typed
 * `solid:TypeIndex` + `solid:UnlistedDocument`, owner-only ACL), then link it from
 * the profile with a conditional PUT. Idempotent: an already-present registration
 * for a class+container is left untouched.
 *
 * Registration is INTEROP, not the diary's own storage path — a failure here must
 * never break logging, so the caller runs this best-effort. Wrappers per the
 * skill's compile-verified `@rdfjs/wrapper` recipe; never hand-built triples.
 */
import { fetchRdf } from "@jeswr/fetch-rdf";
import { DIET_MEAL, DIET_SYMPTOM, docOf } from "@jeswr/solid-health-diary";
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
import { mealsContainer, symptomsContainer } from "./layout.js";
import { ensureContainer, putResource } from "./pod-fs.js";
import { conditionalPut, datasetToTurtle } from "./rdf-io.js";
import { writeOwnerOnlyAcl } from "@jeswr/solid-health-diary";

const SOLID = "http://www.w3.org/ns/solid/terms#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

/** One `solid:TypeRegistration` entry. */
class TypeRegistration extends TermWrapper {
  get forClass(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}forClass`, NamedNodeAs.string);
  }
  set forClass(v: string | undefined) {
    OptionalAs.object(this, `${SOLID}forClass`, v, NamedNodeFrom.string);
  }
  get instanceContainer(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}instanceContainer`, NamedNodeAs.string);
  }
  set instanceContainer(v: string | undefined) {
    OptionalAs.object(this, `${SOLID}instanceContainer`, v, NamedNodeFrom.string);
  }
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, `${RDF}type`, NamedNodeAs.string, NamedNodeFrom.string);
  }
  markRegistration(): void {
    this.types.add(`${SOLID}TypeRegistration`);
  }
}

/** A type-index document wrapped whole (registrations are sibling subjects). */
class TypeIndexDataset extends DatasetWrapper {
  get registrations(): Iterable<TypeRegistration> {
    return this.instancesOf(`${SOLID}TypeRegistration`, TypeRegistration);
  }
  /** Whether a class is already registered against a container (idempotency). */
  hasRegistration(classIri: string, container: string): boolean {
    for (const reg of this.registrations) {
      if (reg.forClass === classIri && reg.instanceContainer === container) return true;
    }
    return false;
  }
  /** Add a registration for `classIri` → `container` in this document. */
  register(indexUrl: string, fragment: string, classIri: string, container: string): void {
    const reg = new TypeRegistration(`${indexUrl}${fragment}`, this, this.factory);
    reg.markRegistration();
    reg.forClass = classIri;
    reg.instanceContainer = container;
  }
}

/** A short random fragment id for a registration subject. */
function regFragment(classIri: string): string {
  const local = classIri.slice(classIri.lastIndexOf("#") + 1).toLowerCase() || "class";
  return `#registration-${local}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The registrations the diary owns: diet:Meal + diet:Symptom → their containers. */
function diaryRegistrations(storageRoot: string): { classIri: string; container: string }[] {
  return [
    { classIri: DIET_MEAL, container: mealsContainer(storageRoot) },
    { classIri: DIET_SYMPTOM, container: symptomsContainer(storageRoot) },
  ];
}

/**
 * Read `solid:privateTypeIndex` declared BY THE AUTHENTICATED WEBID SUBJECT (never
 * an unrelated subject in the profile document — that could point the app at a
 * foreign index), if present.
 */
function privateIndexOf(dataset: DatasetCore, webId: string): string | undefined {
  const subject = DataFactory.namedNode(webId);
  const predicate = DataFactory.namedNode(`${SOLID}privateTypeIndex`);
  for (const q of dataset.match(subject, predicate, null)) {
    if (q.object.termType === "NamedNode") return q.object.value;
  }
  return undefined;
}

/** Add + persist the diary registrations into an existing index document. */
async function registerIntoIndex(
  authedFetch: typeof globalThis.fetch,
  indexUrl: string,
  storageRoot: string,
): Promise<void> {
  const { dataset, etag } = await fetchRdf(indexUrl, { fetch: authedFetch });
  const index = new TypeIndexDataset(dataset, DataFactory);
  let changed = false;
  for (const { classIri, container } of diaryRegistrations(storageRoot)) {
    if (!index.hasRegistration(classIri, container)) {
      index.register(indexUrl, regFragment(classIri), classIri, container);
      changed = true;
    }
  }
  if (changed) {
    await conditionalPut(authedFetch, indexUrl, await datasetToTurtle(dataset), etag);
  }
}

/** Create a fresh private index doc (typed) with the diary registrations, ACL-first. */
async function createIndex(
  authedFetch: typeof globalThis.fetch,
  indexUrl: string,
  storageRoot: string,
  ownerWebId: string,
): Promise<void> {
  const store = new Store();
  const index = new TypeIndexDataset(store, DataFactory);
  // Type the document `<>` as solid:TypeIndex + solid:UnlistedDocument.
  const doc = new TermWrapper(indexUrl, store, DataFactory);
  const docTypes = SetFrom.subjectPredicate(
    doc,
    `${RDF}type`,
    NamedNodeAs.string,
    NamedNodeFrom.string,
  );
  docTypes.add(`${SOLID}TypeIndex`);
  docTypes.add(`${SOLID}UnlistedDocument`);
  for (const { classIri, container } of diaryRegistrations(storageRoot)) {
    index.register(indexUrl, regFragment(classIri), classIri, container);
  }
  // ACL FIRST (owner-only) before the index doc is written — it is sensitive.
  await ensureContainer(authedFetch, new URL("./", indexUrl).toString());
  await writeOwnerOnlyAcl(indexUrl, ownerWebId, authedFetch);
  await putResource(authedFetch, indexUrl, await datasetToTurtle(store));
}

/** Link a freshly-created private index from the profile (conditional PUT). */
async function linkIndexFromProfile(
  authedFetch: typeof globalThis.fetch,
  webId: string,
  indexUrl: string,
): Promise<void> {
  const profileDoc = docOf(webId);
  const { dataset, etag } = await fetchRdf(profileDoc, { fetch: authedFetch });
  dataset.add(
    DataFactory.quad(
      DataFactory.namedNode(webId),
      DataFactory.namedNode(`${SOLID}privateTypeIndex`),
      DataFactory.namedNode(indexUrl),
    ),
  );
  await conditionalPut(authedFetch, profileDoc, await datasetToTurtle(dataset), etag);
}

/**
 * Register the diary's `diet:Meal` / `diet:Symptom` types in the pod owner's
 * private type index (create-and-link when absent). Best-effort: resolves
 * `{ registered, indexUrl? }`; NEVER throws (a registration failure must not break
 * logging). Idempotent across sessions.
 */
export async function registerDiaryTypes(
  authedFetch: typeof globalThis.fetch,
  params: { webId: string; storageRoot: string },
): Promise<{ registered: boolean; indexUrl?: string }> {
  const { webId, storageRoot } = params;
  try {
    const { dataset } = await fetchRdf(docOf(webId), { fetch: authedFetch });
    const existing = privateIndexOf(dataset, webId);
    if (existing) {
      await registerIntoIndex(authedFetch, existing, storageRoot);
      return { registered: true, indexUrl: existing };
    }
    const indexUrl = `${new URL("settings/privateTypeIndex.ttl", storageRoot).toString()}`;
    await createIndex(authedFetch, indexUrl, storageRoot, webId);
    await linkIndexFromProfile(authedFetch, webId, indexUrl);
    return { registered: true, indexUrl };
  } catch {
    return { registered: false };
  }
}
