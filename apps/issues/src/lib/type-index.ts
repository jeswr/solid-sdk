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

  /** All instance URLs registered for a class IRI. */
  locate(classIri: string): string[] {
    const out: string[] = [];
    for (const reg of this.registrations) {
      if (reg.forClass === classIri && reg.instance) out.push(reg.instance);
    }
    return out;
  }

  /** Add (or refresh) a registration mapping `classIri` → `instanceUrl`. */
  register(indexUrl: string, fragment: string, classIri: string, instanceUrl: string): void {
    const reg = new TypeRegistration(`${indexUrl}${fragment}`, this, this.factory);
    reg.markRegistration();
    reg.forClass = classIri;
    reg.instance = instanceUrl;
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
 * Resolve the issues document a WebID has registered for `wf:Tracker` via their
 * public type index. Returns undefined when no index or no registration exists —
 * discovery is a hint, not a guarantee of access (solid-type-index skill).
 */
export async function resolveTrackerFromTypeIndex(
  webId: string,
  fetchImpl?: typeof fetch,
): Promise<string | undefined> {
  let profile: DatasetCore;
  try {
    profile = (await fetchRdf(webId, opts(fetchImpl))).dataset;
  } catch {
    return undefined;
  }
  const indexUrl = new ProfileLinks(webId, profile, DataFactory).publicTypeIndex;
  if (!indexUrl) return undefined;
  try {
    const { dataset } = await fetchRdf(indexUrl, opts(fetchImpl));
    return new TypeIndexDataset(dataset, DataFactory).locate(wf("Tracker"))[0];
  } catch {
    return undefined;
  }
}

/**
 * Ensure the user's public type index exists and registers their tracker. Creates
 * the index document and links it from the profile when absent (create-and-link,
 * per the solid-type-index skill). Best-effort: discovery is a convenience, so a
 * failure here is reported via the returned boolean rather than thrown.
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

    // 2. Load (or start) the index and ensure the tracker registration is present.
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
    if (!index.locate(wf("Tracker")).includes(trackerUrl)) {
      // Unique fragment: a shared index may already carry other apps' entries.
      index.register(indexUrl, `#registration-${crypto.randomUUID()}`, wf("Tracker"), trackerUrl);
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

/** The profile *document* URL (strip the WebID fragment). */
function profileDocUrl(webId: string): string {
  const u = new URL(webId);
  u.hash = "";
  return u.toString();
}
