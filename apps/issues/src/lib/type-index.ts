import {
  TermWrapper,
  DatasetWrapper,
  OptionalFrom,
  OptionalAs,
  SetFrom,
  NamedNodeAs,
  NamedNodeFrom,
} from "@rdfjs/wrapper";
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { Store, DataFactory, Writer } from "n3";
import type { DatasetCore } from "@rdfjs/types";
import { RDF, wf } from "./vocab";
import { grantPublicRead } from "./sharing";

/** Solid type-index vocabulary (https://solid.github.io/type-indexes/). */
const SOLID = "http://www.w3.org/ns/solid/terms#";
const solid = (l: string) => `${SOLID}${l}`;

/** Reads/writes the type-index links on a WebID subject. */
class ProfileLinks extends TermWrapper {
  get publicTypeIndex(): string | undefined {
    return OptionalFrom.subjectPredicate(this, solid("publicTypeIndex"), NamedNodeAs.string);
  }
  set publicTypeIndex(v: string | undefined) {
    OptionalAs.object(this, solid("publicTypeIndex"), v, NamedNodeFrom.string);
  }
}

/** One `solid:TypeRegistration` entry (worked example from the solid-type-index skill). */
class TypeRegistration extends TermWrapper {
  get forClass(): string | undefined {
    return OptionalFrom.subjectPredicate(this, solid("forClass"), NamedNodeAs.string);
  }
  set forClass(v: string | undefined) {
    OptionalAs.object(this, solid("forClass"), v, NamedNodeFrom.string);
  }
  get instance(): string | undefined {
    return OptionalFrom.subjectPredicate(this, solid("instance"), NamedNodeAs.string);
  }
  set instance(v: string | undefined) {
    OptionalAs.object(this, solid("instance"), v, NamedNodeFrom.string);
  }
  /** A container whose members are instances of `forClass` (`solid:instanceContainer`). */
  get instanceContainer(): string | undefined {
    return OptionalFrom.subjectPredicate(this, solid("instanceContainer"), NamedNodeAs.string);
  }
  set instanceContainer(v: string | undefined) {
    OptionalAs.object(this, solid("instanceContainer"), v, NamedNodeFrom.string);
  }
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, `${RDF}type`, NamedNodeAs.string, NamedNodeFrom.string);
  }
  markRegistration(): void {
    this.types.add(solid("TypeRegistration"));
  }
}

/** A type-index document, wrapped whole (registrations are sibling subjects). */
class TypeIndexDataset extends DatasetWrapper {
  get registrations(): Iterable<TypeRegistration> {
    return this.instancesOf(solid("TypeRegistration"), TypeRegistration);
  }

  /** All `solid:instance` URLs registered for a class IRI. */
  locate(classIri: string): string[] {
    const out: string[] = [];
    for (const reg of this.registrations) {
      if (reg.forClass === classIri && reg.instance) out.push(reg.instance);
    }
    return out;
  }

  /**
   * All `solid:instanceContainer` URLs registered for a class IRI.
   * Used by the Pod Manager to enumerate cross-app `wf:Task` containers.
   */
  locateContainers(classIri: string): string[] {
    const out: string[] = [];
    for (const reg of this.registrations) {
      if (reg.forClass === classIri && reg.instanceContainer) out.push(reg.instanceContainer);
    }
    return out;
  }

  /** Add (or refresh) a registration mapping `classIri` → `instanceUrl` via `solid:instance`. */
  register(indexUrl: string, fragment: string, classIri: string, instanceUrl: string): void {
    const reg = new TypeRegistration(`${indexUrl}${fragment}`, this, this.factory);
    reg.markRegistration();
    reg.forClass = classIri;
    reg.instance = instanceUrl;
  }

  /**
   * Add (or refresh) a registration mapping `classIri` → `containerUrl` via
   * `solid:instanceContainer` (used for the `wf:Task` issues container so that
   * cross-app discovery enumerates individual tasks, not just the tracker document).
   */
  registerContainer(indexUrl: string, fragment: string, classIri: string, containerUrl: string): void {
    const reg = new TypeRegistration(`${indexUrl}${fragment}`, this, this.factory);
    reg.markRegistration();
    reg.forClass = classIri;
    reg.instanceContainer = containerUrl;
  }

  /** Stamp the document as a public, listed type index. */
  markPublicIndex(indexUrl: string): void {
    const types = SetFrom.subjectPredicate(
      new TermWrapper(indexUrl, this, this.factory),
      `${RDF}type`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
    types.add(solid("TypeIndex"));
    types.add(solid("ListedDocument"));
  }
}

const opts = (fetchImpl?: typeof fetch) => ({ headers: { "cache-control": "no-cache" }, ...(fetchImpl ? { fetch: fetchImpl } : {}) });

function serialize(dataset: DatasetCore): Promise<string> {
  const writer = new Writer({ format: "text/turtle" });
  for (const q of dataset) writer.addQuad(q);
  return new Promise((resolve, reject) =>
    writer.end((err, result) => (err ? reject(err) : resolve(result))),
  );
}

async function conditionalPut(
  url: string,
  dataset: DatasetCore,
  etag: string | null,
  fetchImpl: typeof fetch,
): Promise<void> {
  const body = await serialize(dataset);
  const headers: Record<string, string> = { "content-type": "text/turtle" };
  if (etag) headers["if-match"] = etag;
  const res = await fetchImpl(url, { method: "PUT", headers, body });
  if (!res.ok && res.status !== 205) throw new Error(`type-index PUT ${url} -> ${res.status}`);
}

/**
 * All tracker documents a WebID has registered for `wf:Tracker` via their
 * public type index (one per project/workspace). Empty when no index or no
 * registration exists — discovery is a hint, not a guarantee of access
 * (solid-type-index skill).
 */
export async function resolveTrackersFromTypeIndex(
  webId: string,
  fetchImpl?: typeof fetch,
): Promise<string[]> {
  let profile: DatasetCore;
  try {
    profile = (await fetchRdf(webId, opts(fetchImpl))).dataset;
  } catch {
    return [];
  }
  const indexUrl = new ProfileLinks(webId, profile, DataFactory).publicTypeIndex;
  if (!indexUrl) return [];
  try {
    const { dataset } = await fetchRdf(indexUrl, opts(fetchImpl));
    return new TypeIndexDataset(dataset, DataFactory).locate(wf("Tracker"));
  } catch {
    return [];
  }
}

/** The first registered tracker, for single-tracker call sites. */
export async function resolveTrackerFromTypeIndex(
  webId: string,
  fetchImpl?: typeof fetch,
): Promise<string | undefined> {
  return (await resolveTrackersFromTypeIndex(webId, fetchImpl))[0];
}

/**
 * The `issues/` container URL for a tracker document.  Mirrors
 * `Repository.containerUrl` but kept here to avoid a circular dep between
 * type-index.ts and repository.ts.
 */
function issuesContainerUrl(trackerUrl: string): string {
  const dir = trackerUrl.slice(0, trackerUrl.lastIndexOf("/") + 1);
  return new URL("issues/", dir).toString();
}

/**
 * Ensure the user's public type index exists and registers their tracker. Creates
 * the index document and links it from the profile when absent (create-and-link,
 * per the solid-type-index skill). Best-effort: discovery is a convenience, so a
 * failure here is reported via the returned boolean rather than thrown.
 *
 * Two registrations are written per tracker:
 *   • `solid:forClass wf:Tracker ; solid:instance <trackerUrl>`
 *     — lets other solid-issues instances find the tracker config.
 *   • `solid:forClass wf:Task ; solid:instanceContainer <issues/>`
 *     — lets cross-app consumers (e.g. the Pod Manager) enumerate individual
 *     `wf:Task` resources without needing to parse the tracker config first
 *     (D6, FEDERATION-DESIGN.staged.md §2.1).
 */
export async function registerTracker(
  webId: string,
  storageUrl: string,
  trackerUrl: string,
  fetchImpl?: typeof fetch,
): Promise<boolean> {
  const doFetch = fetchImpl ?? fetch;
  try {
    // 1. Reuse the profile's EXISTING public type index when one is advertised —
    //    overwriting the link would break discovery for the user's other apps.
    //    Only create-and-link the conventional path when none exists.
    const { dataset: profile, etag: profileEtag } = await fetchRdf(webId, opts(fetchImpl));
    const links = new ProfileLinks(webId, profile, DataFactory);
    let indexUrl = links.publicTypeIndex;
    if (!indexUrl) {
      indexUrl = new URL("settings/publicTypeIndex.ttl", storageUrl).toString();
      links.publicTypeIndex = indexUrl;
      await conditionalPut(profileDocUrl(webId), profile, profileEtag, doFetch);
    }

    // 2. Load (or start) the index and ensure both registrations are present.
    let indexDataset: DatasetCore;
    let indexEtag: string | null;
    try {
      const r = await fetchRdf(indexUrl, opts(fetchImpl));
      indexDataset = r.dataset;
      indexEtag = r.etag;
    } catch (e) {
      if (e instanceof RdfFetchError && e.status === 404) {
        indexDataset = new Store();
        indexEtag = null;
      } else {
        throw e;
      }
    }
    const index = new TypeIndexDataset(indexDataset, DataFactory);
    index.markPublicIndex(indexUrl);
    // wf:Tracker registration (solid:instance → the tracker config document).
    if (!index.locate(wf("Tracker")).includes(trackerUrl)) {
      // Unique fragment: a shared index may already carry other apps' entries.
      index.register(indexUrl, `#registration-${crypto.randomUUID()}`, wf("Tracker"), trackerUrl);
    }
    // wf:Task instanceContainer registration (solid:instanceContainer → issues/).
    // This is the cross-app discovery seam: the Pod Manager enumerates wf:Task
    // containers from the type index rather than parsing the tracker config.
    const container = issuesContainerUrl(trackerUrl);
    if (!index.locateContainers(wf("Task")).includes(container)) {
      index.registerContainer(indexUrl, `#registration-${crypto.randomUUID()}`, wf("Task"), container);
    }
    await conditionalPut(indexUrl, indexDataset, indexEtag, doFetch);
    // The public index must be world-readable for others to discover the tracker
    // (CSS makes new resources owner-only). Best-effort.
    await grantPublicRead(indexUrl, webId, fetchImpl).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/**
 * All `wf:Task` instance-container URLs a WebID has registered in their public
 * type index.  The Pod Manager calls this to enumerate solid-issues' issue
 * containers for cross-app discovery (D6, FEDERATION-DESIGN.staged.md §2.1).
 * Empty when no index or no registration exists.
 */
export async function resolveTaskContainersFromTypeIndex(
  webId: string,
  fetchImpl?: typeof fetch,
): Promise<string[]> {
  let profile: DatasetCore;
  try {
    profile = (await fetchRdf(webId, opts(fetchImpl))).dataset;
  } catch {
    return [];
  }
  const indexUrl = new ProfileLinks(webId, profile, DataFactory).publicTypeIndex;
  if (!indexUrl) return [];
  try {
    const { dataset } = await fetchRdf(indexUrl, opts(fetchImpl));
    return new TypeIndexDataset(dataset, DataFactory).locateContainers(wf("Task"));
  } catch {
    return [];
  }
}

/** The profile *document* URL (strip the WebID fragment). */
function profileDocUrl(webId: string): string {
  const u = new URL(webId);
  u.hash = "";
  return u.toString();
}
