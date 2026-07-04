import type { Quad } from "@rdfjs/types";
import { type SuiteKeyType } from "./keys.js";
import type { KeyPair } from "./types.js";
/** A decoded Multikey: the imported WebCrypto public key + its suite key type. */
export interface DecodedMultikey {
    readonly publicKey: CryptoKey;
    readonly keyType: SuiteKeyType;
}
/**
 * Encode a public `CryptoKey` as a `sec:publicKeyMultibase` Multikey value:
 * multibase(base58btc) over the multicodec-prefixed raw key bytes —
 * `ed25519-pub` + the 32 raw Ed25519 bytes, or `p256-pub` + the 33-byte
 * COMPRESSED SEC1 point (per the W3C Controlled Identifiers Multikey spec).
 * Throws on a non-Ed25519/P-256 key — the write side fails LOUD, never
 * publishing a key the suite cannot verify against.
 */
export declare function encodeMultikey(publicKey: CryptoKey): Promise<string>;
/**
 * Decode a `sec:publicKeyMultibase` Multikey value back to a WebCrypto public
 * key. FAIL-CLOSED: returns `undefined` (never throws) on a non-`z` multibase,
 * an unknown multicodec prefix, wrong key length, an invalid point — anything
 * that is not exactly an `ed25519-pub` or `p256-pub` Multikey this suite can
 * verify against.
 */
export declare function decodeMultikey(publicKeyMultibase: string): Promise<DecodedMultikey | undefined>;
/** Input to {@link publishVerificationMethod}. */
export interface PublishVerificationMethodInput {
    /** The controlling identity — the WebID the key belongs to. */
    readonly controller: string;
    /**
     * The key to publish: a {@link KeyPair} (its `verificationMethod` names the
     * key id) or a bare public `CryptoKey` (then `verificationMethod` is required).
     * Only the PUBLIC key is ever read — a private key never enters the graph.
     */
    readonly key: KeyPair | CryptoKey;
    /** The verification-method (key id) IRI; defaults to `key.verificationMethod`. */
    readonly verificationMethod?: string;
}
/** The published verification method: the RDF + the values it asserts. */
export interface PublishedVerificationMethod {
    /** The canonicalised controller (WebID) IRI. */
    readonly controller: string;
    /** The canonicalised verification-method (key id) IRI. */
    readonly verificationMethod: string;
    /** The `sec:publicKeyMultibase` Multikey value. */
    readonly publicKeyMultibase: string;
    /** The key type the multikey encodes. */
    readonly keyType: SuiteKeyType;
    /** The RDF quads to merge into the WebID / controller document. */
    readonly quads: readonly Quad[];
    /** The same graph serialised as Turtle (ready to PUT/PATCH into the document). */
    readonly turtle: string;
}
/**
 * Produce the RDF a WebID / controller document must expose so a verifier can
 * find (and {@link resolveWebIdKey} will accept) the agent's public key:
 *
 * ```turtle
 * <controller> sec:verificationMethod <keyId> ;
 *              sec:assertionMethod   <keyId> .
 * <keyId> a sec:Multikey ;
 *         sec:controller <controller> ;
 *         sec:publicKeyMultibase "z…"^^sec:multibase .
 * ```
 *
 * The write side fails LOUD (throws) on a non-http(s) controller / key id or an
 * unsupported key type — a caller must never silently publish an unusable or
 * unsafe verification method. All IRIs go through the safe helpers (canonicalise
 * + IRIREF hardening); the graph is built through the typed {@link GraphBuilder}
 * write path and serialised with `n3.Writer` (never hand-concatenated).
 */
export declare function publishVerificationMethod(input: PublishVerificationMethodInput): Promise<PublishedVerificationMethod>;
/** Options for {@link resolveWebIdKey} / {@link createWebIdKeyResolver}. */
export interface ResolveWebIdKeyOptions {
    /**
     * The `fetch` used to dereference the WebID / key documents. DEFAULT: a
     * strict `@jeswr/guarded-fetch/node` DNS-pinned SSRF-guarded fetch with
     * redirects REFUSED (`maxRedirects: 0`), lazily imported so browser bundles
     * (which MUST inject a fetch) never pull in undici. Inject for tests (offline
     * fixtures) or for a browser / pre-authed fetch — the resolver still refuses
     * any redirected or cross-URL response an injected fetch lets through.
     */
    readonly fetch?: typeof globalThis.fetch;
}
/** A WebID-document-resolved verification method (see {@link resolveWebIdKey}). */
export interface ResolvedWebIdKey {
    /** The canonicalised WebID that the documents prove controls the key. */
    readonly controller: string;
    /** The canonicalised verification-method (key id) IRI. */
    readonly verificationMethod: string;
    /** The `sec:publicKeyMultibase` value the key document carries. */
    readonly publicKeyMultibase: string;
    /** The imported WebCrypto public key (what `resolveKey` feeds the suite). */
    readonly publicKey: CryptoKey;
    /** The key type the multikey encodes. */
    readonly keyType: SuiteKeyType;
}
/**
 * Resolve a verification method (key id) from a WebID, DOCUMENT-RESOLVED and
 * FAIL-CLOSED (G4): returns the key ONLY when
 *
 *   1. the WebID's own document lists `keyId` under `sec:assertionMethod`
 *      (the WebID actually authorises this key for assertion proofs), AND
 *   2. the key id's own document types it `sec:Multikey` and asserts
 *      `sec:controller` = exactly that WebID (the key binds back — no foreign
 *      or ambiguous controller), AND
 *   3. its single `sec:publicKeyMultibase` decodes to an Ed25519 / P-256 key.
 *
 * Every other outcome — an unlisted key, an absent key id, a controller
 * mismatch, extra controllers, conflicting multibase values, a redirect, any
 * fetch/parse failure, a malformed multikey — returns `undefined` (never
 * throws), so a credential naming a key the WebID never authorised can never
 * verify. Fetches ride `@jeswr/guarded-fetch/node` by default (DNS-pinned,
 * redirects refused); see {@link ResolveWebIdKeyOptions.fetch}.
 */
export declare function resolveWebIdKey(webId: string, keyId: string, options?: ResolveWebIdKeyOptions): Promise<ResolvedWebIdKey | undefined>;
/** The `verifyCredential`-shaped seam pair a WebID key resolver provides. */
export interface WebIdKeyResolver {
    /**
     * `VerifyCredentialOptions.resolveKey`: verification-method IRI → the
     * document-resolved public key, or `undefined` (fail-closed). The controller
     * is discovered FROM the key document (`sec:controller`, required unique) and
     * the full two-directional control check then runs against that controller's
     * own document.
     */
    readonly resolveKey: (verificationMethod: string) => Promise<CryptoKey | undefined>;
    /**
     * `VerifyCredentialOptions.isControlledBy`: whether the ISSUER's own WebID
     * document authorises the verification method AND the key document binds back
     * to the issuer — the document-resolved replacement for the default prefix
     * heuristic. Fail-closed `false` on any anomaly.
     */
    readonly isControlledBy: (verificationMethod: string, issuer: string) => Promise<boolean>;
}
/**
 * Build the `{ resolveKey, isControlledBy }` pair {@link verifyCredential | the
 * verify pipeline} consumes, backed by WebID-document resolution
 * ({@link resolveWebIdKey}) over the SSRF-guarded fetch. Documents are cached
 * for the LIFETIME OF THE RESOLVER INSTANCE (so one verification never
 * re-fetches the same profile for the two seams) — create a fresh resolver per
 * verification session to pick up rotated keys.
 */
export declare function createWebIdKeyResolver(options?: ResolveWebIdKeyOptions): WebIdKeyResolver;
//# sourceMappingURL=webid.d.ts.map