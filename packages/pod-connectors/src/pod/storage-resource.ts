// AUTHORED-BY Codex GPT-6.1-Sol
import { serialize } from "@jeswr/rdf-serialize";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import type { DatasetCore } from "@rdfjs/types";
import { strongEtag } from "../core/pod-writer-policy.js";
import type { WriteConditions } from "../core/types.js";
import { VOCAB_PREFIXES } from "../core/vocab.js";

export function missingResource(error: unknown): boolean {
  return error instanceof StorageError && error.status === 404;
}

/** Exact Solid creates; LWS's server-assigned identifiers cannot implement connector slugs. */
export async function createStorageResource(
  storage: StorageClient,
  url: string,
  body: string | Uint8Array | Blob,
  contentType: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const parent = new URL(".", url).href;
  try {
    const result = await storage.create(parent, body, { exactUrl: url, contentType, signal });
    if (result.url !== url) throw new TypeError("Storage changed the connector resource URL.");
  } catch (error) {
    // Solid maps an occupied exact name to conflict; the writer preserves its HTTP precondition.
    if (error instanceof StorageError && error.code === "conflict")
      throw new StorageError("precondition-failed", {
        method: "PUT",
        url,
        status: 412,
        cause: error,
      });
    throw error;
  }
}

/** Shared conditional RDF path for connector data and Type Index/profile changes. */
export async function writeStorageRdf(
  storage: StorageClient,
  url: string,
  dataset: DatasetCore,
  conditions: WriteConditions,
  signal?: AbortSignal,
  prefixes: Record<string, string> = { ...VOCAB_PREFIXES },
): Promise<void> {
  signal?.throwIfAborted();
  if (conditions.ifMatch !== undefined) {
    await storage.writeRdf(url, dataset, {
      ifMatch: strongEtag(conditions.ifMatch, "storage", url),
      prefixes,
      signal,
    });
  } else if (conditions.ifNoneMatch === "*") {
    const quads = [...dataset];
    if (quads.some((quad) => quad.graph.termType !== "DefaultGraph"))
      throw new TypeError("Turtle cannot carry named graphs.");
    const body = await serialize(quads, {
      format: "text/turtle",
      prefixes,
    });
    await createStorageResource(storage, url, body, "text/turtle", signal);
  } else throw new TypeError("A conditional RDF write is required.");
}
