// AUTHORED-BY Claude Opus 5.5
// Generalises the requests-solid records-folder seal (Codex GPT-6): a mark that only the holder of
// Control on a resource can write, stating that its owner verified what the resource governs.
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { serialize } from "../rdf.js";
import { roleError } from "./errors.js";
import { load, request, requireOk } from "./http.js";
import { properties } from "./rdf.js";
import type { GrantMutationOptions } from "./types.js";

const SEALED_BY = "https://jeswr.org/ns/pod-access#sealedBy";
const term = (url: string) => DataFactory.namedNode(url);

/** Whether `dataset`, the access document at `documentUrl`, carries `webId`'s seal. */
function hasSeal(dataset: DatasetCore, documentUrl: string, webId: string): boolean {
  return properties(term(documentUrl), dataset).terms(SEALED_BY).has(term(webId));
}
/**
 * Add (or with `sealed: false` remove) `webId`'s seal on the access document at `documentUrl`,
 * for writers that build an access document offline (such as a seeded demo pod).
 */
export function sealDataset(
  dataset: DatasetCore,
  documentUrl: string,
  webId: string,
  sealed = true,
): void {
  const seals = properties(term(documentUrl), dataset).terms(SEALED_BY);
  if (sealed) seals.add(term(webId));
  else seals.delete(term(webId));
}
/**
 * Whether `url`'s OWN access document carries the caller's seal. An inherited document never
 * counts, and a missing own document is unsealed.
 */
export async function isSealed(url: string, options: GrantMutationOptions): Promise<boolean> {
  const { own } = await load(url, options);
  return own !== undefined && hasSeal(own.dataset, own.url, options.webId);
}
async function setSeal(url: string, options: GrantMutationOptions, sealed: boolean) {
  const { own } = await load(url, options);
  if (!own) {
    if (!sealed) return;
    throw roleError("unsupported", url, "Only an existing own access document can be sealed");
  }
  if (hasSeal(own.dataset, own.url, options.webId) === sealed) return;
  if (own.etag === null || !/^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(own.etag))
    throw roleError("precondition-required", own.url, "An ETag is required to change a seal");
  const dataset = new Store([...own.dataset]);
  sealDataset(dataset, own.url, options.webId, sealed);
  requireOk(
    await request(own.url, options, {
      method: "PUT",
      headers: { "content-type": "text/turtle", "if-match": own.etag },
      body: await serialize(dataset),
    }),
    own.url,
  );
}
/**
 * Seal `url`'s own access document, conditionally on its ETag and preserving every other
 * statement. Seal only after verifying, under access that only you hold, what the resource
 * governs (for example that a folder holds nothing written while others could write it).
 * Role edits preserve the seal, so remove it with `unsealAccess` before widening access.
 */
export function sealAccess(url: string, options: GrantMutationOptions): Promise<void> {
  return setSeal(url, options, true);
}
/** Remove the caller's seal from `url`'s own access document; no own document is a no-op. */
export function unsealAccess(url: string, options: GrantMutationOptions): Promise<void> {
  return setSeal(url, options, false);
}
