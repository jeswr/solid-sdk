import type { DocumentLoader } from "@jeswr/fetch-rdf";
import oidc from "./contexts/oidc-context.json" with { type: "json" };

/** Exact bundled contexts only, including nested loads. Never accesses the network. */
export const federationDocumentLoader: DocumentLoader = {
  async load(url) {
    if (url !== "https://www.w3.org/ns/solid/oidc-context.jsonld") {
      throw new Error(`Remote JSON-LD context refused: ${url}.`);
    }
    // Isolate the bundled copy from parser mutations between calls.
    return structuredClone(oidc);
  },
};
