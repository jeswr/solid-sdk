// AUTHORED-BY Codex GPT-6.1-Sol
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
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import { DIET_MEAL, DIET_SYMPTOM, LEGACY_DIET_NS, docOf } from "@jeswr/solid-health-diary";
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
import { type PodStorage, resolvePodStorage } from "./client";
import { mealsContainer, symptomsContainer } from "./layout";
import { ensureContainer, PodWriteError, putResource, writeOwnerOnlyAcl } from "./pod-fs";
import { conditionalPut, datasetToTurtle } from "./rdf-io";

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
    const legacyClass = classIri === DIET_MEAL ? `${LEGACY_DIET_NS}Meal`
      : classIri === DIET_SYMPTOM ? `${LEGACY_DIET_NS}Symptom` : undefined;
    for (const reg of this.registrations) {
      const registeredClass = reg.forClass;
      if (
        (registeredClass === classIri || (legacyClass !== undefined && registeredClass === legacyClass)) &&
        reg.instanceContainer === container
      ) return true;
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
  return OptionalFrom.subjectPredicate(
    new TermWrapper(webId, dataset, DataFactory), `${SOLID}privateTypeIndex`, NamedNodeAs.string,
  );
}

/**
 * Profiles and existing indexes may live outside storage (e.g. ESS). Only these
 * documents use a separate authenticated transport, scoped to their own origin;
 * redirects are returned as failures, never followed. Diary data stays on the client.
 */
async function readRegistrationDocument(
  storage: PodStorage,
  url: string,
  fetch?: typeof globalThis.fetch,
): Promise<{ dataset: DatasetCore; put: (body: string) => Promise<void> }> {
  const client = await resolvePodStorage(storage);
  if (client.isWithinStorage(url)) {
    const { dataset, etag } = await client.readRdf(url);
    return { dataset, put: (body) => conditionalPut(client, url, body, etag) };
  }
  if (!fetch) throw new Error("Authenticated profile and Type Index access is unavailable");
  const scoped = createPodScopedFetch(new URL(url).origin, { fetch });
  const documentFetch: typeof globalThis.fetch = (input, init) =>
    scoped(input, { ...init, redirect: "manual" });
  const { dataset, etag } = await fetchRdf(url, { fetch: documentFetch });
  return {
    dataset,
    put: async (body) => {
      const headers = new Headers({ "content-type": "text/turtle" });
      if (etag) headers.set("if-match", etag);
      const response = await documentFetch(url, { method: "PUT", headers, body });
      if (!response.ok) {
        throw new PodWriteError(url, response.status, undefined, undefined, response.statusText);
      }
    },
  };
}

/** Add + persist the diary registrations into an existing index document. */
async function registerIntoIndex(
  storage: PodStorage,
  indexUrl: string,
  storageRoot: string,
  fetch?: typeof globalThis.fetch,
): Promise<void> {
  const { dataset, put } = await readRegistrationDocument(storage, indexUrl, fetch);
  const index = new TypeIndexDataset(dataset, DataFactory);
  let changed = false;
  for (const { classIri, container } of diaryRegistrations(storageRoot)) {
    if (!index.hasRegistration(classIri, container)) {
      index.register(indexUrl, regFragment(classIri), classIri, container);
      changed = true;
    }
  }
  if (changed) {
    await put(await datasetToTurtle(dataset));
  }
}

/** Create a fresh private index doc (typed) with the diary registrations, ACL-first. */
async function createIndex(
  storage: PodStorage,
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
  await ensureContainer(storage, new URL("./", indexUrl).toString());
  await writeOwnerOnlyAcl(storage, indexUrl, ownerWebId);
  await putResource(storage, indexUrl, await datasetToTurtle(store));
}

/** Link a freshly-created private index from the profile (conditional PUT). */
async function linkIndexFromProfile(
  storage: PodStorage,
  webId: string,
  indexUrl: string,
  fetch?: typeof globalThis.fetch,
): Promise<void> {
  const profileDoc = docOf(webId);
  const { dataset, put } = await readRegistrationDocument(storage, profileDoc, fetch);
  const profile = new TermWrapper(webId, dataset, DataFactory);
  SetFrom.subjectPredicate(profile, `${SOLID}privateTypeIndex`, NamedNodeAs.string, NamedNodeFrom.string)
    .add(indexUrl);
  await put(await datasetToTurtle(dataset));
}

/**
 * Register the diary's `diet:Meal` / `diet:Symptom` types in the pod owner's
 * private type index (create-and-link when absent). Rejects on failure so the
 * caller can show a warning while continuing logging. Idempotent across sessions.
 * Supply the authenticated fetch for profile/index documents outside storage.
 */
export async function registerDiaryTypes(
  storage: PodStorage,
  params: { webId: string; storageRoot: string; fetch?: typeof globalThis.fetch },
): Promise<{ registered: boolean; indexUrl?: string }> {
  const { webId, storageRoot, fetch } = params;
  const { dataset } = await readRegistrationDocument(storage, docOf(webId), fetch);
  const existing = privateIndexOf(dataset, webId);
  if (existing) {
    await registerIntoIndex(storage, existing, storageRoot, fetch);
    return { registered: true, indexUrl: existing };
  }
  const indexUrl = new URL("settings/privateTypeIndex.ttl", storageRoot).toString();
  await createIndex(storage, indexUrl, storageRoot, webId);
  await linkIndexFromProfile(storage, webId, indexUrl, fetch);
  return { registered: true, indexUrl };
}
