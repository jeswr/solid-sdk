// AUTHORED-BY Claude Fable 5
//
// The G1 POLICY-CONTENT DIGEST: a cryptographic content address for an RDF
// resource (the ODRL Agreement/policy an AgentAuthorizationCredential
// authorizes), so the credential binds the policy's CONTENT — not merely its
// (mutable) IRI. A signed pointer to mutable content binds nothing: the issuer
// signs `svc:policy <P>`, then whoever controls `P` swaps the graph behind it
// and the signature still verifies (policy substitution). Binding the DIGEST of
// the policy's canonical form closes that: a verifier recomputes the digest over
// the presented policy and any substitution/mutation fails the comparison.
//
// Construction (the suite's canonical-hashing discipline — the same RDFC-1.0
// approach `@jeswr/solid-a2a` uses for protocol-document pinning and the Data
// Integrity `*-rdfc-*` suites use for the signing pre-image):
//
//   1. parse the resource content to RDF quads (`@jeswr/fetch-rdf` `parseRdf` —
//      never a bespoke parser);
//   2. canonicalize with RDFC-1.0 (the W3C Recommendation, via the vetted
//      `rdf-canonize` reference implementation — the ONLY sanctioned
//      canonicalizer, shared with src/canonicalize.ts);
//   3. SHA-256 over the canonical N-Quads octets;
//   4. encode as a VCDM 2.0 `digestMultibase`: a multibase (base58btc, `z`)
//      encoded MULTIHASH (sha2-256 code 0x12, length 0x20, then the 32 digest
//      octets).
//
// Because the digest is over the RDFC-1.0 canonical form, a REORDERED or
// relabelled-but-isomorphic policy yields the SAME digest (no false rejections
// from serialisation noise), while any semantic change to the graph yields a
// different one. Verification is a fail-closed string comparison of the
// recomputed `digestMultibase` against the signed one — no decode step, no
// partial acceptance.

import { createHash } from "node:crypto";
import { parseRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore, Quad } from "@rdfjs/types";
import { canonicalNQuads } from "./canonicalize.js";
import { base58btcEncode } from "./multibase.js";

/** The multihash code + length prefix for sha2-256 (0x12, 32 bytes). */
const MULTIHASH_SHA2_256_PREFIX = Uint8Array.from([0x12, 0x20]);

/** Wrap raw SHA-256 octets as a multibase(base58btc)-encoded multihash. */
function sha256Multihash(digest: Uint8Array): string {
  const out = new Uint8Array(MULTIHASH_SHA2_256_PREFIX.length + digest.length);
  out.set(MULTIHASH_SHA2_256_PREFIX, 0);
  out.set(digest, MULTIHASH_SHA2_256_PREFIX.length);
  return base58btcEncode(out);
}

/**
 * The VCDM 2.0 `digestMultibase` of a set of RDF quads: multibase(base58btc) of
 * the sha2-256 multihash over the RDFC-1.0 canonical N-Quads. Deterministic —
 * quad order and blank-node labelling do not affect the result.
 */
export async function digestQuads(quads: readonly Quad[]): Promise<string> {
  const canonical = await canonicalNQuads(quads);
  const digest = new Uint8Array(createHash("sha256").update(canonical, "utf8").digest());
  return sha256Multihash(digest);
}

/**
 * The VCDM 2.0 `digestMultibase` of an RDF resource given as SOURCE TEXT
 * (Turtle by default; any `parseRdf`-supported content type). The content is
 * parsed and canonicalized first, so two serialisations of the SAME graph —
 * reordered triples, different prefixes, different blank-node labels — produce
 * the SAME digest, and any graph change produces a different one.
 *
 * FAIL-CLOSED guards (both throw — a digest silently computed over nothing
 * would let an empty/unparseable "policy" be bound and later "verified"):
 *  - unparseable content → the parser's error propagates;
 *  - an EMPTY graph → throws (an authorization bound to zero triples is
 *    meaningless and almost certainly a caller bug — wrong content type or an
 *    empty fetch body).
 */
export async function digestRdfContent(
  content: string,
  contentType = "text/turtle",
): Promise<string> {
  const dataset = (await parseRdf(content, contentType)) as unknown as DatasetCore;
  const quads = [...dataset.match()] as Quad[];
  if (quads.length === 0) {
    throw new Error(
      "@jeswr/solid-vc: refusing to digest an EMPTY RDF graph — the content parsed to zero quads " +
        "(wrong contentType, or an empty policy document). A digest over nothing binds nothing.",
    );
  }
  return digestQuads(quads);
}
