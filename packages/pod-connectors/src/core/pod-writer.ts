// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, createPodScopedFetch } from "@jeswr/guarded-fetch";
import { freshRdf } from "../pod/rdf-read.js";
import { writeResource } from "../pod/resource.js";
import { ensureTypeRegistrations } from "../pod/type-index-write.js";
import { IntegrationSyncError } from "./errors.js";
import type { PodWriter } from "./types.js";
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

/** Distinct class/container registrations for written documents. */
export function registrationsFor(written: readonly import("./types.js").WrittenDoc[]) {
  const out = new Map<string, import("./types.js").TypeRegistrationRequest>();
  for (const doc of written) {
    if (doc.skipRegistration) continue;
    const container = doc.url.slice(0, doc.url.lastIndexOf("/") + 1);
    out.set(`${doc.forClass}|${container}`, { forClass: doc.forClass, container });
  }
  return [...out.values()];
}
