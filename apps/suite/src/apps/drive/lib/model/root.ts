// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, createPodScopedFetch, normalizePodBase } from "@jeswr/guarded-fetch";
import { SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { DriveResource } from "./model.js";
import { iri, quadsToTurtle } from "./serialize.js";
import { buildDriveRootMarker, buildDriveRootRegistration, findDriveRoots } from "./type-index.js";
import { LDP, RDF } from "./vocab.js";

export class DriveWriteError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`Drive write failed (${status})`);
    this.name = "DriveWriteError";
  }
}

export interface DriveRootOptions {
  storageUrl: string;
  /** Already discovered private index. Creating/linking absent indexes belongs to SDK-APP-10. */
  typeIndexUrl: string;
}

/**
 * Injected-fetch Solid RDF bootstrap, independent of the future SDK façade.
 * Both writes are conditional. Concurrent callers converge through server preconditions;
 * no module-global account state or rejected-promise cache is retained.
 */
export async function ensureDriveRoot(
  fetch: typeof globalThis.fetch,
  { storageUrl, typeIndexUrl }: DriveRootOptions,
): Promise<string> {
  const storage = normalizePodBase(storageUrl);
  const indexUrl = assertWithinPodScope(storage, typeIndexUrl);
  const scopedFetch = createPodScopedFetch(storage, { fetch, maxRedirects: 0 });
  const index = await fetchRdf(indexUrl, { fetch: scopedFetch });
  const existing = findDriveRoots(index.dataset)[0];
  if (existing !== undefined) return assertWithinPodScope(storage, existing);
  // Refuse to create an orphan root if an existing index cannot be updated safely.
  if (index.etag === null) throw new TypeError("The private Type Index needs an ETag.");

  const rootUrl = new URL("drive/", storage).href;
  const description = new Store(buildDriveRootMarker(rootUrl));
  const root = new TermWrapper(iri(rootUrl), description, DataFactory);
  SetFrom.subjectPredicate(root, RDF.type, TermAs.term, TermFrom.itself).add(
    DataFactory.namedNode(LDP.BasicContainer),
  );
  const created = await scopedFetch(rootUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "text/turtle",
      "If-None-Match": "*",
      Link: `<${LDP.BasicContainer}>; rel="type"`,
    },
    body: await quadsToTurtle(description),
  });
  if (created.status === 412) {
    // Another caller won, or the path was already occupied. Never overwrite it.
    const current = await fetchRdf(rootUrl, { fetch: scopedFetch });
    if (!new DriveResource(rootUrl, current.dataset, DataFactory).isDriveRoot) {
      throw new DriveWriteError(412, rootUrl);
    }
  } else if (!created.ok) {
    throw new DriveWriteError(created.status, rootUrl);
  }

  async function register(retry: boolean): Promise<void> {
    // Re-read after creation: preserve registrations written while the root was being created.
    const current = await fetchRdf(indexUrl, { fetch: scopedFetch });
    if (findDriveRoots(current.dataset).includes(rootUrl)) return;
    if (current.etag === null) throw new TypeError("The private Type Index needs an ETag.");
    const dataset = new Store([...current.dataset]);
    const registrationUrl = new URL(indexUrl);
    registrationUrl.hash = "poddrive";
    // Do not replace an occupied registration fragment, even if it belongs to another app.
    while (dataset.match(iri(registrationUrl.href), null, null).size > 0) {
      registrationUrl.hash += "-drive";
    }
    dataset.addQuads(buildDriveRootRegistration(registrationUrl.href, rootUrl));
    const response = await scopedFetch(indexUrl, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle", "If-Match": current.etag },
      body: await quadsToTurtle(dataset),
    });
    if (response.status === 412 && retry) return register(false);
    if (!response.ok) throw new DriveWriteError(response.status, indexUrl);
  }
  await register(true);
  return rootUrl;
}
