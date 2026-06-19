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
import { importPublicKey, type VerifiableCredential, verifyCredential } from "@jeswr/solid-vc";
import type { JWK } from "jose";
import type {
  DelegationLink,
  MembershipClaim,
  MembershipStatusName,
  MembershipVerificationResult,
  TrustAnchor,
  TrustError,
  VerifyMembershipOptions,
} from "./types.js";
import {
  FEDREG_APP,
  FEDREG_ASSERTED_BY,
  FEDREG_STATUS,
  FEDTRUST_DELEGATE,
  FEDTRUST_DELEGATE_KEY,
  FEDTRUST_DELEGATION_CREDENTIAL,
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
 * Safely extract a credential's (first) proof `verificationMethod` as a non-empty
 * string, or `undefined` for a missing / non-object / non-string-method proof.
 * FAIL-CLOSED hardening: an attacker-supplied malformed proof (`proof: null`,
 * `{ verificationMethod: 5 }`, …) must yield a structured rejection, never a throw.
 */
function proofVerificationMethod(vc: VerifiableCredential): string | undefined {
  const proof = Array.isArray(vc.proof) ? vc.proof[0] : vc.proof;
  if (proof === null || typeof proof !== "object") return undefined;
  const vm = (proof as { verificationMethod?: unknown }).verificationMethod;
  return typeof vm === "string" && vm.length > 0 ? vm : undefined;
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
): Promise<{ verified: boolean; errors: readonly { code: string; message: string }[] }> {
  try {
    return await verifyCredential(vc, {
      resolveKey: fixedResolver(resolutions),
      now,
      expectedProofPurpose: "assertionMethod",
    });
  } catch {
    // FAIL-CLOSED: a malformed proof (e.g. `proof: null`, a non-object proof) can
    // make the underlying pipeline throw; never let that escape — treat it as a
    // structurally invalid credential.
    return { verified: false, errors: [{ code: "MALFORMED", message: "malformed proof" }] };
  }
}

/** Import a delegate's public key from its embedded JWK-string claim (fail closed). */
async function importDelegateKey(jwkString: string): Promise<CryptoKey | undefined> {
  let jwk: JWK;
  try {
    jwk = JSON.parse(jwkString) as JWK;
  } catch {
    return undefined; // a malformed delegateKey claim is a broken link, not a throw.
  }
  if (jwk === null || typeof jwk !== "object") return undefined;
  try {
    return await importPublicKey(jwk);
  } catch {
    return undefined;
  }
}

/** The successful result of a chain walk: the issuer's resolved public key. */
interface ChainResult {
  /** Failure reasons; empty IFF the chain is valid. */
  readonly errors: TrustError[];
  /**
   * The leaf-delegated issuer's verification method + public key (the key the
   * chain proved belongs to the membership issuer). Present IFF `errors` is empty.
   */
  readonly issuerKey?: { verificationMethod: string; publicKey: CryptoKey };
}

/** Build a single-reason BROKEN_CHAIN result (the chain fails closed on the first defect). */
function brokenChain(message: string): ChainResult {
  return { errors: [{ code: "BROKEN_CHAIN", message }] };
}

/**
 * The threaded trust state carried from one delegation link to the next as the
 * chain is walked. It starts at the trust anchor (its pinned key) and, after each
 * verified link, advances to the delegate that link signed over.
 */
interface ChainState {
  /** The IRI the NEXT link's `issuer` (delegator) must equal. */
  readonly expectedDelegator: string;
  /** The verificationMethod the trusted key answers to (the anchor's, or the
   *  previous delegate's IRI). Carried so a failure message can name it. */
  readonly trustedMethod: string;
  /** The key the NEXT link's signature is checked against (never caller-supplied). */
  readonly trustedKey: CryptoKey;
}

/**
 * Verify ONE delegation link against the threaded trust state and return either a
 * fail-closed {@link ChainResult} (BROKEN_CHAIN) or the advanced {@link ChainState}
 * for the next link. The checks run in the SAME ORDER as the original inline loop
 * body, so the first-failing reason is identical:
 *   1. the link IS a fedtrust:DelegationCredential;
 *   2. its issuer equals the expected delegator (ordering / from-anchor);
 *   3. its proof verificationMethod is well-formed + controlled by the delegator;
 *   4. its signature verifies against EXACTLY the trusted key (no other key);
 *   5. it names a delegate, is scoped to `federation`, and carries a parseable
 *      signed delegateKey (self-certifying).
 * On success the delegate's SIGNED key becomes the next link's trusted key.
 */
async function verifyChainLink(
  index: number,
  link: DelegationLink,
  state: ChainState,
  federation: string,
  now: Date,
): Promise<ChainResult | { next: ChainState }> {
  const vc = link.credential;

  if (!hasType(vc, FEDTRUST_DELEGATION_CREDENTIAL)) {
    return brokenChain(`chain link ${index} is not a fedtrust:DelegationCredential`);
  }
  if (vc.issuer !== state.expectedDelegator) {
    return brokenChain(
      `chain link ${index} issuer ${vc.issuer} != expected delegator ${state.expectedDelegator}`,
    );
  }
  // The signing method must be a well-formed string controlled by the delegator AND
  // we resolve ONLY that method → the trusted key, so a link signed by any other key
  // fails closed. A malformed proof (null / non-string method) yields a structured
  // BROKEN_CHAIN, not a throw.
  const linkMethod = proofVerificationMethod(vc);
  if (linkMethod === undefined || !controlledBy(linkMethod, vc.issuer)) {
    return brokenChain(
      `chain link ${index} verificationMethod not controlled by delegator ${vc.issuer}`,
    );
  }

  // Verify the link's signature against EXACTLY the trusted key, resolved under the
  // proof's verificationMethod (so the pinned/previous key is what checks it).
  const res = await verifyVcAgainstKeys(vc, new Map([[linkMethod, state.trustedKey]]), now);
  if (!res.verified) {
    return brokenChain(
      `chain link ${index} signature/validity invalid against the trusted delegator key (${state.trustedMethod}): ${res.errors
        .map((e) => e.code)
        .join(",")}`,
    );
  }

  // Read the delegated authority, federation scope, and the delegate's signed public
  // key from the SIGNED subject.
  const subject = firstSubject(vc);
  if (subject === undefined) {
    return brokenChain(`chain link ${index} has no credentialSubject`);
  }
  const delegate = strClaim(subject, FEDTRUST_DELEGATE);
  const linkFederation = strClaim(subject, FEDTRUST_FEDERATION);
  const delegateKeyJwk = strClaim(subject, FEDTRUST_DELEGATE_KEY);
  if (delegate === undefined) {
    return brokenChain(`chain link ${index} names no fedtrust:delegate`);
  }
  if (linkFederation !== federation) {
    return brokenChain(
      `chain link ${index} federation ${linkFederation ?? "(none)"} != ${federation}`,
    );
  }
  if (delegateKeyJwk === undefined) {
    return brokenChain(
      `chain link ${index} carries no fedtrust:delegateKey (chain not self-certifying)`,
    );
  }
  const delegateKey = await importDelegateKey(delegateKeyJwk);
  if (delegateKey === undefined) {
    return brokenChain(`chain link ${index} has an unparseable fedtrust:delegateKey`);
  }

  // Advance: the delegate becomes the next link's delegator, and the delegate's
  // SIGNED key becomes the next link's trusted key (signed under the delegate's IRI).
  return {
    next: { expectedDelegator: delegate, trustedMethod: delegate, trustedKey: delegateKey },
  };
}

/**
 * Walk a delegation CHAIN and decide whether it proves a trust anchor authorized
 * `issuer` to assert memberships for `federation`. FAIL-CLOSED: any structural
 * defect, signature failure, scope mismatch, expiry, or ordering problem rejects
 * the whole chain.
 *
 * SELF-CERTIFYING (the property that closes the forgery bypass): the FIRST link is
 * verified with the trust anchor's PINNED public key — never a caller-supplied key
 * — so a presenter cannot forge a "from-anchor" delegation with their own key. Each
 * link embeds the delegate's public key as a SIGNED `fedtrust:delegateKey` claim,
 * so link[i+1] is verified with the key link[i] signed over. On success the leaf's
 * embedded key is returned as the membership ISSUER's key — the caller need supply
 * no intermediate or issuer keys at all.
 *
 * Chain shape (root → leaf): link[0].delegator MUST be a trust anchor; each link
 * delegates `delegator → delegate`; link[i].delegate MUST be link[i+1].delegator;
 * the final link's delegate MUST be `issuer`; every link is scoped to `federation`.
 * The per-link checks live in {@link verifyChainLink}; this walks the chain and
 * threads the trust state forward.
 */
async function verifyChain(
  issuer: string,
  federation: string,
  chain: readonly DelegationLink[],
  anchors: readonly TrustAnchor[],
  now: Date,
): Promise<ChainResult> {
  if (chain.length === 0) {
    return brokenChain("delegation chain is empty");
  }

  // The first link's issuer (delegator) must be a trust anchor; we verify it with
  // the anchor's PINNED key, NOT any key carried alongside the link.
  const rootVc = chain[0]?.credential;
  if (rootVc === undefined || typeof rootVc.issuer !== "string") {
    return brokenChain("first chain link is malformed");
  }
  const rootAnchor = anchors.find((a) => a.authority === rootVc.issuer);
  if (rootAnchor === undefined) {
    return brokenChain(`first chain link issuer ${rootVc.issuer} is not a trust anchor`);
  }

  // State starts at the anchor: its pinned key checks the first link's signature, and
  // the anchor's authority is the first link's expected delegator.
  let state: ChainState = {
    expectedDelegator: rootAnchor.authority,
    trustedMethod: anchorMethod(rootAnchor),
    trustedKey: rootAnchor.publicKey,
  };

  for (let i = 0; i < chain.length; i++) {
    const link = chain[i];
    if (link === undefined) {
      return brokenChain(`chain link ${i} is missing`);
    }
    const step = await verifyChainLink(i, link, state, federation, now);
    if ("errors" in step) {
      return step; // BROKEN_CHAIN — fail closed on the first defective link.
    }
    state = step.next;
  }

  // After walking, the leaf's delegate must be the membership credential's issuer.
  if (state.expectedDelegator !== issuer) {
    return brokenChain(
      `chain leaf delegates to ${state.expectedDelegator}, not the membership issuer ${issuer}`,
    );
  }
  // The leaf's signed delegate key IS the membership issuer's key — return it so the
  // membership signature is checked against a key the chain cryptographically proved.
  return {
    errors: [],
    issuerKey: { verificationMethod: state.trustedMethod, publicKey: state.trustedKey },
  };
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

/** The trust establishment (Gate 3) outcome: which key(s) may check the membership
 *  signature, whether trust was established at all, and any chain/binding errors. */
interface TrustEstablishment {
  /** The (verificationMethod → key) map the membership signature is checked against.
   *  EMPTY when trust was not established, so the signature gate fails closed too. */
  readonly resolutions: Map<string, CryptoKey>;
  /** `true` IFF the issuer is a direct anchor or a valid chain proved its key. */
  readonly trustEstablished: boolean;
  /** Chain / binding failures (BROKEN_CHAIN) collected while establishing trust. */
  readonly errors: TrustError[];
}

/**
 * Gate 3: TRUST — establish, FAIL-CLOSED, the single public key the membership
 * signature is allowed to be checked against. Trust is established in exactly one
 * of two ways:
 *   (a) the issuer is a DIRECT trust anchor → use that anchor's PINNED key; or
 *   (b) a delegation CHAIN from a trust anchor down to the issuer verifies — the
 *       chain is self-certifying (root verified with the anchor's pinned key, each
 *       link carrying the next delegate's signed key), and its leaf yields the
 *       issuer's CRYPTOGRAPHICALLY-PROVEN key. No caller-supplied key is trusted: a
 *       presenter cannot forge a link with a key of their choosing.
 * The membership proof's verificationMethod must be controlled by the issuer, and
 * the returned map resolves ONLY that method → the established key, so an untrusted
 * issuer can never satisfy the signature gate even if its proof is internally valid.
 *
 * Extracted verbatim from the verify pipeline (no behaviour change): same two-way
 * trust, same controlledBy guards, same BROKEN_CHAIN messages, same fail-closed
 * empty resolver when neither path establishes trust.
 */
async function establishTrust(
  vc: VerifiableCredential & { issuer: string },
  claim: MembershipClaim | undefined,
  anchors: readonly TrustAnchor[],
  chain: readonly DelegationLink[] | undefined,
  now: Date,
): Promise<TrustEstablishment> {
  const errors: TrustError[] = [];
  const resolutions = new Map<string, CryptoKey>();
  const directAnchor = anchors.find((a) => a.authority === vc.issuer);
  // Safely extracted (string | undefined) — a malformed proof yields undefined, so
  // the controlledBy guards below treat it as untrusted rather than throwing.
  const membershipMethod = proofVerificationMethod(vc);

  if (directAnchor !== undefined) {
    // Resolve the anchor's pinned key under the membership proof's own method (when
    // that method is controlled by the issuer) — so the anchor's key checks the sig
    // regardless of whether the anchor was registered by WebID or by key id.
    resolutions.set(anchorMethod(directAnchor), directAnchor.publicKey);
    if (membershipMethod !== undefined && controlledBy(membershipMethod, vc.issuer)) {
      resolutions.set(membershipMethod, directAnchor.publicKey);
    }
    return { resolutions, trustEstablished: true, errors };
  }

  if (chain !== undefined && claim !== undefined) {
    const chainResult = await verifyChain(vc.issuer, claim.federation, chain, anchors, now);
    if (chainResult.errors.length > 0) {
      errors.push(...chainResult.errors);
    } else if (chainResult.issuerKey !== undefined) {
      // The chain cryptographically proved the issuer's key. Bind it to the
      // membership proof's method (only if that method is controlled by the issuer).
      if (membershipMethod !== undefined && controlledBy(membershipMethod, vc.issuer)) {
        resolutions.set(membershipMethod, chainResult.issuerKey.publicKey);
        return { resolutions, trustEstablished: true, errors };
      }
      errors.push({
        code: "BROKEN_CHAIN",
        message: `membership proof verificationMethod ${membershipMethod ?? "(none)"} is not controlled by the chain-proven issuer ${vc.issuer}`,
      });
    }
  }

  return { resolutions, trustEstablished: false, errors };
}

/**
 * Gates 5 & 6: the membership's status must be in the accepted set (default
 * {Active}) and, when the verifier pins them, the federation / app must match
 * (anti-replay). Pure: same checks, same STATUS_NOT_TRUSTED / FEDERATION_MISMATCH /
 * APP_MISMATCH codes and messages as the inline gates they replace.
 */
function checkClaimExpectations(
  claim: MembershipClaim,
  accept: readonly MembershipStatusName[],
  options: VerifyMembershipOptions,
): TrustError[] {
  const errors: TrustError[] = [];
  if (!accept.includes(claim.status)) {
    errors.push({
      code: "STATUS_NOT_TRUSTED",
      message: `membership status ${claim.status} is not in the accepted set [${accept.join(", ")}]`,
    });
  }
  if (options.expectedFederation !== undefined && claim.federation !== options.expectedFederation) {
    errors.push({
      code: "FEDERATION_MISMATCH",
      message: `membership is for federation ${claim.federation}, expected ${options.expectedFederation}`,
    });
  }
  if (options.expectedApp !== undefined && claim.app !== options.expectedApp) {
    errors.push({
      code: "APP_MISMATCH",
      message: `membership is for app ${claim.app}, expected ${options.expectedApp}`,
    });
  }
  return errors;
}

/**
 * VERIFY a signed membership credential against the verifier's trust anchors and
 * expectations. Returns a {@link MembershipVerificationResult} whose `verified` is
 * `true` IFF every gate passed; on failure `errors` lists every distinct reason.
 * Never throws on an invalid credential.
 *
 * The gates run in order; each appends its distinct failure reason(s) so the result
 * reports EVERY way the credential failed, never just the first:
 *   0. trust anchors present                    → NO_TRUST_ANCHOR (early return)
 *   1. well-formed VC + MembershipCredential     → MALFORMED
 *   2. {@link readMembershipClaim}               → MISSING_CLAIM / UNKNOWN_STATUS / ASSERTED_BY_MISMATCH
 *   3. {@link establishTrust}                    → BROKEN_CHAIN / UNTRUSTED_AUTHORITY
 *   4. signature (solid-vc, against the trusted key only)
 *   5/6. {@link checkClaimExpectations}          → STATUS_NOT_TRUSTED / FEDERATION_MISMATCH / APP_MISMATCH
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

  // Gate 3: TRUST — which single key may check the membership signature (direct
  // anchor or self-certifying chain), fail-closed (empty resolver) otherwise.
  const trust = await establishTrust(vc, claim, anchors, options.chain, now);
  errors.push(...trust.errors);
  if (!trust.trustEstablished) {
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
  const vcResult = await verifyVcAgainstKeys(vc, trust.resolutions, now);
  for (const e of vcResult.errors) {
    if (!trust.trustEstablished && e.code === "INVALID_SIGNATURE") {
      // The empty resolver guarantees INVALID_SIGNATURE here; UNTRUSTED_AUTHORITY
      // already explains it. Skip the redundant signature error.
      continue;
    }
    errors.push({ code: relayErrorCode(e.code), message: e.message });
  }

  // Gates 5 & 6: status must be in the accepted set (default {Active}) and the
  // federation / app must match the verifier's expectation (anti-replay).
  if (claim !== undefined) {
    errors.push(...checkClaimExpectations(claim, accept, options));
  }

  return errors.length === 0
    ? { verified: true, errors: [], ...(claim !== undefined ? { claim } : {}) }
    : { verified: false, errors, ...(claim !== undefined ? { claim } : {}) };
}
