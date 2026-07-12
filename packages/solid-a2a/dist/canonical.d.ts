import type { Quad } from "@rdfjs/types";
/**
 * Canonicalize quads to their RDFC-1.0 canonical N-Quads serialisation. The output
 * is stable across runs / builders / parse round-trips and byte-identical for any
 * conformant RDFC-1.0 implementation, so a SHA-256 over it is a portable content
 * address. An empty input canonicalizes to the empty string.
 *
 * Async because the reference implementation's public API (`canonize`) is async;
 * see `hashQuads` in protocol.ts for the hashing wrapper.
 */
export declare function canonicalNQuads(quads: readonly Quad[]): Promise<string>;
//# sourceMappingURL=canonical.d.ts.map