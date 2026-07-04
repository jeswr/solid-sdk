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
import { digestRdfContent } from "./digest.js";
import type { ProofSuite, ProofVerifyOptions, SuiteRegistry } from "./proof.js";
import { defaultSuiteRegistry } from "./proof.js";
import type {
  Credential,
  DataIntegrityProof,
  PresentedResourceContent,
  RelatedResource,
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
   * a DID document / WebID profile controller relationship — may be ASYNC (a
   * document-resolved check fetches the controller document): supply
   * `createWebIdKeyResolver().isControlledBy` for the fail-closed,
   * WebID-document-resolved check (runtime Phase-1 G4).
   */
  readonly isControlledBy?: (
    verificationMethod: string,
    issuer: string,
  ) => boolean | Promise<boolean>;
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
 * Validate + normalise a credential's `relatedResource` field FAIL-CLOSED before
 * the digest gate touches it. The value comes off an UNTRUSTED credential, so
 * the compile-time `readonly RelatedResource[]` type is not a runtime guarantee:
 * a hostile/malformed credential can carry `relatedResource: { … }` (a non-array
 * object — `.filter` would throw), `[null]` (a null entry — reading `.id` would
 * throw), or `[{}]` (an entry with no `id`). The verifier must REJECT such a
 * credential with a structured `MALFORMED` result, NEVER crash — a thrown
 * exception in the verify path is a fail-OPEN surface (the caller's try/catch,
 * if any, cannot distinguish "verifier bug" from "invalid credential").
 *
 * Returns the cleaned entries when every entry is a well-formed object with a
 * non-empty string `id`; otherwise a single `MALFORMED` error (and no entries).
 * A well-formed entry that merely LACKS `digestMultibase` is NOT malformed here
 * — it is a legitimate (unbound) entry that {@link checkPresentedResource}
 * rejects with `RELATED_RESOURCE_MISSING` only if that resource is presented.
 */
function normalizeRelatedResources(
  value: unknown,
): { entries: RelatedResource[] } | { error: VerificationError } {
  if (value === undefined) return { entries: [] };
  if (!Array.isArray(value)) {
    return {
      error: { code: "MALFORMED", message: "relatedResource must be an array when present" },
    };
  }
  const entries: RelatedResource[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return {
        error: { code: "MALFORMED", message: "relatedResource entry must be an object" },
      };
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry.id !== "string" || entry.id.length === 0) {
      return {
        error: {
          code: "MALFORMED",
          message: "relatedResource entry must carry a non-empty string id",
        },
      };
    }
    entries.push({
      id: entry.id,
      ...(typeof entry.digestMultibase === "string"
        ? { digestMultibase: entry.digestMultibase }
        : {}),
      ...(typeof entry.mediaType === "string" ? { mediaType: entry.mediaType } : {}),
    });
  }
  return { entries };
}

/**
 * Check ONE presented resource against the credential's signed
 * `relatedResource` digest bindings. Fail-closed in every branch:
 *
 *  - no `relatedResource` entry for the presented IRI → `RELATED_RESOURCE_MISSING`
 *    (the credential does not bind that resource's content — the exact
 *    "missing digest" fail-open G1 closes; a bare `svc:policy` IRI is not a binding);
 *  - an entry WITHOUT `digestMultibase` → `RELATED_RESOURCE_MISSING`;
 *  - unparseable / empty presented content → `RELATED_RESOURCE_MISMATCH` (content
 *    that cannot be canonicalized can never be the content the issuer digested);
 *  - recomputed digest ≠ ANY signed digest for that IRI (duplicate entries must
 *    ALL agree) → `RELATED_RESOURCE_MISMATCH`.
 *
 * The recomputation uses the SAME canonical construction as issuance
 * ({@link digestRdfContent}: parse → RDFC-1.0 canonical N-Quads → sha2-256 →
 * multibase multihash), so a reordered-but-isomorphic serialisation of the SAME
 * policy graph matches, while any semantic change rejects.
 */
async function checkPresentedResource(
  related: readonly RelatedResource[],
  iri: string,
  presented: PresentedResourceContent,
): Promise<VerificationError[]> {
  const entries = related.filter((r) => r.id === iri);
  if (entries.length === 0) {
    return [
      {
        code: "RELATED_RESOURCE_MISSING",
        message: `credential carries no relatedResource digest binding for presented resource ${iri}`,
      },
    ];
  }
  if (
    entries.some((r) => typeof r.digestMultibase !== "string" || r.digestMultibase.length === 0)
  ) {
    return [
      {
        code: "RELATED_RESOURCE_MISSING",
        message: `relatedResource entry for ${iri} carries no digestMultibase — an undigested entry binds nothing`,
      },
    ];
  }
  let recomputed: string;
  try {
    recomputed = await digestRdfContent(presented.content, presented.contentType ?? "text/turtle");
  } catch (e) {
    return [
      {
        code: "RELATED_RESOURCE_MISMATCH",
        message: `presented content for ${iri} could not be canonically digested: ${(e as Error).message}`,
      },
    ];
  }
  const mismatched = entries.filter((r) => r.digestMultibase !== recomputed);
  if (mismatched.length > 0) {
    return [
      {
        code: "RELATED_RESOURCE_MISMATCH",
        message: `digest of presented content for ${iri} (${recomputed}) does not match the signed digestMultibase — the presented resource is not the content the issuer bound`,
      },
    ];
  }
  return [];
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
export async function verifyRelatedResources(
  credential: Credential,
  presentedResources: Readonly<Record<string, PresentedResourceContent>>,
): Promise<VerificationResult> {
  // FAIL-CLOSED on a malformed relatedResource shape (non-array / null entry /
  // id-less entry) → a MALFORMED result, never a thrown crash.
  const normalized = normalizeRelatedResources(credential.relatedResource as unknown);
  if ("error" in normalized) {
    return { verified: false, errors: [normalized.error], issuer: credential.issuer };
  }
  const errors: VerificationError[] = [];
  for (const [iri, presented] of Object.entries(presentedResources)) {
    errors.push(...(await checkPresentedResource(normalized.entries, iri, presented)));
  }
  return errors.length === 0
    ? { verified: true, errors: [], issuer: credential.issuer }
    : { verified: false, errors, issuer: credential.issuer };
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

  // 9. presented related-resource content (the G1 policy-content binding):
  // every presented resource's canonical digest must match a signed
  // `relatedResource` digestMultibase — fail-closed on a missing binding, an
  // undigested entry, unparseable content, or a mismatch. Runs regardless of
  // the other gates' outcome so `errors` reports EVERY distinct failure; the
  // binding is only meaningful when the signature gates ALSO pass (the digest
  // lives in the signed graph), which the single `verified` conjunction enforces.
  if (options.presentedResources !== undefined) {
    // Normalise the UNTRUSTED relatedResource shape FAIL-CLOSED first — a
    // non-array / null-entry / id-less-entry credential becomes a MALFORMED
    // verification failure, never a thrown crash in the verify path.
    const normalized = normalizeRelatedResources(vc.relatedResource as unknown);
    if ("error" in normalized) {
      errors.push(normalized.error);
    } else {
      for (const [iri, presented] of Object.entries(options.presentedResources)) {
        errors.push(...(await checkPresentedResource(normalized.entries, iri, presented)));
      }
    }
  }

  // The canonical bytes the signature must cover: the claim graph WITHOUT proof.
  // credentialToRdf FAILS CLOSED (throws) on a malformed identity field (a
  // non-absolute issuer / subject id) — a legitimately-issued credential could never
  // have been signed over such a graph, so a VC that cannot be lowered is forged /
  // tampered. Map that throw to a MALFORMED error and skip signature checking, rather
  // than letting it escape: verifyCredential MUST NEVER throw on an invalid input.
  let documentQuads: ReturnType<typeof credentialToRdf> | undefined;
  try {
    documentQuads = credentialToRdf(unsigned(vc));
  } catch (e) {
    errors.push({
      code: "MALFORMED",
      message: `credential could not be lowered to its signed RDF: ${(e as Error).message}`,
    });
  }

  // 3–6: check EACH proof (a multi-proof credential must have every proof valid).
  // Skipped entirely when the claim graph could not be lowered (MALFORMED above).
  if (documentQuads !== undefined) {
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
      // 5. issuer binding (the check may be async — document-resolved G4)
      if (!(await controlledBy(proof.verificationMethod, issuer))) {
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
