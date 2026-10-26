// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, createPodScopedFetch } from "@jeswr/guarded-fetch";
import { freshRdf } from "../pod/rdf-read.js";
import { ResourceWriteError, writeResource } from "../pod/resource.js";
import { ensureTypeRegistrations } from "../pod/type-index-write.js";
import { IntegrationSyncError } from "./errors.js";
import type { BinaryDoc, PodWriter, WrittenBinary } from "./types.js";
import { VOCAB_PREFIXES } from "./vocab.js";

/** Configuration for a fetch-backed writer bound to one connector and active Pod. */
export interface FetchPodWriterOptions {
  readonly adapterId: string;
  readonly webId: string;
  /** Canonical profile document URL resolved by the host when loading the WebID. */
  readonly profileDocumentUrl: string;
  readonly podRoot: string;
  /** Host's authenticated Pod transport; resolved at call time by the host. */
  readonly fetch: typeof fetch;
}

/** Create a fetch-backed storage port. Source API credentials never enter this transport. */
export function createFetchPodWriter(options: FetchPodWriterOptions): PodWriter {
  const { adapterId, webId, podRoot } = options;
  if (!/^[a-z0-9-]+$/.test(adapterId))
    throw new IntegrationSyncError(adapterId, "Invalid adapter id.");
  const root = assertWithinPodScope(podRoot, new URL(`integrations/${adapterId}/`, podRoot).href);
  const podFetch = createPodScopedFetch(root, { fetch: options.fetch, allowRoot: false });
  const resolve = (slug: string): string => {
    try {
      return assertWithinPodScope(root, new URL(slug, root).href, { allowRoot: false });
    } catch (cause) {
      throw new IntegrationSyncError(adapterId, `Slug escapes the adapter container: ${slug}`, {
        cause,
      });
    }
  };
  return {
    resolve,
    async read(slug) {
      const url = resolve(slug);
      try {
        const { dataset, etag } = await freshRdf(url, podFetch);
        return { dataset, etag };
      } catch (error) {
        if (error instanceof RdfFetchError && error.status === 404) return undefined;
        throw error;
      }
    },
    async write(doc, conditions = {}) {
      const url = resolve(doc.slug);
      await writeResource(url, doc.dataset, {
        fetchImpl: podFetch,
        etag: conditions.ifMatch,
        createOnly: conditions.ifNoneMatch === "*",
        prefixes: { ...VOCAB_PREFIXES },
      });
      return {
        url,
        category: doc.category,
        forClass: doc.forClass,
        skipRegistration: doc.skipRegistration,
      };
    },
    writeBinary: async (doc) => writeBinaryResource(adapterId, resolve(doc.slug), doc, podFetch),
    async remove(slug, conditions = {}) {
      const url = resolve(slug);
      const headers = new Headers();
      if (conditions.ifMatch) headers.set("if-match", conditions.ifMatch);
      const response = await podFetch(url, { method: "DELETE", headers });
      if (!response.ok && response.status !== 404)
        throw new ResourceWriteError(url, response.status);
    },
    registerType: (registrations) =>
      ensureTypeRegistrations({
        webId,
        profileDocumentUrl: options.profileDocumentUrl,
        podRoot,
        registrations: [...registrations],
        fetchImpl: options.fetch,
      }),
  };
}

/** RDF goes through `write` so it is serialised by N3 and carries provenance. */
const RDF_MEDIA_TYPES = new Set([
  "text/turtle",
  "text/n3",
  "application/ld+json",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
  "application/rdf+xml",
]);
const MEDIA_TYPE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(\s*;\s*[a-z0-9-]+=[a-z0-9-]+)*$/i;

async function writeBinaryResource(
  adapterId: string,
  url: string,
  doc: BinaryDoc,
  podFetch: typeof fetch,
): Promise<WrittenBinary> {
  const mediaType = String(doc.contentType.split(";", 1)[0]).trim().toLowerCase();
  if (!MEDIA_TYPE.test(doc.contentType) || RDF_MEDIA_TYPES.has(mediaType))
    throw new IntegrationSyncError(adapterId, `Unsupported binary content type: ${mediaType}`);
  const headers = new Headers({ "content-type": doc.contentType });
  if ((doc.mode ?? "create") === "create") headers.set("if-none-match", "*");
  else {
    const current = await podFetch(url, { method: "HEAD" });
    if (current.status === 404) headers.set("if-none-match", "*");
    else if (!current.ok) throw new ResourceWriteError(url, current.status);
    else {
      const etag = current.headers.get("etag");
      // Fail closed: never overwrite a resource the server gives no validator for.
      if (!etag || etag.startsWith("W/"))
        throw new IntegrationSyncError(adapterId, "Existing resource has no strong ETag.", { url });
      headers.set("if-match", etag);
    }
  }
  const response = await podFetch(url, {
    method: "PUT",
    headers,
    body: doc.body as Uint8Array<ArrayBuffer>,
  });
  if (response.status === 412 && (doc.mode ?? "create") === "create")
    return { url, created: false };
  if (!response.ok) throw new ResourceWriteError(url, response.status);
  return { url, created: true };
}

/** Distinct class/container registrations for written documents. */
export function registrationsFor(written: readonly import("./types.js").WrittenDoc[]) {
  const out = new Map<string, import("./types.js").TypeRegistrationRequest>();
  for (const doc of written) {
    if (doc.skipRegistration) continue;
    const container = doc.registrationContainer ?? doc.url.slice(0, doc.url.lastIndexOf("/") + 1);
    out.set(`${doc.forClass}|${container}`, { forClass: doc.forClass, container });
  }
  return [...out.values()];
}
