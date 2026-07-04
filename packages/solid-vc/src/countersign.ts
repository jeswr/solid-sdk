// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Countersigning — adding a SECOND (or Nth) Data Integrity proof to an
// already-signed Verifiable Credential.
//
// THIS IS A PROOF **SET**, NOT A PROOF **CHAIN** — the distinction is
// security-load-bearing:
//
//   • proof SET (what this does): each proof is an INDEPENDENT, PARALLEL
//     attestation over the SAME unsigned claim graph. The co-signer signs
//     byte-for-byte the SAME quads the first signer signed (all prior proofs
//     stripped before lowering — see {@link unsigned}). Semantics: "co-signer Y
//     ALSO independently attests these exact claims." This matches how
//     {@link verifyCredential} verifies multi-proof credentials — it strips every
//     proof, recomputes the one claim graph, and requires EVERY proof valid over
//     it. So a proof set produced here verifies under the existing pipeline with
//     no changes.
//
//   • proof CHAIN (deliberately NOT done here): a later proof signs over the
//     graph PLUS the earlier proof(s), asserting "I approve/endorse that prior
//     signature", giving an ORDERED endorsement. That is a DIFFERENT primitive
//     with a DIFFERENT verification rule (each link must be checked against the
//     graph-plus-preceding-proofs, in order). Producing a chain by mistake here
//     would create proofs the current verifier CANNOT validate (it only ever
//     hashes the proof-less graph), i.e. a silently-unverifiable credential —
//     which is why chain support is a documented FUTURE primitive, gated behind
//     its own verify-side rule, not a quiet variant of this function.
//
// Fail-closed PRODUCER guards (this is a producer API, so it THROWS on misuse —
// unlike the verifier, which returns a structured result and never throws):
//   • the input MUST already carry at least one proof (nothing to countersign —
//     the FIRST signature is `issue()`, not this);
//   • the input MUST be structurally a signed credential (a string issuer + a
//     credentialSubject) — refusing to "countersign" a shapeless object.
//
// Existing proof bytes are PRESERVED EXACTLY and in order: the returned VC's
// `proof` is `[...existingProofs, newProof]` — the prior proof objects are the
// same references (never re-serialised, never reordered, never dropped).

import { credentialToRdf } from "./credential.js";
import { DataIntegritySuite, type ProofSuite } from "./proof.js";
import { proofsOf, unsigned } from "./proof-set.js";
import type { IssueOptions, KeyPair, VerifiableCredential } from "./types.js";

/** Options for {@link countersign}. */
export interface CountersignOptions {
  /**
   * The proof suite the CO-SIGNER signs with. Defaults to the bundled
   * `eddsa-rdfc-2022` Data Integrity suite. A co-signer MAY use a different suite
   * from the original signer — each proof in the set is verified through its own
   * `proof.cryptosuite`.
   */
  readonly suite?: ProofSuite;
  /** Signing options for the countersignature (proofPurpose, created). */
  readonly options?: IssueOptions;
}

/**
 * Add a countersignature to an already-signed {@link VerifiableCredential},
 * returning a new VC whose `proof` is a PROOF SET `[...existingProofs, newProof]`.
 *
 * The countersignature is computed over the SAME unsigned claim graph the first
 * signature covered ({@link unsigned} strips ALL existing proofs, then
 * {@link credentialToRdf} lowers exactly as `issue()`/`verifyCredential` do), so
 * the co-signer independently attests the SAME claims — a proof SET, not a proof
 * chain (see the file header). The returned VC verifies under
 * {@link verifyCredential} when the caller's `resolveKey` resolves EVERY proof's
 * `verificationMethod` and each proof's method satisfies the issuer-binding check
 * (every proof required valid — the conjunction).
 *
 * @throws if `vc` carries no existing proof (use `issue()` for the first
 *   signature) or is not structurally a signed credential (missing issuer /
 *   credentialSubject).
 */
export async function countersign(
  vc: VerifiableCredential,
  key: KeyPair | unknown,
  opts?: CountersignOptions,
): Promise<VerifiableCredential> {
  // Producer guard 1: structurally a signed credential. Refuse to "countersign" a
  // shapeless / half-formed object — a countersignature over a non-credential is
  // meaningless and would produce a graph the verifier rejects as MALFORMED.
  if (
    vc === null ||
    typeof vc !== "object" ||
    typeof vc.issuer !== "string" ||
    vc.issuer.length === 0 ||
    vc.credentialSubject === undefined
  ) {
    throw new Error(
      "@jeswr/solid-vc: countersign requires a structurally signed credential " +
        "(a string issuer and a credentialSubject) — got a non-credential object",
    );
  }

  // Producer guard 2: a STABLE credential id. `credentialToRdf` mints a fresh
  // random `urn:uuid:` subject whenever `id` is absent (it is non-deterministic),
  // so an id-less credential lowers to a DIFFERENT claim graph on every call —
  // meaning a countersignature computed here would NOT verify (verify re-lowers
  // the returned, still-id-less VC to yet another random subject), and the
  // credential's own first proof is already unverifiable for the same reason.
  // Refuse fail-closed rather than emit a silently-unverifiable proof set. Every
  // credential from this library's `issue()` carries an id, so this only rejects a
  // credential that could never have had a reproducible signature anyway.
  if (typeof vc.id !== "string" || vc.id.length === 0) {
    throw new Error(
      "@jeswr/solid-vc: countersign requires a credential with a stable `id` — an id-less " +
        "credential lowers to a fresh random subject on every call, so its signatures are not " +
        "reproducible and a countersignature would not verify",
    );
  }

  // Producer guard 3: there must be an EXISTING proof to countersign. The first
  // signature is `issue()`; countersign only ADDS to a proof set. Rejecting the
  // no-proof case keeps the two primitives distinct (and prevents a caller from
  // using countersign as a confusing alias for issue that skips issue's id/
  // validFrom normalisation).
  const existing = proofsOf(vc);
  if (existing.length === 0) {
    throw new Error(
      "@jeswr/solid-vc: countersign requires a credential that already carries a proof " +
        "— use issue() to create the first signature, then countersign() to add another",
    );
  }

  const suite = opts?.suite ?? new DataIntegritySuite("eddsa-rdfc-2022");
  const created = opts?.options?.created ?? new Date();
  const proofPurpose = opts?.options?.proofPurpose ?? "assertionMethod";

  // Recompute the unsigned claim graph EXACTLY as verify does: strip ALL proofs,
  // then lower. This makes the countersignature a parallel attestation over the
  // identical bytes the first proof covered (a proof SET) — NOT a signature over
  // graph-plus-first-proof (which would be a proof chain the verifier can't check).
  const documentQuads = credentialToRdf(unsigned(vc));
  const newProof = await suite.sign(documentQuads, {
    key,
    proofPurpose,
    created,
  });

  // Preserve every existing proof's bytes and order; append the new one. The
  // `existing` array holds the original proof object references (proofsOf never
  // rewrites them), so no prior proof is re-serialised, reordered, or dropped.
  return { ...vc, proof: [...existing, newProof] };
}
