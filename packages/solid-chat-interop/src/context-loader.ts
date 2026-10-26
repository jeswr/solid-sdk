// AUTHORED-BY Codex GPT-6.1-Sol
import type { DocumentLoader } from "@jeswr/fetch-rdf";
import activityStreams from "./contexts/activitystreams.json" with { type: "json" };

/** ActivityStreams is bundled; every other context (including nested ones) is refused. */
export const activityStreamsDocumentLoader: DocumentLoader = {
  async load(url) {
    if (url !== "https://www.w3.org/ns/activitystreams") {
      throw new Error(`Remote JSON-LD context refused: ${url}.`);
    }
    return structuredClone(activityStreams);
  },
};
