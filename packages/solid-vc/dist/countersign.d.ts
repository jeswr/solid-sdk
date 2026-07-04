import { type ProofSuite } from "./proof.js";
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
export declare function countersign(vc: VerifiableCredential, key: KeyPair | unknown, opts?: CountersignOptions): Promise<VerifiableCredential>;
//# sourceMappingURL=countersign.d.ts.map