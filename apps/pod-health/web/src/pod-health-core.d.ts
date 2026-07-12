// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Ambient typing for the bare `pod-health` data-layer module the host consumes
// for Type-Index discovery. Vite bundles the library's TS SOURCE directly (see
// vite.config.ts's `pod-health` alias), but tsc must NOT type-check the
// out-of-root source. So we declare ONLY the slice the host imports — the
// `TypeIndexDataset` reader (to locate where the user registered
// `health:HealthRecord`) and the `HealthClass` IRI table. Kept in lock-step with
// ../src/type-index.ts + ../src/vocab.ts; update in the same change if they move.
declare module "pod-health" {
  import type { DataFactory, DatasetCore } from "@rdfjs/types";

  /** The location a class is registered at — a single resource or a container. */
  export interface RegistrationLocation {
    /** A single resource holding instances of the class (`solid:instance`). */
    instance?: string;
    /** A container listing instances of the class (`solid:instanceContainer`). */
    container?: string;
  }

  /** A type-index document, wrapped whole — read `locate(classIri)` off it. */
  export class TypeIndexDataset {
    // The factory is the RDF/JS DataFactory the wrapper builds terms with; n3's
    // DataFactory (what the host passes) satisfies this structural type.
    constructor(dataset: DatasetCore, factory: DataFactory);
    /** The location(s) registered for a class IRI (a hint, possibly several). */
    locate(classIri: string): RegistrationLocation[];
  }

  /** Health sector classes (verbatim from health.ttl). */
  export const HealthClass: {
    readonly HealthRecord: string;
    readonly [key: string]: string;
  };
}
