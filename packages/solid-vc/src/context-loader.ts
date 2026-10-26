// AUTHORED-BY Codex GPT-6.1-Sol
import type { DocumentLoader } from "@jeswr/fetch-rdf";
import credentialsV1 from "./contexts/credentials-v1.json" with { type: "json" };
import credentialsV2 from "./contexts/credentials-v2.json" with { type: "json" };
import dataIntegrityV2 from "./contexts/data-integrity-v2.json" with { type: "json" };

const contexts = new Map<string, object>([
  ["https://www.w3.org/2018/credentials/v1", credentialsV1],
  ["https://www.w3.org/ns/credentials/v2", credentialsV2],
  ["https://w3id.org/security/data-integrity/v2", dataIntegrityV2],
]);

/** Exact bundled contexts only, including nested loads. Never uses a network transport. */
export const credentialDocumentLoader: DocumentLoader = {
  async load(url) {
    const context = contexts.get(url);
    if (context === undefined) {
      throw new Error(`Remote JSON-LD context refused: ${url}.`);
    }
    // Isolate the bundled copy from parser mutations between calls.
    return structuredClone(context);
  },
};
