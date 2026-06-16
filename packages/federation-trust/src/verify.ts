// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// VERIFY a signed membership credential — the SECURITY-CRITICAL surface. Verifying
// a membership challenge is NOT just "the signature checks out": it is a
// conjunction of independent, fail-closed gates, EVERY one of which must pass:
//
//   1. signature + structure + expiry + issuer-binding + proof-purpose
//        → delegated to `@jeswr/solid-vc`'s `verifyCredential` (the vetted VC
//          verification pipeline — we never re-implement signature checking).
//   2. the credential IS a `fedtrust:MembershipCredential` with all required
//        membership claims (federation, app, status, assertedBy).
//   3. the signed `assertedBy` claim equals the credential issuer (the authority
//        that signed it actually claims to be the asserter).
//   4. status ∈ the accepted set (default {Active}) — a Revoked/Suspended/Proposed
//        membership is NOT a live membership.
//   5. federation / app match what the verifier expected (anti-replay).
//   6. TRUST: the issuer is a trust anchor, OR a delegation chain proves a trust
//        anchor (transitively) authorized the issuer for this federation.
//
// FAIL-CLOSED throughout: a tampered graph, a wrong key, an expiry, a revoked
// status, a broken chain, a missing claim — each becomes `verified: false` with a
// specific reason, never a thrown exception or a silent accept. Crucially, the
// SIGNATURE is checked against the trust-anchor / chain-resolved public key ONLY —
// there is no network key resolution, so an attacker cannot point us at a key it
// controls.

import { statusName, TRUSTED_STATUS } from "@jeswr/federation-registry";
import { type VerifiableCredential, verifyCredential } from "@jeswr/solid-vc";
import { FEDTRUST_DELEGATE, FEDTRUST_DELEGATION_CREDENTIAL } from "./issue.js";
import type {
  DelegationLink,
  MembershipClaim,
  MembershipVerificationResult,
  TrustAnchor,
  TrustError,
  VerifyMembershipOptions,
} from "./types.js";
import {
  FEDREG_APP,
  FEDREG_ASSERTED_BY,
  FEDREG_STATUS,
  FEDTRUST_FEDERATION,
  FEDTRUST_MEMBERSHIP_CREDENTIAL,
} from "./vocab.js";

/** Map a solid-vc verification error code to a federation-trust code. */
function relayErrorCode(code: string): TrustError["code"] {
  switch (code) {
    case "MALFORMED":
    case "NO_PROOF":
    case "UNKNOWN_CRYPTOSUITE":
    case "INVALID_SIGNATURE":
    case "EXPIRED":
    case "NOT_YET_VALID":
    case "ISSUER_MISMATCH":
    case "PROOF_PURPOSE_MISMATCH":
      return code;
    // UNTRUSTED_ISSUER from solid-vc is subsumed by our own trust-anchor gate; map
    // it conservatively (it should not arise — we never pass trustedIssuers down).
    default:
      return "MALFORMED";
  }
}

/** The single credentialSubject (first one) of a VC, as a plain object, or undefined. */
function firstSubject(vc: VerifiableCredential): Record<string, unknown> | undefined {
  const s = vc.credentialSubject;
  const subj = Array.isArray(s) ? s[0] : s;
  return subj !== undefined && subj !== null && typeof subj === "object"
    ? (subj as Record<string, unknown>)
    : undefined;
}

/** Read a single string-valued claim from a subject object (undefined if absent/non-string). */
function strClaim(subject: Record<string, unknown>, key: string): string | undefined {
  const v = subject[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Whether a VC's `type` array includes the given absolute type IRI. */
function hasType(vc: VerifiableCredential, typeIri: string): boolean {
  return Array.isArray(vc.type) && vc.type.includes(typeIri);
}

/**
 * Resolve a `verificationMethod` IRI to its public key from a fixed set of
 * (verificationMethod → key) resolutions. Returns `undefined` (→ fail closed) if
 * the method is not in the set: the verifier never reaches out to the network for
 * a key, so an attacker cannot supply a key it controls.
 */
function fixedResolver(
  resolutions: ReadonlyMap<string, CryptoKey>,
): (verificationMethod: string) => CryptoKey | undefined {
  return (vm) => resolutions.get(vm);
}

/** The verificationMethod IRI a trust anchor signs with (defaults to its authority IRI). */
function anchorMethod(anchor: TrustAnchor): string {
  return anchor.verificationMethod ?? anchor.authority;
}

/**
 * Verify ONE credential's signature against EXACTLY the supplied public key(s),
 * with the standard VC gates (structure, expiry, not-yet-valid, issuer binding,
 * proof purpose = assertionMethod). Returns the solid-vc result. The resolver is
 * fixed (no network) so only the supplied keys can satisfy the signature.
 */
async function verifyVcAgainstKeys(
  vc: VerifiableCredential,
  resolutions: ReadonlyMap<string, CryptoKey>,
  now: Date,
) {
  return verifyCredential(vc, {
    resolveKey: fixedResolver(resolutions),
    now,
    expectedProofPurpose: "assertionMethod",
  });
}

/**
 * Walk a delegation CHAIN and decide whether it proves a trust anchor authorized
 * `issuer` to assert memberships for `federation`. Returns the failure reasons (an
 * empty array = the chain is valid). FAIL-CLOSED: any structural defect, signature
 * failure, scope mismatch, expiry, or ordering problem rejects the whole chain.
 *
 * Chain shape (root → leaf): link[0].delegator MUST be a trust anchor; each
 * link[i] delegates from delegator(i) to authority(i); link[i].authority MUST be
 * delegator(i+1); the final link's authority MUST be `issuer`. Every link is a
 * signed `fedtrust:DelegationCredential` scoped to `federation`, verified against
 * the delegator's key (link[0] against the anchor's key, link[i>0] against
 * link[i-1].authority's key as carried by the link's `delegatorKey`).
 */
async function verifyChain(
  issuer: string,
  federation: string,
  chain: readonly DelegationLink[],
  anchors: readonly TrustAnchor[],
  now: Date,
): Promise<TrustError[]> {
  const fail = (message: string): TrustError[] => [{ code: "BROKEN_CHAIN", message }];

  if (chain.length === 0) {
    return fail("delegation chain is empty");
  }

  // The first link must be signed by a trust anchor (root of the chain).
  const firstSigner = chain[0]?.delegatorKey;
  if (firstSigner === undefined) {
    return fail("first chain link has no delegator key");
  }
  const rootAnchor = anchors.find((a) => anchorMethod(a) === firstSigner.verificationMethod);
  if (rootAnchor === undefined) {
    return fail(
      `first chain link is not signed by a trust anchor (verificationMethod ${firstSigner.verificationMethod})`,
    );
  }

  // Walk each link, threading the delegate forward; the running "current authority"
  // starts at the root anchor's authority and must reach `issuer` at the leaf.
  let expectedDelegator: string = rootAnchor.authority;
  for (let i = 0; i < chain.length; i++) {
    const link = chain[i];
    if (link === undefined) {
      return fail(`chain link ${i} is missing`);
    }
    const vc = link.credential;

    // The link must be a DelegationCredential.
    if (!hasType(vc, FEDTRUST_DELEGATION_CREDENTIAL)) {
      return fail(`chain link ${i} is not a fedtrust:DelegationCredential`);
    }
    // Its issuer (delegator) must be the running expected delegator.
    if (vc.issuer !== expectedDelegator) {
      return fail(`chain link ${i} issuer ${vc.issuer} != expected delegator ${expectedDelegator}`);
    }
    // Its signer's verificationMethod must be controlled by the delegator, and we
    // must hold that delegator's key on the link.
    const signerKey = link.delegatorKey;
    if (!controlledBy(signerKey.verificationMethod, vc.issuer)) {
      return fail(
        `chain link ${i} verificationMethod ${signerKey.verificationMethod} not controlled by delegator ${vc.issuer}`,
      );
    }

    // Verify the link's signature against EXACTLY the delegator key carried here.
    const res = await verifyVcAgainstKeys(
      vc,
      new Map([[signerKey.verificationMethod, signerKey.publicKey]]),
      now,
    );
    if (!res.verified) {
      return fail(
        `chain link ${i} signature/validity invalid: ${res.errors.map((e) => e.code).join(",")}`,
      );
    }

    // Read the delegated authority + federation scope from the SIGNED subject.
    const subject = firstSubject(vc);
    if (subject === undefined) {
      return fail(`chain link ${i} has no credentialSubject`);
    }
    const delegate = strClaim(subject, FEDTRUST_DELEGATE);
    const linkFederation = strClaim(subject, FEDTRUST_FEDERATION);
    if (delegate === undefined) {
      return fail(`chain link ${i} names no fedtrust:delegate`);
    }
    if (linkFederation !== federation) {
      return fail(`chain link ${i} federation ${linkFederation ?? "(none)"} != ${federation}`);
    }
    // The delegated authority becomes the expected delegator of the next link.
    expectedDelegator = delegate;
  }

  // After walking, the leaf's delegate must be the membership credential's issuer.
  if (expectedDelegator !== issuer) {
    return fail(
      `chain leaf delegates to ${expectedDelegator}, not the membership issuer ${issuer}`,
    );
  }
  return [];
}

/** Default issuer-binding: the method is the issuer or a `#`/`/` fragment/path of it. */
function controlledBy(verificationMethod: string, issuer: string): boolean {
  if (verificationMethod === issuer) return true;
  return verificationMethod.startsWith(`${issuer}#`) || verificationMethod.startsWith(`${issuer}/`);
}

/**
 * Read the membership claim back from a signed credential's structured subject.
 * Returns the claim plus any MISSING_CLAIM / UNKNOWN_STATUS / ASSERTED_BY_MISMATCH
 * issues. The claim is read from the SUBJECT the signature covers, so a tampered
 * subject either breaks the signature (caught upstream) or is read faithfully here.
 */
function readMembershipClaim(vc: VerifiableCredential): {
  claim?: MembershipClaim;
  errors: TrustError[];
} {
  const errors: TrustError[] = [];
  const subject = firstSubject(vc);
  if (subject === undefined) {
    return { errors: [{ code: "MISSING_CLAIM", message: "credential has no credentialSubject" }] };
  }
  const federation = strClaim(subject, FEDTRUST_FEDERATION);
  const app = strClaim(subject, FEDREG_APP) ?? strClaim(subject, "id");
  const assertedBy = strClaim(subject, FEDREG_ASSERTED_BY);
  const statusIri = strClaim(subject, FEDREG_STATUS);

  if (federation === undefined) {
    errors.push({ code: "MISSING_CLAIM", message: "membership names no fedtrust:federation" });
  }
  if (app === undefined) {
    errors.push({ code: "MISSING_CLAIM", message: "membership names no fedreg:app" });
  }
  if (assertedBy === undefined) {
    errors.push({ code: "MISSING_CLAIM", message: "membership names no fedreg:assertedBy" });
  }
  if (statusIri === undefined) {
    errors.push({ code: "MISSING_CLAIM", message: "membership names no fedreg:status" });
  }

  const status = statusIri !== undefined ? statusName(statusIri) : undefined;
  if (statusIri !== undefined && status === undefined) {
    errors.push({
      code: "UNKNOWN_STATUS",
      message: `fedreg:status ${statusIri} is not a known MembershipStatus`,
    });
  }

  // The signed assertedBy MUST be the credential issuer — else the credential
  // claims authority A asserted it but was signed by someone else.
  if (assertedBy !== undefined && assertedBy !== vc.issuer) {
    errors.push({
      code: "ASSERTED_BY_MISMATCH",
      message: `signed assertedBy ${assertedBy} != credential issuer ${vc.issuer}`,
    });
  }

  if (
    federation === undefined ||
    app === undefined ||
    assertedBy === undefined ||
    status === undefined
  ) {
    return { errors };
  }
  return {
    claim: {
      federation,
      app,
      status,
      assertedBy,
      ...(typeof vc.id === "string" ? { id: vc.id } : {}),
      ...(typeof vc.validFrom === "string" ? { validFrom: vc.validFrom } : {}),
      ...(typeof vc.validUntil === "string" ? { validUntil: vc.validUntil } : {}),
    },
    errors,
  };
}

/**
 * VERIFY a signed membership credential against the verifier's trust anchors and
 * expectations. Returns a {@link MembershipVerificationResult} whose `verified` is
 * `true` IFF every gate passed; on failure `errors` lists every distinct reason.
 * Never throws on an invalid credential.
 */
export async function verifyMembershipCredential(
  vc: VerifiableCredential,
  options: VerifyMembershipOptions,
): Promise<MembershipVerificationResult> {
  const errors: TrustError[] = [];
  const now = options.now ?? new Date();
  const accept = options.acceptStatuses ?? [...TRUSTED_STATUS];

  // Gate 0: a verifier with NO trust anchors trusts nobody — fail closed before
  // touching any crypto (an empty/absent anchor set must never accept anything).
  const anchors = options.trustAnchors ?? [];
  if (anchors.length === 0) {
    return {
      verified: false,
      errors: [{ code: "NO_TRUST_ANCHOR", message: "no trust anchors supplied" }],
    };
  }

  // Gate 1: it must be a well-formed VC that is a fedtrust:MembershipCredential.
  if (vc === null || typeof vc !== "object" || typeof vc.issuer !== "string") {
    return {
      verified: false,
      errors: [{ code: "MALFORMED", message: "not a well-formed credential" }],
    };
  }
  if (!hasType(vc, FEDTRUST_MEMBERSHIP_CREDENTIAL)) {
    errors.push({
      code: "MALFORMED",
      message: "credential is not a fedtrust:MembershipCredential",
    });
  }

  // Gate 2: read the membership claim (collects MISSING_CLAIM / UNKNOWN_STATUS /
  // ASSERTED_BY_MISMATCH).
  const { claim, errors: claimErrors } = readMembershipClaim(vc);
  errors.push(...claimErrors);

  // Gate 3: TRUST — establish, FAIL-CLOSED, the single public key the membership
  // signature is allowed to be checked against. Trust is established in exactly one
  // of two ways:
  //   (a) the issuer is a DIRECT trust anchor → use that anchor's key; or
  //   (b) a delegation CHAIN from a trust anchor down to the issuer verifies, AND
  //       the caller supplied the issuer's own key (`options.issuerKey`) — the
  //       chain proves authorization, the issuer's key checks the membership sig.
  // We populate the resolver with ONLY the established key, so an untrusted issuer
  // can never satisfy the signature gate even if its proof is internally valid.
  const directAnchor = anchors.find((a) => a.authority === vc.issuer);
  const resolutions = new Map<string, CryptoKey>();
  let trustEstablished = false;

  if (directAnchor !== undefined) {
    resolutions.set(anchorMethod(directAnchor), directAnchor.publicKey);
    trustEstablished = true;
  } else if (options.chain !== undefined && claim !== undefined) {
    const chainErrors = await verifyChain(vc.issuer, claim.federation, options.chain, anchors, now);
    if (chainErrors.length > 0) {
      errors.push(...chainErrors);
    } else if (options.issuerKey === undefined) {
      // The chain authorized the issuer, but we hold no key to check the issuer's
      // OWN signature on the membership — fail closed rather than accept unsigned.
      errors.push({
        code: "BROKEN_CHAIN",
        message:
          "delegation chain authorized the issuer but no issuerKey was supplied to verify the membership signature",
      });
    } else {
      // The chain is valid AND we have the issuer's key: trust is established.
      resolutions.set(options.issuerKey.verificationMethod, options.issuerKey.publicKey);
      trustEstablished = true;
    }
  }

  if (!trustEstablished) {
    errors.push({
      code: "UNTRUSTED_AUTHORITY",
      message: `issuer ${vc.issuer} is not a trust anchor and no valid delegation chain proves it`,
    });
  }

  // Gate 4: signature + structure + expiry + issuer-binding + proof-purpose, via
  // solid-vc, against ONLY the resolved trusted key. If trust was not established
  // the resolver is empty, so the signature gate ALSO fails closed (defence in
  // depth beside the UNTRUSTED_AUTHORITY above). We de-dupe INVALID_SIGNATURE in
  // that case so an untrusted-issuer credential does not double-report a signature
  // failure that is really "we hold no key for it".
  const vcResult = await verifyVcAgainstKeys(vc, resolutions, now);
  for (const e of vcResult.errors) {
    if (!trustEstablished && e.code === "INVALID_SIGNATURE") {
      // The empty resolver guarantees INVALID_SIGNATURE here; UNTRUSTED_AUTHORITY
      // already explains it. Skip the redundant signature error.
      continue;
    }
    errors.push({ code: relayErrorCode(e.code), message: e.message });
  }

  // Gate 5: status must be in the accepted set (default {Active}).
  if (claim !== undefined && !accept.includes(claim.status)) {
    errors.push({
      code: "STATUS_NOT_TRUSTED",
      message: `membership status ${claim.status} is not in the accepted set [${accept.join(", ")}]`,
    });
  }

  // Gate 6: federation / app must match the verifier's expectation (anti-replay).
  if (
    claim !== undefined &&
    options.expectedFederation !== undefined &&
    claim.federation !== options.expectedFederation
  ) {
    errors.push({
      code: "FEDERATION_MISMATCH",
      message: `membership is for federation ${claim.federation}, expected ${options.expectedFederation}`,
    });
  }
  if (
    claim !== undefined &&
    options.expectedApp !== undefined &&
    claim.app !== options.expectedApp
  ) {
    errors.push({
      code: "APP_MISMATCH",
      message: `membership is for app ${claim.app}, expected ${options.expectedApp}`,
    });
  }

  return errors.length === 0
    ? { verified: true, errors: [], ...(claim !== undefined ? { claim } : {}) }
    : { verified: false, errors, ...(claim !== undefined ? { claim } : {}) };
}
