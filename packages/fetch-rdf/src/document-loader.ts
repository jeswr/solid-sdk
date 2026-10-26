// AUTHORED-BY Codex GPT-6.1-Sol
import { cancelResponseBody } from "./cancel-body.js";
import { RdfFetchError } from "./errors.js";
import type { DocumentLoader } from "./types.js";

/** Default JSON-LD policy: inline contexts work; remote contexts require opt-in. */
export const refusingDocumentLoader: DocumentLoader = {
  async load(url) {
    throw new RdfFetchError(`Remote JSON-LD context refused: ${url}.`, { url });
  },
};

/**
 * Load allowlisted JSON-LD contexts exclusively through the supplied transport.
 * Redirects are refused so an allowed URL cannot redirect outside the allowlist.
 */
export function createFetchDocumentLoader(
  fetchImpl: typeof fetch,
  options: { allow: (url: string) => boolean },
): DocumentLoader {
  return {
    async load(url) {
      if (!options.allow(url)) {
        throw new RdfFetchError(`Remote JSON-LD context refused: ${url}.`, { url });
      }
      try {
        const response = await fetchImpl(url, {
          headers: new Headers({ accept: "application/ld+json" }),
          redirect: "error",
        });
        if (!response.ok) {
          const error = new RdfFetchError(
            `HTTP ${response.status} loading JSON-LD context ${url}.`,
            {
              status: response.status,
              url,
            },
          );
          void cancelResponseBody(response);
          throw error;
        }
        return await response.json();
      } catch (cause) {
        if (cause instanceof RdfFetchError) throw cause;
        throw new RdfFetchError(`Failed to load JSON-LD context ${url}.`, { cause, url });
      }
    },
  };
}
