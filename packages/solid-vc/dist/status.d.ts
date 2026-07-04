import type { SuiteRegistry } from "./proof.js";
import type { BitstringStatusListEntry, Credential, CredentialStatusCheck, VerifiableCredential } from "./types.js";
import { type VerifyCredentialOptions } from "./verify.js";
/** Input to {@link bitstringStatusListEntry}. */
export interface BitstringStatusListEntryInput {
    /** What a set bit means: `"revocation"` or `"suspension"`. */
    readonly statusPurpose: "revocation" | "suspension";
    /** The credential's bit position (non-negative integer, number or string). */
    readonly statusListIndex: number | string;
    /** The URL the signed `BitstringStatusListCredential` is hosted at (http(s)). */
    readonly statusListCredential: string;
    /** Optional entry IRI (an anonymous entry node when omitted). */
    readonly id?: string;
}
/**
 * Build a VALIDATED `credentialStatus` entry to place on a credential at
 * issuance (the issue-side param): pass the result as the `credentialStatus`
 * field of a {@link Credential} / `AgentAuthorization`, and `issue()` signs it
 * into the claim graph. Throws (fail-closed) on a non-integer index, an
 * unsupported purpose, or a non-http(s) list URL — a credential must never be
 * signed over a status entry its verifier cannot resolve.
 */
export declare function bitstringStatusListEntry(input: BitstringStatusListEntryInput): BitstringStatusListEntry;
/** Input to {@link buildBitstringStatusListCredential}. */
export interface BitstringStatusListCredentialInput {
    /**
     * The credential id — the URL the signed list will be HOSTED at (the same
     * URL credentials reference as `statusListCredential`; verifiers check the
     * fetched list's `id` equals the URL they fetched, so these MUST agree).
     */
    readonly id: string;
    /** The issuing party (normally the same issuer as the credentials listed). */
    readonly issuer: string;
    /** What a set bit means for this list. */
    readonly statusPurpose: "revocation" | "suspension";
    /**
     * The raw status bitstring (default: a fresh all-clear
     * `createStatusBitstring()` — the spec-minimum 131,072 entries / 16KB).
     */
    readonly bits?: Uint8Array;
    /** Validity start (optional). */
    readonly validFrom?: string;
    /** Expiry (optional — bounds how long a cached list can be replayed). */
    readonly validUntil?: string;
}
/**
 * Build the UNSIGNED `BitstringStatusListCredential` hosting a status list —
 * sign it with `issue()` and host the result at `input.id`. The subject is
 * `<id>#list`, a `BitstringStatusList` carrying the GZIP'd base64url
 * `encodedList`.
 */
export declare function buildBitstringStatusListCredential(input: BitstringStatusListCredentialInput): Credential;
/**
 * Decode the raw bitstring out of a (structured) status list credential —
 * throws fail-closed on a credential that is not a well-formed
 * `BitstringStatusListCredential`.
 */
export declare function statusListBitsOf(credential: Credential, options?: {
    readonly maxDecodedBytes?: number;
}): Uint8Array;
/**
 * Return a NEW unsigned status list credential with the bit at `index` set
 * (`value: true` — revoke/suspend) or cleared (`false` — reinstate). The
 * caller re-signs (`issue()`) and re-hosts the result; the input credential is
 * not mutated, and any existing proof is DROPPED (a changed list invalidates
 * the old signature by construction).
 */
export declare function withStatusBit(credential: Credential | VerifiableCredential, index: number, value: boolean): Credential;
/** Read the bit at `index` of a status list credential (see {@link getStatusBit}). */
export declare function readStatusBit(credential: Credential, index: number): boolean;
/** Options for {@link resolveBitstringStatus} / {@link createBitstringStatusResolver}. */
export interface BitstringStatusOptions {
    /**
     * Resolve a `verificationMethod` IRI to its public key — the SAME seam
     * `verifyCredential` uses; the status list credential's own signature is
     * verified through it. REQUIRED: an unverified status list is untrusted
     * input and must never gate a verification decision.
     */
    readonly resolveKey: VerifyCredentialOptions["resolveKey"];
    /** The proof-suite registry (default: the bundled Data Integrity suites). */
    readonly registry?: SuiteRegistry;
    /** The issuer-binding check for the LIST credential (see `verifyCredential`). */
    readonly isControlledBy?: VerifyCredentialOptions["isControlledBy"];
    /**
     * Issuers allowed to sign the status list. DEFAULT: exactly the issuer of
     * the credential being checked — the common (and safest) deployment, where
     * an issuer hosts its own lists. Widen ONLY for a deployment with a
     * dedicated status authority.
     */
    readonly trustedStatusIssuers?: readonly string[];
    /** The instant to evaluate the LIST credential's validity at (default now). */
    readonly now?: Date;
    /**
     * The fetch used to dereference `statusListCredential`. DEFAULT: the strict
     * `@jeswr/guarded-fetch/node` DNS-pinned SSRF-guarded fetch with redirects
     * REFUSED (`maxRedirects: 0`), lazily imported so browser bundles (which
     * MUST inject a fetch) never pull in undici. Even with an injected fetch,
     * the resolver still refuses any redirected or cross-URL response.
     */
    readonly fetch?: typeof globalThis.fetch;
    /** Zip-bomb ceiling on the DECODED bitstring (default 16 MiB). */
    readonly maxDecodedBytes?: number;
    /** Ceiling on the fetched response BODY (default 32 MiB). */
    readonly maxBodyBytes?: number;
}
/**
 * Resolve a credential's Bitstring Status List status — the Phase-C gate. See
 * the module header for the exact fail-closed semantics; in short:
 * `absent` (no `credentialStatus` — proceed) / `valid` (every bit clear) /
 * `revoked` / `suspended` (a bit is set) / `unreachable` (a PRESENT entry
 * could not be confirmed — a verification FAILURE, never a pass).
 *
 * With several entries, EVERY entry must resolve: a definitive `revoked`
 * outranks `suspended`, which outranks `unreachable`; `valid` only when all
 * entries resolved clear. Never throws — every anomaly folds into the result.
 */
export declare function resolveBitstringStatus(vc: VerifiableCredential | Credential, options: BitstringStatusOptions): Promise<CredentialStatusCheck>;
/**
 * Package {@link resolveBitstringStatus} as the `resolveStatus` seam
 * `verifyCredential` consumes: pass the result as
 * `verifyCredential(vc, { …, resolveStatus: createBitstringStatusResolver(opts) })`
 * and a revoked / suspended / unconfirmable credential fails verification with
 * `STATUS_REVOKED` / `STATUS_SUSPENDED` / `STATUS_UNREACHABLE`.
 */
export declare function createBitstringStatusResolver(options: BitstringStatusOptions): (vc: VerifiableCredential) => Promise<CredentialStatusCheck>;
//# sourceMappingURL=status.d.ts.map