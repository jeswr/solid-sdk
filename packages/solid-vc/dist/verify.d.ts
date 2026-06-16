import type { ProofVerifyOptions, SuiteRegistry } from "./proof.js";
import type { VerifiableCredential, VerificationResult, VerifyOptions } from "./types.js";
/** Options for {@link verifyCredential}: the suite registry + the key resolver. */
export interface VerifyCredentialOptions extends VerifyOptions {
    /**
     * The registry of accepted proof suites. Defaults to the bundled Data Integrity
     * suites (`eddsa-rdfc-2022` + `ecdsa-rdfc-2019`). Register a BBS/JWT/SPARQ-ZK
     * suite to accept those proofs.
     */
    readonly registry?: SuiteRegistry;
    /**
     * Resolve a `verificationMethod` IRI to its public key (suite-specific; the
     * bundled suite wants a WebCrypto public `CryptoKey`). REQUIRED — a verifier
     * with no way to obtain the public key cannot verify anything.
     */
    readonly resolveKey: ProofVerifyOptions["resolveKey"];
    /**
     * Decide whether a `verificationMethod` IRI is controlled by `issuer`. Default:
     * the method IRI must equal the issuer IRI or start with `<issuer>#` /
     * `<issuer>/` (the common WebID `#key` / key-path convention). Override to consult
     * a DID document / WebID profile controller relationship.
     */
    readonly isControlledBy?: (verificationMethod: string, issuer: string) => boolean;
}
/**
 * Verify a {@link VerifiableCredential}. Returns a {@link VerificationResult}
 * whose `verified` is `true` IFF every gate passed; on failure `errors` lists
 * every distinct reason. Never throws on an invalid credential.
 */
export declare function verifyCredential(vc: VerifiableCredential, options: VerifyCredentialOptions): Promise<VerificationResult>;
//# sourceMappingURL=verify.d.ts.map