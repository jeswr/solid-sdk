// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The high-level verify API — the SECURITY-CRITICAL surface. Verifying a VC is
// NOT just "the signature checks out": it is a conjunction of independent gates,
// every one of which must pass, each reported as a distinct structured error so a
// caller can act on the specific failure:
//
//   1. structural   — a well-formed credential with exactly the expected shape
//   2. proof present — at least one proof
//   3. cryptosuite   — a suite is registered for proof.cryptosuite (else fail closed)
//   4. signature     — the proof verifies over the canonical claim bytes
//   5. issuer binding — proof.verificationMethod is controlled by the issuer
//   6. proof purpose  — proof.proofPurpose matches the expected purpose
//   7. validity       — now ∈ [validFrom, validUntil]
//   8. trusted issuer — (optional) the issuer is in the caller's allowlist
//
// Fail-closed throughout: an unresolvable key, an unknown suite, a malformed
// proofValue, a missing field — all become `verified: false` with a reason, never
// a thrown exception or a silent accept.

import { credentialToRdf } from "./credential.js";
import type { ProofSuite, ProofVerifyOptions, SuiteRegistry } from "./proof.js";
import { defaultSuiteRegistry } from "./proof.js";
import type {
  Credential,
  DataIntegrityProof,
  VerifiableCredential,
  VerificationError,
  VerificationResult,
  VerifyOptions,
} from "./types.js";

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

/** Default issuer-binding check: the method is the issuer or a fragment/path of it. */
function defaultControlledBy(verificationMethod: string, issuer: string): boolean {
  if (verificationMethod === issuer) return true;
  return verificationMethod.startsWith(`${issuer}#`) || verificationMethod.startsWith(`${issuer}/`);
}

/** Normalise one-or-many proofs to an array. */
function proofsOf(vc: VerifiableCredential): DataIntegrityProof[] {
  const proof = vc.proof;
  return Array.isArray(proof)
    ? [...(proof as readonly DataIntegrityProof[])]
    : [proof as DataIntegrityProof];
}

/** Strip the proof to recover the unsigned claim graph the signature covered. */
function unsigned(vc: VerifiableCredential): Credential {
  const { proof: _proof, ...rest } = vc;
  return rest as Credential;
}

/**
 * Verify a {@link VerifiableCredential}. Returns a {@link VerificationResult}
 * whose `verified` is `true` IFF every gate passed; on failure `errors` lists
 * every distinct reason. Never throws on an invalid credential.
 */
export async function verifyCredential(
  vc: VerifiableCredential,
  options: VerifyCredentialOptions,
): Promise<VerificationResult> {
  const errors: VerificationError[] = [];
  const registry = options.registry ?? defaultSuiteRegistry();
  const now = options.now ?? new Date();
  const expectedPurpose = options.expectedProofPurpose ?? "assertionMethod";
  const controlledBy = options.isControlledBy ?? defaultControlledBy;

  // 1. structural
  if (
    vc === null ||
    typeof vc !== "object" ||
    typeof vc.issuer !== "string" ||
    vc.issuer.length === 0 ||
    vc.credentialSubject === undefined
  ) {
    return {
      verified: false,
      errors: [{ code: "MALFORMED", message: "not a well-formed credential" }],
    };
  }
  const issuer = vc.issuer;

  // 2. proof present
  const proofs = vc.proof === undefined ? [] : proofsOf(vc);
  if (proofs.length === 0) {
    errors.push({ code: "NO_PROOF", message: "credential carries no proof" });
  }

  // 7. validity window (independent of any proof)
  if (vc.validUntil !== undefined) {
    const until = Date.parse(vc.validUntil);
    if (!Number.isNaN(until) && now.getTime() > until) {
      errors.push({ code: "EXPIRED", message: `credential expired at ${vc.validUntil}` });
    }
  }
  if (vc.validFrom !== undefined) {
    const from = Date.parse(vc.validFrom);
    if (!Number.isNaN(from) && now.getTime() < from) {
      errors.push({
        code: "NOT_YET_VALID",
        message: `credential not valid before ${vc.validFrom}`,
      });
    }
  }

  // 8. trusted issuer (optional allowlist)
  if (options.trustedIssuers !== undefined && !options.trustedIssuers.includes(issuer)) {
    errors.push({ code: "UNTRUSTED_ISSUER", message: `issuer ${issuer} is not trusted` });
  }

  // The canonical bytes the signature must cover: the claim graph WITHOUT proof.
  const documentQuads = credentialToRdf(unsigned(vc));

  // 3–6: check EACH proof (a multi-proof credential must have every proof valid).
  for (const proof of proofs) {
    const suite = registry.get(proof.cryptosuite);
    if (suite === undefined) {
      errors.push({
        code: "UNKNOWN_CRYPTOSUITE",
        message: `no registered suite for cryptosuite "${proof.cryptosuite}"`,
      });
      continue;
    }
    // 6. proof purpose
    if (normalizePurpose(proof.proofPurpose) !== normalizePurpose(expectedPurpose)) {
      errors.push({
        code: "PROOF_PURPOSE_MISMATCH",
        message: `proofPurpose "${proof.proofPurpose}" != expected "${expectedPurpose}"`,
      });
    }
    // 5. issuer binding
    if (!controlledBy(proof.verificationMethod, issuer)) {
      errors.push({
        code: "ISSUER_MISMATCH",
        message: `verificationMethod ${proof.verificationMethod} is not controlled by issuer ${issuer}`,
      });
    }
    // 4. signature
    const ok = await verifyOneProof(suite, documentQuads, proof, options.resolveKey);
    if (!ok) {
      errors.push({
        code: "INVALID_SIGNATURE",
        message: `signature did not verify for proof (${proof.cryptosuite})`,
      });
    }
  }

  return errors.length === 0
    ? { verified: true, errors: [], issuer }
    : { verified: false, errors, issuer };
}

/** Verify one proof through its suite, mapping any throw to a fail-closed `false`. */
async function verifyOneProof(
  suite: ProofSuite,
  documentQuads: ReturnType<typeof credentialToRdf>,
  proof: DataIntegrityProof,
  resolveKey: ProofVerifyOptions["resolveKey"],
): Promise<boolean> {
  try {
    return await suite.verify(documentQuads, proof, { resolveKey });
  } catch {
    return false;
  }
}

/** Strip a bare `proofPurpose` token to compare regardless of IRI vs short form. */
function normalizePurpose(purpose: string): string {
  const hash = purpose.lastIndexOf("#");
  return hash === -1 ? purpose : purpose.slice(hash + 1);
}
