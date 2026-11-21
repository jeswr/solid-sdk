// AUTHORED-BY Codex GPT-6.2 Sol
import type { DocumentLoader } from "@jeswr/fetch-rdf";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readFileSync } from "fs";
import {
  bundledContext,
  DocumentError,
  ODRL_CONTEXT,
  readPinnedContext,
  VC_CONTEXT,
} from "./contexts.js";

export const STORE_CONTEXT = "https://w3id.org/jeswr/awp/context/store/v1";
export const STORE_CONTEXT_SHA256 =
  "3765c7117bc234e2d391ea900e85403f350488a13a11f5d5482e8b31b2a2705e";

let storeContext: Record<string, unknown> | undefined;

export const storeDocumentLoader: DocumentLoader = {
  async load(iri) {
    if (iri === STORE_CONTEXT) {
      storeContext ??= readPinnedContext(
        readFileSync(new URL("../../vocab/context/store-v1.jsonld", import.meta.url), "utf8"),
        STORE_CONTEXT_SHA256,
      );
      return structuredClone(storeContext);
    }
    if (iri === ODRL_CONTEXT || iri === VC_CONTEXT) return bundledContext(iri);
    throw new DocumentError("context-not-accepted");
  },
};

export async function storeJsonLdLoader(iri: string) {
  return {
    documentUrl: iri,
    document: (await storeDocumentLoader.load(iri)) as import("jsonld").NodeObject,
  };
}
