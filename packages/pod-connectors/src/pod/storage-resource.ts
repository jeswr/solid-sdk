// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { serialize } from "@jeswr/rdf-serialize";
import { type StorageClient, StorageError, type WriteResult } from "@jeswr/storage-client";
import type { DatasetCore } from "@rdfjs/types";
import { strongEtag } from "../core/pod-writer-policy.js";
import type { MutationGuard, WriteConditions } from "../core/types.js";
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
): Promise<WriteResult> {
  signal?.throwIfAborted();
  const parent = new URL(".", url).href;
  try {
    const result = await storage.create(parent, body, { exactUrl: url, contentType, signal });
    if (result.url !== url) throw new TypeError("Storage changed the connector resource URL.");
    return result;
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
  finishMutation = false,
  guard?: MutationGuard,
): Promise<WriteResult> {
  signal?.throwIfAborted();
  if (conditions.ifMatch !== undefined && !finishMutation && !guard) {
    return storage.writeRdf(url, dataset, {
      ifMatch: strongEtag(conditions.ifMatch, "storage", url),
      prefixes,
      signal,
    });
  }
  if (conditions.ifMatch === undefined && conditions.ifNoneMatch !== "*")
    throw new TypeError("A conditional RDF write is required.");
  const quads = [...dataset];
  if (quads.some((quad) => quad.graph.termType !== "DefaultGraph"))
    throw new TypeError("Turtle cannot carry named graphs.");
  const body = await serialize(quads, { format: "text/turtle", prefixes });
  signal?.throwIfAborted();
  const refused = guard?.();
  if (refused) return refused;
  if (conditions.ifMatch !== undefined)
    return storage.write(url, body, {
      contentType: "text/turtle",
      ifMatch: strongEtag(conditions.ifMatch, "storage", url),
      ...(finishMutation ? {} : { signal }),
    });
  return createStorageResource(
    storage,
    url,
    body,
    "text/turtle",
    finishMutation ? undefined : signal,
  );
}
