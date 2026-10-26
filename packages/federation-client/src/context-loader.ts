// AUTHORED-BY Codex GPT-6.1-Sol
import type { DocumentLoader } from "@jeswr/fetch-rdf";
import federation from "./contexts/federation-context.json" with { type: "json" };
import oidc from "./contexts/oidc-context.json" with { type: "json" };

const canonicalFederation = JSON.parse(
  JSON.stringify(federation).replaceAll("https://w3id.org/jeswr/", "https://jeswr.org/ns/"),
) as object;

const contexts = new Map<string, object>([
  ["https://www.w3.org/ns/solid/oidc-context.jsonld", oidc],
  ["https://w3id.org/jeswr/fed", federation],
  ["https://jeswr.org/ns/fed", canonicalFederation],
]);

/** Exact bundled contexts only, including nested loads. Never accesses the network. */
export const federationDocumentLoader: DocumentLoader = {
  async load(url) {
    const context = contexts.get(url);
    if (context === undefined) {
      throw new Error(`Remote JSON-LD context refused: ${url}.`);
    }
    // Isolate the bundled copy from parser mutations between calls.
    return structuredClone(context);
  },
};
