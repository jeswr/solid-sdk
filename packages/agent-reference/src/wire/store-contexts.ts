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
  "89cd3147ed2ff3a784eb13d1e6e831711e1546f56c091cbbc85bc803a37792d4";
export const SCENARIO_CONTEXT = "https://w3id.org/jeswr/awp/context/scenario/v1";
export const SCENARIO_CONTEXT_SHA256 =
  "ea6a39eb634eed02739b8b9348dee13735eab3c0dc422273708544ee4ed63017";

let storeContext: Record<string, unknown> | undefined;
let scenario: Record<string, unknown> | undefined;

export function scenarioContext(iri: string): Record<string, unknown> {
  if (iri === SCENARIO_CONTEXT) {
    scenario ??= readPinnedContext(
      readFileSync(new URL("../../vocab/context/scenario-v1.jsonld", import.meta.url), "utf8"),
      SCENARIO_CONTEXT_SHA256,
    );
    return structuredClone(scenario);
  }
  if (iri === ODRL_CONTEXT || iri === VC_CONTEXT) return bundledContext(iri);
  throw new DocumentError("context-not-accepted");
}

export const scenarioDocumentLoader: DocumentLoader = {
  async load(iri) {
    return scenarioContext(iri);
  },
};

export async function scenarioJsonLdLoader(iri: string) {
  return {
    documentUrl: iri,
    document: (await scenarioDocumentLoader.load(iri)) as import("jsonld").NodeObject,
  };
}

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
