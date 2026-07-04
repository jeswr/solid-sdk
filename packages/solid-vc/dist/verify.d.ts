import type { ProofVerifyOptions, SuiteRegistry } from "./proof.js";
import type { Credential, CredentialStatusCheck, PresentedResourceContent, VerifiableCredential, VerificationResult, VerifyOptions } from "./types.js";
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
     * a DID document / WebID profile controller relationship — may be ASYNC (a
     * document-resolved check fetches the controller document): supply
     * `createWebIdKeyResolver().isControlledBy` for the fail-closed,
     * WebID-document-resolved check (runtime Phase-1 G4).
     */
    readonly isControlledBy?: (verificationMethod: string, issuer: string) => boolean | Promise<boolean>;
    /**
     * The content of related resources the verifier was PRESENTED, keyed by
     * resource IRI — the G1 policy-content-binding check. For EVERY entry here,
     * the credential MUST carry a signed `relatedResource` digest for that IRI
     * and the digest recomputed over the presented content's canonical form
     * (RDFC-1.0 → sha2-256 → digestMultibase) MUST match — else verification
     * fails with `RELATED_RESOURCE_MISSING` / `RELATED_RESOURCE_MISMATCH`.
     * FAIL-CLOSED in every branch: no digest to check against, unparseable
     * content, and a digest mismatch all reject. (Resources the credential lists
     * but the caller did not present are NOT checked — the caller asserts which
     * content it is about to trust.)
     */
    readonly presentedResources?: Readonly<Record<string, PresentedResourceContent>>;
    /**
     * The credential-status seam (Phase C — revocation/suspension, runtime G2).
     * When supplied, the resolver is consulted and its outcome gates the
     * verification FAIL-CLOSED:
     *
     *  - `revoked` / `suspended` → `STATUS_REVOKED` / `STATUS_SUSPENDED`;
     *  - `unreachable` — a PRESENT `credentialStatus` entry that could not be
     *    fetched / verified / decoded → `STATUS_UNREACHABLE` (a distinct
     *    verification failure, NEVER a silent pass);
     *  - a resolver that THROWS or returns an unrecognised shape →
     *    `STATUS_UNREACHABLE` (the seam itself is fail-closed);
     *  - only `valid` (every bit clear) and `absent` (the credential carries NO
     *    status entry — the issuer provides no revocation mechanism) let
     *    verification proceed.
     *
     * Supply `createBitstringStatusResolver(…)` for the W3C Bitstring Status
     * List v1.0 implementation. When this option is OMITTED, status is NOT
     * checked (the pre-G2 behaviour) — a Phase-C verifier MUST supply it.
     */
    readonly resolveStatus?: (vc: VerifiableCredential) => CredentialStatusCheck | Promise<CredentialStatusCheck>;
}
/**
 * Verify the G1 policy-content bindings ALONE: for every presented resource,
 * recompute its canonical digest and compare against the credential's
 * `relatedResource` `digestMultibase`, fail-closed (see
 * {@link VerifyCredentialOptions.presentedResources} for the exact semantics).
 *
 * NOTE this checks CONTENT INTEGRITY only — it does NOT verify the proof. The
 * digest bindings are trustworthy only because they live in the SIGNED claim
 * graph, so a real verifier composes this with the signature gates: either call
 * {@link verifyCredential} with the `presentedResources` option (which runs
 * both), or call this ONLY on a credential that already passed
 * `verifyCredential`.
 */
export declare function verifyRelatedResources(credential: Credential, presentedResources: Readonly<Record<string, PresentedResourceContent>>): Promise<VerificationResult>;
/**
 * Verify a {@link VerifiableCredential}. Returns a {@link VerificationResult}
 * whose `verified` is `true` IFF every gate passed; on failure `errors` lists
 * every distinct reason. Never throws on an invalid credential.
 */
export declare function verifyCredential(vc: VerifiableCredential, options: VerifyCredentialOptions): Promise<VerificationResult>;
//# sourceMappingURL=verify.d.ts.map