import type { Quad } from "@rdfjs/types";
import type { DataIntegrityProof } from "./types.js";
/**
 * The pluggable proof-suite interface. A suite owns ONE `cryptosuite` identifier
 * and the (sign, verify) pair over a credential's claim quads. The issue/verify
 * pipeline never references a concrete suite — only this interface via the
 * {@link SuiteRegistry}.
 */
export interface ProofSuite {
    /** The `proof.cryptosuite` value this suite produces / accepts (the dispatch key). */
    readonly cryptosuite: string;
    /**
     * Produce a Data Integrity `proof` over `documentQuads` (the claim graph WITHOUT
     * any proof). `key` is opaque to the pipeline — the bundled suite uses a
     * {@link KeyPair}; a ZK suite may take a witness/commitment instead.
     */
    sign(documentQuads: readonly Quad[], options: ProofSignOptions): Promise<DataIntegrityProof>;
    /**
     * Verify `proof` over `documentQuads`. Returns `true` IFF the proof is
     * cryptographically valid for these exact bytes. MUST NOT throw on an invalid
     * proof — return `false` (the pipeline turns that into a structured error). May
     * throw only on a programming error (e.g. an unresolvable verification method).
     */
    verify(documentQuads: readonly Quad[], proof: DataIntegrityProof, options: ProofVerifyOptions): Promise<boolean>;
}
/** Inputs to {@link ProofSuite.sign}. */
export interface ProofSignOptions {
    /** The signing key / witness (suite-specific; the bundled suite wants a {@link KeyPair}). */
    readonly key: unknown;
    /** The `proofPurpose` (default `assertionMethod`). */
    readonly proofPurpose: string;
    /** The proof `created` timestamp. */
    readonly created: Date;
}
/** Inputs to {@link ProofSuite.verify}. */
export interface ProofVerifyOptions {
    /**
     * Resolve a `verificationMethod` IRI to the public key to verify against. The
     * bundled suite needs a WebCrypto public `CryptoKey`. A caller supplies this
     * (e.g. from a DID document, a WebID profile, or an in-memory test key). If it
     * cannot resolve, return `undefined` and verification fails closed.
     */
    resolveKey(verificationMethod: string): Promise<CryptoKey | undefined> | CryptoKey | undefined;
}
/**
 * A registry of proof suites keyed by `cryptosuite`. The verify pipeline looks up
 * the suite for a proof's declared cryptosuite here; an unregistered suite fails
 * closed with `UNKNOWN_CRYPTOSUITE` (never a silent accept).
 */
export declare class SuiteRegistry {
    private readonly suites;
    /** Register a suite (overwrites any prior suite with the same cryptosuite id). */
    register(suite: ProofSuite): this;
    /** The suite for a cryptosuite id, or `undefined` if none is registered. */
    get(cryptosuite: string): ProofSuite | undefined;
    /** Every registered cryptosuite id. */
    list(): string[];
}
/**
 * The proof-options quads that are hashed alongside the document (Data Integrity
 * "proof configuration"). Binding these makes the proof non-malleable: the suite,
 * verification method, purpose and created time are all under the signature.
 *
 * The proof-options subject is a fresh blank node (the proof node itself, sans
 * `proofValue`), so the hashed config matches what a verifier reconstructs from
 * the proof minus its `proofValue`.
 */
export declare function proofOptionsQuads(proof: Omit<DataIntegrityProof, "proofValue">): Quad[];
/**
 * The bundled concrete Data Integrity proof suite implementing `eddsa-rdfc-2022`
 * (EdDSA / Ed25519) and `ecdsa-rdfc-2019` (ECDSA / P-256), both over RDFC-1.0
 * canonicalization. One instance is created per cryptosuite (the dispatch key).
 *
 * This is the "ship at least one concrete signature suite using the suite's
 * existing crypto (asymmetric EdDSA/ES256)" deliverable. Asymmetric-only —
 * symmetric/HMAC proofs are deliberately not offered (a credential proof must be
 * verifiable by anyone holding the public key, exactly like PSS's verifier).
 */
export declare class DataIntegritySuite implements ProofSuite {
    readonly cryptosuite: string;
    constructor(cryptosuite?: "eddsa-rdfc-2022" | "ecdsa-rdfc-2019");
    sign(documentQuads: readonly Quad[], options: ProofSignOptions): Promise<DataIntegrityProof>;
    verify(documentQuads: readonly Quad[], proof: DataIntegrityProof, options: ProofVerifyOptions): Promise<boolean>;
}
/**
 * A {@link SuiteRegistry} pre-populated with the bundled Data Integrity suites
 * (`eddsa-rdfc-2022` + `ecdsa-rdfc-2019`). The default the issue/verify entrypoints
 * use when a caller passes none. A caller `.register()`s a BBS / JWT / SPARQ-ZK
 * suite onto a (copy of a) registry to extend the accepted set.
 */
export declare function defaultSuiteRegistry(): SuiteRegistry;
//# sourceMappingURL=proof.d.ts.map