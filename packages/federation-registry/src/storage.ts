// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The storage-catalogue API: build a fedreg:StorageDescription (a resource
// server's advertisement of which client-client spec-VERSIONS it accepts + which
// sectors it supports), parse / verify one, and the acceptsSpec(...) query that
// drives asynchronous schema migration — an app asks "does this storage accept the
// spec-version I'm about to write?" before writing, rather than assuming.

import { fetchRdf, parseRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import type { DatasetCore, Quad } from "@rdfjs/types";
import { classifyFetchError } from "./errors.js";
import { serialize } from "./serialize.js";
import type { StorageDescription, StorageVerification } from "./types.js";
import { verifyStorageNode } from "./verify.js";
import { RegistryBuilder, type StorageNode, wrap } from "./wrappers.js";

/** Input to {@link describeStorage}. */
export interface StorageInput {
  /** The description's IRI (typically the storage root). */
  readonly id: string;
  /** The storage the description is about (`fedreg:storage`); defaults to `id`. */
  readonly storage?: string;
  /** Client-client spec-VERSION IRIs the storage accepts (`fedreg:acceptsSpec`). */
  readonly acceptsSpec: readonly string[];
  /** Data sector IRIs the storage supports (`fedreg:supportsSector`). */
  readonly supportsSector?: readonly string[];
}

/** The output of {@link describeStorage}. */
export interface BuiltStorage {
  /** The constructed quads (a `fedreg:StorageDescription` graph). */
  readonly quads: readonly Quad[];
  /** Serialise to Turtle (default) or another n3 format. */
  toString(format?: string): Promise<string>;
}

/**
 * Build a `fedreg:StorageDescription` — a resource server's federation catalogue
 * entry. This is the storage operator's authoring path; the served document is
 * what an app reads to discover the spec-versions the storage accepts.
 */
export function describeStorage(input: StorageInput): BuiltStorage {
  if (!input.id) {
    throw new TypeError("describeStorage: StorageInput.id (the description IRI) is required.");
  }
  const builder = new RegistryBuilder();
  const node = builder.storage(input.id);
  if (input.storage && input.storage !== input.id) {
    node.addStorage(input.storage);
  }
  for (const spec of input.acceptsSpec) {
    node.addAcceptsSpec(spec);
  }
  for (const sector of input.supportsSector ?? []) {
    node.addSupportsSector(sector);
  }
  const quads = builder.quads();
  return { quads, toString: (format?: string) => serialize(quads, format) };
}

/** Options for the fetch-backed storage entry points. */
export interface StorageFetchOptions {
  /** A `fetch` implementation (e.g. an authenticated Solid fetch). */
  readonly fetch?: typeof globalThis.fetch;
  /** Parse a body already in hand instead of fetching. */
  readonly body?: string;
  /** Content-Type for {@link StorageFetchOptions.body} (default `text/turtle`). */
  readonly bodyContentType?: string;
  /** Base IRI to resolve relative IRIs when parsing a body (default the input). */
  readonly baseIRI?: string;
}

/**
 * Fetch (or accept) a `fedreg:StorageDescription` document and verify it. When the
 * document holds more than one description, the FIRST is returned (a storage
 * catalogue document is expected to describe one storage).
 */
export async function parseStorage(
  input: string,
  options: StorageFetchOptions = {},
): Promise<StorageVerification> {
  // A body in hand is a PARSE operation (no network); a URL is a FETCH operation.
  // Classify the error by the operation that threw — never collapse a network
  // failure into `parse-failed` just because it lacks an HTTP status.
  let dataset: DatasetCore;
  if (options.body !== undefined) {
    try {
      dataset = await parseRdf(options.body, options.bodyContentType ?? "text/turtle", {
        baseIRI: options.baseIRI ?? input,
      });
    } catch (err) {
      return {
        valid: false,
        issues: [{ code: "parse-failed", message: describeError(err), subject: input }],
      };
    }
  } else {
    try {
      const fetched = await fetchRdf(input, options.fetch ? { fetch: options.fetch } : {});
      dataset = fetched.dataset;
    } catch (err) {
      return {
        valid: false,
        issues: [{ code: classifyFetchError(err), message: describeError(err), subject: input }],
      };
    }
  }
  return parseStorageDataset(dataset, input);
}

/** Verify an already-parsed dataset as a storage description. */
export function parseStorageDataset(
  dataset: DatasetCore,
  expectedId?: string,
): StorageVerification {
  const fed = wrap(dataset);
  const descriptions = fed.storageDescriptions();
  if (descriptions.length === 0) {
    return {
      valid: false,
      issues: [
        {
          code: "no-storage-description",
          message: "No fedreg:StorageDescription subject found in the document.",
          subject: expectedId,
        },
      ],
    };
  }
  return verifyStorageNode(descriptions[0] as StorageNode);
}

/**
 * Does a storage accept a given client-client spec-version?  The core
 * migration-coordination query: an app calls this against a storage's
 * {@link StorageDescription} (parsed via {@link parseStorage}) before writing
 * data validated against `specVersionIri`. During a dual-read window a storage
 * advertises BOTH the old and the new version, so this returns `true` for either —
 * letting the app and the storage migrate on independent clocks.
 *
 * Comparison is exact-IRI: spec versions are immutable, persistent IRIs (e.g. a
 * canonical model version), so an app must advertise (and check) the EXACT version
 * it writes against — never a prefix/loose match that could silently accept an
 * incompatible version.
 */
export function acceptsSpec(
  storage: Pick<StorageDescription, "acceptsSpec">,
  specVersionIri: string,
): boolean {
  return storage.acceptsSpec.includes(specVersionIri);
}

/**
 * The subset of `wanted` spec-versions a storage does NOT accept — the gap an app
 * must close (or wait for the storage to migrate) before it can write all of them.
 * Empty ⇒ the storage accepts every wanted version.
 */
export function unsupportedSpecs(
  storage: Pick<StorageDescription, "acceptsSpec">,
  wanted: readonly string[],
): string[] {
  const accepted = new Set(storage.acceptsSpec);
  return wanted.filter((w) => !accepted.has(w));
}

function describeError(err: unknown): string {
  if (err instanceof RdfFetchError) {
    return err.status
      ? `Failed to fetch storage description (HTTP ${err.status}): ${err.message}`
      : `Failed to parse storage description: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
