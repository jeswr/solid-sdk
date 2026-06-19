// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Shared "load an RDF dataset from a URL or an in-hand body" seam for the registry
// and storage fetch paths. Both paths face the SAME decision — a body in hand is a
// PARSE operation (no network), a URL is a FETCH operation — and must classify the
// error by the operation that threw so a network failure is never mislabelled
// `parse-failed` merely for lacking an HTTP status. Consolidating that one decision
// here means it is reviewed ONCE (it previously lived, byte-identical, in both
// registry.ts and storage.ts; the only difference was the document noun in the
// error message, which is now a parameter).
//
// Parsing is via @jeswr/fetch-rdf (Turtle/JSON-LD conneg). The caller passes its
// own FetchOptions / StorageFetchOptions — structurally a superset of {@link
// LoadOptions}, so no public type changes.

import { fetchRdf, parseRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { classifyFetchError } from "./errors.js";
import type { RegistryIssue } from "./types.js";

/** The subset of the fetch-backed options the loader needs. */
export interface LoadOptions {
  /** A `fetch` implementation (e.g. an authenticated Solid fetch). */
  readonly fetch?: typeof globalThis.fetch;
  /** Parse a body already in hand instead of fetching. */
  readonly body?: string;
  /** Content-Type for {@link LoadOptions.body} (default `text/turtle`). */
  readonly bodyContentType?: string;
  /** Base IRI to resolve relative IRIs when parsing a body (default the input). */
  readonly baseIRI?: string;
}

/** A loaded dataset, or the single issue describing why it could not be loaded. */
export type LoadResult = { dataset: DatasetCore } | { issue: RegistryIssue };

/**
 * Load an RDF dataset from `input`: parse `options.body` if present (a PARSE
 * operation, no network), else fetch `input` (a FETCH operation). On failure
 * returns a single `{ issue }` whose code distinguishes a transport `fetch-failed`
 * from a `parse-failed` (see {@link classifyFetchError}); `noun` names the document
 * in the human-readable message (e.g. "registry document" / "storage description").
 */
export async function loadDataset(
  input: string,
  options: LoadOptions,
  noun: string,
): Promise<LoadResult> {
  if (options.body !== undefined) {
    try {
      const dataset = await parseRdf(options.body, options.bodyContentType ?? "text/turtle", {
        baseIRI: options.baseIRI ?? input,
      });
      return { dataset };
    } catch (err) {
      return { issue: { code: "parse-failed", message: describeError(err, noun), subject: input } };
    }
  }
  try {
    const fetched = await fetchRdf(input, options.fetch ? { fetch: options.fetch } : {});
    return { dataset: fetched.dataset };
  } catch (err) {
    return {
      issue: { code: classifyFetchError(err), message: describeError(err, noun), subject: input },
    };
  }
}

/**
 * Render an error from the load path into a human-readable message. An
 * {@link RdfFetchError} with a `status` is an HTTP failure; without one it is a
 * parse-of-response failure. `noun` names the document (e.g. "registry document").
 */
export function describeError(err: unknown, noun: string): string {
  if (err instanceof RdfFetchError) {
    return err.status
      ? `Failed to fetch ${noun} (HTTP ${err.status}): ${err.message}`
      : `Failed to parse ${noun}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
