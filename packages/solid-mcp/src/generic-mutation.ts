// AUTHORED-BY Codex GPT-6.1-Sol
import { isAuxiliaryResourceTarget } from "@jeswr/storage-capabilities";
import { pathAliases } from "./personal-data.js";
import type { PodConditions, PodHeadResult } from "./pod-port.js";

export const AUXILIARY_MUTATION_DENIED =
  "Generic tools cannot mutate access-control or description resources";
export const MUTATION_DISCOVERY_UNAVAILABLE =
  "Access-control and description discovery unavailable; mutation refused";
export const WRITE_ETAG_REQUIRED =
  "Replacement requires an ETag: read the resource first and pass its ETag as ifMatch";
export const WRITE_CONFLICT =
  "Resource changed or already exists: read the resource first and pass its ETag as ifMatch";

/** A single strong HTTP entity tag, never a wildcard, weak tag or validator list. */
export function strongWriteEtag(etag: string): boolean {
  return /^"[\x21\x23-\x7e\x80-\xff]*"(?![\s\S])/u.test(etag);
}

/** Generic writes always carry an atomic create or exact-version condition. */
export function requireWriteConditions(
  cond: PodConditions,
): asserts cond is
  | { ifNoneMatch: "*"; ifMatch?: never }
  | { ifMatch: string; ifNoneMatch?: never } {
  if (
    (cond.ifNoneMatch === "*" && cond.ifMatch === undefined) ||
    (cond.ifNoneMatch === undefined && cond.ifMatch !== undefined && strongWriteEtag(cond.ifMatch))
  )
    return;
  throw new Error(WRITE_ETAG_REQUIRED);
}

/** Check untruncated paths; reject encodings and delimiters before alias normalization. */
export function requireDataMutationPath(target: string): void {
  if (isAuxiliaryResourceTarget(target)) throw new Error(AUXILIARY_MUTATION_DENIED);
}

/** HEAD must affirm a complete set of auxiliary links, even when that set is empty. */
export function requireDataMutationMetadata(target: string, metadata: PodHeadResult): void {
  if (!Array.isArray(metadata.auxiliaryResources)) throw new Error(MUTATION_DISCOVERY_UNAVAILABLE);
  const parsed = new URL(target);
  const aliases = pathAliases(parsed);
  for (const resource of metadata.auxiliaryResources) {
    let linked: URL;
    try {
      linked = new URL(resource);
    } catch {
      throw new Error(MUTATION_DISCOVERY_UNAVAILABLE);
    }
    if (
      linked.origin === parsed.origin &&
      linked.search === parsed.search &&
      linked.hash === parsed.hash &&
      pathAliases(linked).some((path) => aliases.includes(path))
    )
      throw new Error(AUXILIARY_MUTATION_DENIED);
  }
}
