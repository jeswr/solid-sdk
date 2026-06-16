// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The PLUGGABLE proof-suite seam (the load-bearing extension point of M4-VC) and
// the bundled concrete Data Integrity suite (EdDSA / ECDSA over RDFC-1.0).
//
// THE SEAM: a `ProofSuite` knows how to (a) produce a `proof` for a claim graph
// and (b) verify one. The issue/verify API (src/issue.ts, src/verify.ts) is suite
// AGNOSTIC — it dispatches on `proof.cryptosuite` through a `SuiteRegistry`. This
// is exactly the hook a JWT proof, a BBS Data Integrity suite, or — later — a
// SPARQ ZK-over-SPARQL proof suite plugs into WITHOUT touching the data model or
// the verify pipeline. The ZK CRYPTOGRAPHY itself lives in `@jeswr/sparq` (the
// SPARQ agent's domain); this package only owns the verification SEAM it plugs
// into (see the README "Pluggable proof suites" section + `examples/`).
//
// SECURITY: signature production/verification go through WebCrypto subtle and the
// vetted `rdf-canonize`; we never hand-roll a canonicaliser, a signature
// algorithm, or a hash. The signing pre-image binds the proof options (suite,
// verificationMethod, proofPurpose, created) AND the document — see
// src/canonicalize.ts.

import type { Quad } from "@rdfjs/types";
import { dataIntegrityHash } from "./canonicalize.js";
import { base58btcDecode, base58btcEncode } from "./multibase.js";
import type { DataIntegrityProof, KeyPair } from "./types.js";
import {
  DC_CREATED,
  SEC_CRYPTOSUITE,
  SEC_PROOF_PURPOSE,
  SEC_VERIFICATION_METHOD,
} from "./vocab.js";
import { GraphBuilder } from "./wrappers.js";

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
  verify(
    documentQuads: readonly Quad[],
    proof: DataIntegrityProof,
    options: ProofVerifyOptions,
  ): Promise<boolean>;
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
export class SuiteRegistry {
  private readonly suites = new Map<string, ProofSuite>();

  /** Register a suite (overwrites any prior suite with the same cryptosuite id). */
  register(suite: ProofSuite): this {
    this.suites.set(suite.cryptosuite, suite);
    return this;
  }

  /** The suite for a cryptosuite id, or `undefined` if none is registered. */
  get(cryptosuite: string): ProofSuite | undefined {
    return this.suites.get(cryptosuite);
  }

  /** Every registered cryptosuite id. */
  list(): string[] {
    return [...this.suites.keys()];
  }
}

// --- the proof-options pre-image ------------------------------------------

/**
 * The proof-options quads that are hashed alongside the document (Data Integrity
 * "proof configuration"). Binding these makes the proof non-malleable: the suite,
 * verification method, purpose and created time are all under the signature.
 *
 * The proof-options subject is a fresh blank node (the proof node itself, sans
 * `proofValue`), so the hashed config matches what a verifier reconstructs from
 * the proof minus its `proofValue`.
 */
export function proofOptionsQuads(proof: Omit<DataIntegrityProof, "proofValue">): Quad[] {
  const b = new GraphBuilder();
  const node = { kind: "blank", value: "_:proof" } as const;
  b.addType(node, "https://w3id.org/security#DataIntegrityProof");
  b.addLiteral(node, SEC_CRYPTOSUITE, proof.cryptosuite);
  b.addIri(node, SEC_VERIFICATION_METHOD, proof.verificationMethod);
  b.addIri(node, SEC_PROOF_PURPOSE, purposeIri(proof.proofPurpose));
  if (proof.created !== undefined) {
    b.addLiteral(node, DC_CREATED, proof.created, "http://www.w3.org/2001/XMLSchema#dateTime");
  }
  return b.quads();
}

/** Resolve a bare `proofPurpose` token (e.g. `assertionMethod`) to its sec: IRI. */
function purposeIri(purpose: string): string {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(purpose)
    ? purpose
    : `https://w3id.org/security#${purpose}`;
}

// --- the bundled concrete Data Integrity suite (EdDSA / ECDSA over RDFC) ---

/** The WebCrypto sign/verify params for a given cryptosuite. */
function algorithmFor(cryptosuite: string): AlgorithmIdentifier | EcdsaParams {
  switch (cryptosuite) {
    case "eddsa-rdfc-2022":
      return "Ed25519";
    case "ecdsa-rdfc-2019":
      return { name: "ECDSA", hash: "SHA-256" };
    default:
      throw new Error(`DataIntegritySuite: unsupported cryptosuite "${cryptosuite}"`);
  }
}

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
export class DataIntegritySuite implements ProofSuite {
  readonly cryptosuite: string;

  constructor(cryptosuite: "eddsa-rdfc-2022" | "ecdsa-rdfc-2019" = "eddsa-rdfc-2022") {
    this.cryptosuite = cryptosuite;
    // Validate eagerly so an unsupported id fails at construction, not at sign.
    algorithmFor(cryptosuite);
  }

  async sign(
    documentQuads: readonly Quad[],
    options: ProofSignOptions,
  ): Promise<DataIntegrityProof> {
    const key = options.key as KeyPair;
    if (key?.privateKey === undefined || key.verificationMethod === undefined) {
      throw new Error("DataIntegritySuite.sign: options.key must be a KeyPair");
    }
    const created = options.created.toISOString();
    const optionsNoValue: Omit<DataIntegrityProof, "proofValue"> = {
      type: "DataIntegrityProof",
      cryptosuite: this.cryptosuite,
      verificationMethod: key.verificationMethod,
      proofPurpose: options.proofPurpose,
      created,
    };
    const hash = await dataIntegrityHash(documentQuads, proofOptionsQuads(optionsNoValue));
    const algorithm = algorithmFor(this.cryptosuite);
    const signature = new Uint8Array(
      await crypto.subtle.sign(algorithm, key.privateKey, hash as unknown as BufferSource),
    );
    return { ...optionsNoValue, proofValue: base58btcEncode(signature) };
  }

  async verify(
    documentQuads: readonly Quad[],
    proof: DataIntegrityProof,
    options: ProofVerifyOptions,
  ): Promise<boolean> {
    // Fail closed on any structural mismatch BEFORE touching crypto.
    if (proof.type !== "DataIntegrityProof") return false;
    if (proof.cryptosuite !== this.cryptosuite) return false;
    const publicKey = await options.resolveKey(proof.verificationMethod);
    if (publicKey === undefined) return false;
    let signature: Uint8Array;
    try {
      signature = base58btcDecode(proof.proofValue);
    } catch {
      return false; // a malformed proofValue is an invalid proof, not a throw.
    }
    // Reconstruct the EXACT proof-options pre-image the signer hashed (proof minus
    // its proofValue) — so any tampering with suite/method/purpose/created breaks it.
    const optionsNoValue: Omit<DataIntegrityProof, "proofValue"> = {
      type: "DataIntegrityProof",
      cryptosuite: proof.cryptosuite,
      verificationMethod: proof.verificationMethod,
      proofPurpose: proof.proofPurpose,
      ...(proof.created !== undefined ? { created: proof.created } : {}),
    };
    const hash = await dataIntegrityHash(documentQuads, proofOptionsQuads(optionsNoValue));
    const algorithm = algorithmFor(this.cryptosuite);
    try {
      return await crypto.subtle.verify(
        algorithm,
        publicKey,
        signature as unknown as BufferSource,
        hash as unknown as BufferSource,
      );
    } catch {
      return false;
    }
  }
}

/**
 * A {@link SuiteRegistry} pre-populated with the bundled Data Integrity suites
 * (`eddsa-rdfc-2022` + `ecdsa-rdfc-2019`). The default the issue/verify entrypoints
 * use when a caller passes none. A caller `.register()`s a BBS / JWT / SPARQ-ZK
 * suite onto a (copy of a) registry to extend the accepted set.
 */
export function defaultSuiteRegistry(): SuiteRegistry {
  return new SuiteRegistry()
    .register(new DataIntegritySuite("eddsa-rdfc-2022"))
    .register(new DataIntegritySuite("ecdsa-rdfc-2019"));
}
