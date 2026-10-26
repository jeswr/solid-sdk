// AUTHORED-BY Codex GPT-6.1-Sol
import { type FetchedRdf, fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, createPodScopedFetch, normalizePodBase } from "@jeswr/guarded-fetch";
import { serialize } from "@jeswr/rdf-serialize";
import { DataFactory, Store } from "n3";
import { DriveResource } from "./model.js";
import { iri, quadsToTurtle } from "./serialize.js";
import { buildDriveRootMarker, buildDriveRootRegistration, findDriveRoots } from "./type-index.js";
import { LDP } from "./vocab.js";

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
 * Creation and registration are conditional; marker insertion only appends metadata.
 * Concurrent callers converge through server preconditions and bounded marker re-reads;
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
  const created = await scopedFetch(rootUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "text/turtle",
      "If-None-Match": "*",
      Link: `<${LDP.BasicContainer}>; rel="type"`,
    },
    body: "",
  });
  if (created.ok) {
    // CSS ignores container PUT bodies. Discover and PATCH its description instead.
    const current = await fetchRdf(rootUrl, { fetch: scopedFetch });
    let metadataUrl: string | undefined;
    const links = current.response.headers.get("Link") ?? "";
    for (const link of links.matchAll(/<([^>]*)>((?:[^",]|"[^"]*")*)/g)) {
      // Both capture groups are mandatory, even when their strings are empty.
      const rel = /(?:^|;)\s*rel\s*=\s*(?:"([^"]*)"|([^;\s]+))/i.exec(link[2] as string);
      if ((rel?.[1] ?? rel?.[2] ?? "").split(/\s+/).includes("describedby")) {
        metadataUrl = assertWithinPodScope(storage, new URL(link[1] as string, rootUrl).href);
        break;
      }
    }
    if (metadataUrl === undefined) throw new TypeError("The drive root needs a describedby link.");
    const patched = await scopedFetch(metadataUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/sparql-update" },
      body: `INSERT DATA { ${await serialize(buildDriveRootMarker(rootUrl))} }`,
    });
    if (!patched.ok) throw new DriveWriteError(patched.status, metadataUrl);
    const verified = await fetchRdf(rootUrl, { fetch: scopedFetch });
    const root = new DriveResource(rootUrl, verified.dataset, DataFactory);
    if (!root.isDriveRoot) {
      throw new TypeError("The drive root marker was not persisted.");
    }
  } else if (created.status === 409 || created.status === 412) {
    // Another initializer may still be PATCHing its newly created container.
    // Only adopt a marked container; never mark or overwrite an occupied path.
    for (let attempt = 0; ; attempt++) {
      let current: FetchedRdf;
      try {
        current = await fetchRdf(rootUrl, { fetch: scopedFetch });
      } catch (error) {
        if (error instanceof RdfFetchError && error.status === 404) {
          throw new DriveWriteError(created.status, rootUrl);
        }
        throw error;
      }
      const root = new DriveResource(rootUrl, current.dataset, DataFactory);
      if (root.isDriveRoot) break;
      if (attempt === 4) throw new DriveWriteError(created.status, rootUrl);
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
    }
  } else {
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
