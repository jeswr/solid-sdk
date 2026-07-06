import { type VerifyCredentialOptions } from "@jeswr/solid-vc";
import type { PodFetch } from "../config.js";
import type { MandateVerifier } from "./types.js";
/** Options for {@link createSolidVcMandateVerifier}. */
export interface SolidVcMandateVerifierOptions {
    /** A pod authed `fetch` used READ-ONLY to load the mandate + policy. */
    readonly readFetch: PodFetch;
    /** The signed mandate credential's URL (a JSON-LD `AgentAuthorizationCredential`). */
    readonly mandateUrl: string;
    /** The pod owner's WebID — the mandate MUST verify as issued by this WebID. */
    readonly ownerWebId: string;
    /** Resolve a `verificationMethod` IRI to the owner's public key (the credential seam). */
    readonly resolveKey: VerifyCredentialOptions["resolveKey"];
    /** Override the WebID-controller check (default: the `#key` / key-path convention). */
    readonly isControlledBy?: VerifyCredentialOptions["isControlledBy"];
    /** The revocation/suspension status seam (fail-closed when supplied). */
    readonly resolveStatus?: VerifyCredentialOptions["resolveStatus"];
    /** The ODRL policy resource URL; default: the credential's `credentialSubject.policy` IRI. */
    readonly policyUrl?: string;
}
/** Build the fail-closed, solid-vc-backed mandate verifier. */
export declare function createSolidVcMandateVerifier(options: SolidVcMandateVerifierOptions): MandateVerifier;
//# sourceMappingURL=solid-vc-verifier.d.ts.map