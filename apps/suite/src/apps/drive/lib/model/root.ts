// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { type FetchedRdf, fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, createPodScopedFetch, normalizePodBase } from "@jeswr/guarded-fetch";
import { SetFrom, TermAs, TermFrom } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { DriveContainer, DriveResource } from "./model.js";
import { driveRootPatch } from "./patch.js";
import { iri, quadsToTurtle } from "./serialize.js";
import { buildDriveRootRegistration, findDriveRoots } from "./type-index.js";
import { LDP, RDF } from "./vocab.js";

function strongEtag(etag: string | null): string | undefined {
  return etag !== null && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag) ? etag : undefined;
}

function indexEtag(etag: string | null): string {
  const validator = strongEtag(etag);
  if (validator === undefined) throw new TypeError("The private Type Index needs a strong ETag.");
  return validator;
}

export class DriveWriteError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`Drive write failed (${status})`);
    this.name = "DriveWriteError";
  }
}

/** A possibly committed creation whose initialization can be retried without deleting it. */
export class DriveRootInitializationError extends Error {
  constructor(
    cause: unknown,
    /** Retains this call's scoped fetch and root. Keep the error to retry in this session. */
    readonly resume: () => Promise<string>,
  ) {
    super("Drive root initialization failed. Call resume() to retry.", { cause });
    this.name = "DriveRootInitializationError";
  }
}

export interface DriveRootOptions {
  storageUrl: string;
  /** Already discovered private index. Creating/linking absent indexes belongs to SDK-APP-10. */
  typeIndexUrl: string;
}

interface RootIdentity {
  etag: string | undefined;
  children: Set<string>;
}

/**
 * Injected-fetch Solid RDF bootstrap, independent of the future SDK façade.
 * Creation, marker insertion, and registration are conditional.
 * Concurrent callers converge through server preconditions and bounded re-reads;
 * initialization failures preserve the container and expose a caller-held resume handle.
 * No module-global account state or rejected-promise cache is retained.
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
  indexEtag(index.etag);

  const rootUrl = new URL("drive/", storage).href;
  let rootEtag: string | undefined;
  // A marker written by this call cannot itself prove ownership, including on resume().
  let markingIdentity: RootIdentity | undefined;
  let created: Response;
  try {
    created = await createRoot();
  } catch (error) {
    // The server may have committed the PUT before the connection failed.
    throw new DriveRootInitializationError(error, resume);
  }

  async function createRoot(): Promise<Response> {
    return scopedFetch(rootUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "text/turtle",
        "If-None-Match": "*",
        Link: `<${LDP.BasicContainer}>; rel="type"`,
      },
      body: "",
    });
  }

  async function readRoot(): Promise<FetchedRdf> {
    try {
      return await fetchRdf(rootUrl, { fetch: scopedFetch });
    } catch (error) {
      if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
    }
    // A failed PUT may never have committed. Confirm absence before retrying
    // creation, and discard any validator belonging to a now-missing root.
    rootEtag = undefined;
    markingIdentity = undefined;
    const recreated = await createRoot();
    if (recreated.ok) {
      rootEtag = strongEtag(recreated.headers.get("ETag"));
    } else if (recreated.status !== 409 && recreated.status !== 412) {
      throw new DriveWriteError(recreated.status, rootUrl);
    }
    // A concurrent creator must still pass validateRoot's adoption checks.
    // Read only once: another 404 leaves a resumable failure, not a retry loop.
    return fetchRdf(rootUrl, { fetch: scopedFetch });
  }

  function rootIdentity(current: FetchedRdf): RootIdentity {
    return {
      etag: strongEtag(current.etag),
      children: new Set(
        [...new DriveContainer(rootUrl, current.dataset, DataFactory).contains].map(
          (child) => child.url,
        ),
      ),
    };
  }

  function validateRoot(current: FetchedRdf, status = 409): DriveResource {
    const root = new DriveResource(rootUrl, current.dataset, DataFactory);
    const types = SetFrom.subjectPredicate(root, RDF.type, TermAs.term, TermFrom.itself);
    const isContainer = [...types].some(
      (type) =>
        type.termType === "NamedNode" &&
        (type.value === LDP.Container || type.value === LDP.BasicContainer),
    );
    const identity = rootIdentity(current);
    const expected = markingIdentity;
    // A URL alone is not an identity. A matching strong validator permits
    // resuming our container; otherwise only an empty container can be adopted.
    if (
      !isContainer ||
      (expected !== undefined &&
        (identity.children.size !== expected.children.size ||
          [...identity.children].some((child) => !expected.children.has(child)))) ||
      (!root.isDriveRoot &&
        (rootEtag === undefined || current.etag !== rootEtag) &&
        identity.children.size > 0)
    ) {
      throw new DriveWriteError(status, rootUrl);
    }
    return root;
  }

  async function initialize(current?: FetchedRdf): Promise<void> {
    try {
      for (let attempt = 0; ; attempt++) {
        // CSS ignores container PUT bodies; initialize the marker with N3 PATCH.
        current ??= await readRoot();
        if (validateRoot(current).isDriveRoot) {
          markingIdentity = undefined;
          return;
        }
        const identity = rootIdentity(current);
        rootEtag = identity.etag;
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
        if (metadataUrl === undefined)
          throw new TypeError("The drive root needs a describedby link.");
        let patchUrl = metadataUrl;
        let precondition: Record<string, string>;
        if (
          identity.etag !== undefined &&
          /(?:^|,)\s*text\/n3\s*(?:;|,|$)/i.test(current.response.headers.get("Accept-Patch") ?? "")
        ) {
          // Where supported, guard the container representation itself atomically.
          patchUrl = rootUrl;
          precondition = { "If-Match": identity.etag };
        } else {
          // If-Match on a distinct description protects only that resource.
          // Its PATCH may change the container ETag, so verify the observed children
          // independently of the DriveRoot type this call is about to insert.
          try {
            const description = await fetchRdf(metadataUrl, { fetch: scopedFetch });
            const etag = strongEtag(description.etag);
            if (etag === undefined)
              throw new TypeError("The drive description needs a strong ETag.");
            precondition = { "If-Match": etag };
          } catch (error) {
            if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
            precondition = { "If-None-Match": "*" };
          }
        }
        markingIdentity = identity;
        const patched = await scopedFetch(patchUrl, {
          method: "PATCH",
          headers: { "Content-Type": "text/n3", ...precondition },
          body: await driveRootPatch(rootUrl),
        });
        if (patched.status === 412) {
          // The precondition prevented our marker insertion; another caller's
          // marker can be validated normally on the bounded retry.
          markingIdentity = undefined;
          if (attempt === 0) {
            current = undefined;
            continue;
          }
        }
        if (!patched.ok) throw new DriveWriteError(patched.status, patchUrl);
        const verified = await fetchRdf(rootUrl, { fetch: scopedFetch });
        const root = validateRoot(verified);
        if (!root.isDriveRoot) {
          throw new TypeError("The drive root marker was not persisted.");
        }
        markingIdentity = undefined;
        return;
      }
    } catch (error) {
      // A container validator cannot cover independently edited auxiliary resources.
      // Preserve everything; resumption revalidates the container before marking it.
      throw new DriveRootInitializationError(error, resume);
    }
  }

  async function resume(): Promise<string> {
    await initialize();
    await register(true);
    return rootUrl;
  }

  if (created.ok) {
    rootEtag = strongEtag(created.headers.get("ETag"));
    await initialize();
  } else if (created.status === 409 || created.status === 412) {
    // Adopt a marked or empty container, including a PUT whose response was lost.
    let current: FetchedRdf;
    try {
      current = await fetchRdf(rootUrl, { fetch: scopedFetch });
    } catch (error) {
      if (error instanceof RdfFetchError && error.status === 404) {
        throw new DriveWriteError(created.status, rootUrl);
      }
      throw error;
    }
    validateRoot(current, created.status);
    await initialize(current);
  } else {
    throw new DriveWriteError(created.status, rootUrl);
  }

  async function register(retry: boolean): Promise<void> {
    // Re-read after creation: preserve registrations written while the root was being created.
    const current = await fetchRdf(indexUrl, { fetch: scopedFetch });
    if (findDriveRoots(current.dataset).includes(rootUrl)) return;
    const etag = indexEtag(current.etag);
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
      headers: { "Content-Type": "text/turtle", "If-Match": etag },
      body: await quadsToTurtle(dataset),
    });
    if (response.status === 412 && retry) return register(false);
    if (!response.ok) throw new DriveWriteError(response.status, indexUrl);
  }
  await register(true);
  return rootUrl;
}
