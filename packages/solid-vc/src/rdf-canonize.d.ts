// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Minimal ambient type declaration for `rdf-canonize` (the W3C RDFC-1.0 reference
// implementation, used for the Data Integrity transformation step). The package
// ships no `.d.ts`; we declare ONLY the `canonize` surface we use — the array of
// RDF/JS quads in, the canonical N-Quads string out — so the typecheck binds the
// exact call we make in src/canonicalize.ts rather than `any`.

declare module "rdf-canonize" {
  import type { Quad } from "@rdfjs/types";

  export interface CanonizeOptions {
    /** The canonicalization algorithm — we use `"RDFC-1.0"` (the W3C REC). */
    algorithm: "RDFC-1.0" | "URDNA2015" | "URGNA2012";
    /** Output format — we use `"application/n-quads"` for the canonical string. */
    format?: "application/n-quads";
    /** Optional cap on the number of blank-node permutations (poison-graph guard). */
    maxDeepIterations?: number;
  }

  /**
   * Canonicalize an array of RDF/JS quads. With `format: "application/n-quads"`
   * resolves to the canonical N-Quads string.
   */
  export function canonize(quads: Quad[], options: CanonizeOptions): Promise<string>;
}
