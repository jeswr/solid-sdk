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
/**
 * Next to the seal: the owner started securing the resource from access others held, and has not
 * sealed it yet. Whatever the resource governs was not verified, and some of it is known to have
 * been written by others while it was being secured.
 */
const SECURING_BY = "https://jeswr.org/ns/pod-access#securingBy";
const term = (url: string) => DataFactory.namedNode(url);

/** Whether `dataset`, the access document at `documentUrl`, carries `webId`'s seal. */
function hasSeal(dataset: DatasetCore, documentUrl: string, webId: string): boolean {
  return properties(term(documentUrl), dataset).terms(SEALED_BY).has(term(webId));
}
/** Whether `dataset`, the access document at `documentUrl`, carries `webId`'s securing mark. */
export function hasSecuringMark(dataset: DatasetCore, documentUrl: string, webId: string): boolean {
  return properties(term(documentUrl), dataset).terms(SECURING_BY).has(term(webId));
}
/** Add `webId`'s securing mark to an access document being written (`setGrants` `securing`). */
export function markSecuring(dataset: DatasetCore, documentUrl: string, webId: string): void {
  properties(term(documentUrl), dataset).terms(SECURING_BY).add(term(webId));
}
/**
 * Add (or with `sealed: false` remove) `webId`'s seal on the access document at `documentUrl`,
 * for writers that build an access document offline (such as a seeded demo pod). Sealing also
 * removes `webId`'s securing mark: the seal records that securing finished.
 */
export function sealDataset(
  dataset: DatasetCore,
  documentUrl: string,
  webId: string,
  sealed = true,
): void {
  const subject = properties(term(documentUrl), dataset);
  if (sealed) {
    subject.terms(SEALED_BY).add(term(webId));
    subject.terms(SECURING_BY).delete(term(webId));
  } else subject.terms(SEALED_BY).delete(term(webId));
}
/**
 * Whether `url`'s OWN access document carries the caller's seal. An inherited document never
 * counts, and a missing own document is unsealed.
 */
export async function isSealed(url: string, options: GrantMutationOptions): Promise<boolean> {
  const { own } = await load(url, options);
  return own !== undefined && hasSeal(own.dataset, own.url, options.webId);
}
/**
 * Whether `url`'s OWN access document carries the caller's securing mark: a `setGrants` call with
 * `securing: true` rewrote it, and no `sealAccess` has followed. An inherited document never
 * counts. Like the seal, only an agent with Control on the resource can write or remove it.
 */
export async function isSecuring(url: string, options: GrantMutationOptions): Promise<boolean> {
  const { own } = await load(url, options);
  return own !== undefined && hasSecuringMark(own.dataset, own.url, options.webId);
}
async function setSeal(url: string, options: GrantMutationOptions, sealed: boolean) {
  const { own } = await load(url, options);
  if (!own) {
    if (!sealed) return;
    throw roleError("unsupported", url, "Only an existing own access document can be sealed");
  }
  if (
    hasSeal(own.dataset, own.url, options.webId) === sealed &&
    !(sealed && hasSecuringMark(own.dataset, own.url, options.webId))
  )
    return;
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
 * statement except the caller's securing mark, which the same write removes. Seal only after verifying, under access that only you hold, what the resource
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
