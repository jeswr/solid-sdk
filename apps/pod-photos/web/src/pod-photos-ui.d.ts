// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Ambient typing for the @jeswr/pod-photos modules the host consumes. Vite
// bundles the library's TS SOURCE directly (see vite.config.ts's aliases), but
// tsc must NOT type-check the out-of-root library source (it is type-checked in
// its own package, against its own node_modules). So we declare ONLY the public
// surface the host imports — kept in lock-step with the real signatures in
// ../src/ui/PhotoGallery.tsx and ../src/pod/type-index.ts + ../src/photos/vocab.ts.
// If any of those signatures change, update this declaration in the SAME change
// (the skill/maintenance rule).

declare module "@jeswr/pod-photos/ui" {
  import type { JSX } from "react";

  export interface PhotoGalleryProps {
    /** The container URL to open first (the gallery root). */
    rootUrl: string;
    /**
     * The authenticated fetch for pod reads. Omit to use the ambient global
     * fetch (patched by @solid/reactive-authentication in a real session).
     */
    fetch?: typeof fetch;
    /** Optional heading rendered above the gallery. */
    title?: string;
  }

  export function PhotoGallery(props: PhotoGalleryProps): JSX.Element;
}

declare module "@jeswr/pod-photos" {
  import type { DatasetCore } from "@rdfjs/types";

  /** The RDF class a single photo is stamped + Type-Index-registered with. */
  export const PHOTOGRAPH_CLASS: string;
  /** Container slug (under the pod root) where photo descriptions live. */
  export const PHOTOS_SLUG: string;

  /** The two type indexes advertised on a WebID profile (either may be absent). */
  export interface TypeIndexLinks {
    publicIndex?: string;
    privateIndex?: string;
  }

  /** Read both `solid:*TypeIndex` links off the WebID subject of a profile dataset. */
  export function typeIndexLinks(webId: string, profile: DatasetCore): TypeIndexLinks;

  /** A located registration: where data for a class lives. */
  export interface RegisteredLocation {
    forClass: string;
    instance?: string;
    container?: string;
  }

  /** A type-index document, wrapped whole — read-only lookups used by the host. */
  export class TypeIndexDataset {
    constructor(dataset: DatasetCore, factory: unknown);
    /** All registered locations across every class. */
    all(): RegisteredLocation[];
    /** Find the location(s) registered for a class IRI. */
    locate(classIri: string): RegisteredLocation[];
  }

  /**
   * Fetch + parse a pod RDF document, always revalidating any cached copy.
   * `fetchImpl` is a test-only override; omit it in production so the
   * auth-patched global fetch runs.
   */
  export function freshRdf(
    url: string,
    fetchImpl?: typeof fetch,
  ): Promise<{ dataset: DatasetCore; etag: string | null }>;
}
