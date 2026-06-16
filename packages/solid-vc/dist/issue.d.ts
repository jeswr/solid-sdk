import { type ProofSuite } from "./proof.js";
import type { AgentAuthorization, Credential, IssueOptions, KeyPair, VerifiableCredential } from "./types.js";
/** Inputs to {@link issue}. */
export interface IssueInput {
    /** The unsigned credential (claim graph). */
    readonly credential: Credential;
    /** The signing key (the bundled suite expects a {@link KeyPair}). */
    readonly key: KeyPair | unknown;
    /**
     * The proof suite to sign with. Defaults to the bundled `eddsa-rdfc-2022`
     * Data Integrity suite. Pass a BBS / JWT / SPARQ-ZK suite to sign with that.
     */
    readonly suite?: ProofSuite;
    /** Signing options (proofPurpose, created). */
    readonly options?: IssueOptions;
}
/**
 * Issue (sign) a Verifiable Credential. The proof is computed over the credential's
 * RDFC-1.0-canonical claim graph (the SAME bytes a verifier reconstructs), so any
 * later tamper to a claim, the issuer, the validity window, or the proof options
 * invalidates the signature.
 *
 * `validFrom` defaults to `now` (the `created` time, or wall-clock) when the caller
 * omitted it — so an issued credential always carries an issuance instant.
 */
export declare function issue(input: IssueInput): Promise<VerifiableCredential>;
/**
 * Convenience: build + sign an {@link AgentAuthorization} ("WebID X authorizes
 * agent Y for action Z under policy P") in one call. The principal WebID is the
 * issuer; sign with that WebID's key.
 */
export declare function issueAgentAuthorization(auth: AgentAuthorization, key: KeyPair | unknown, opts?: {
    suite?: ProofSuite;
    options?: IssueOptions;
}): Promise<VerifiableCredential>;
//# sourceMappingURL=issue.d.ts.map