// AUTHORED-BY Claude Fable 5
// AUTHORED-BY Codex GPT-6
//
// ===========================================================================
//  The composed FOUR-PHASE agent-authorization chain verifier.
// ===========================================================================
//
// Extracted (semantics unchanged) from `@jeswr/accountable-agent-runtime`
// `src/chain-verifier/` @ 72ec20a — the runtime's design (decision D2) built it
// runtime-local first and named THIS package, `@jeswr/agent-authz-verifier`, as
// its extraction target once a second consumer exists. It is the consumable,
// independently-checkable keystone of the accountability stack: neither
// `@jeswr/solid-vc` nor `@jeswr/solid-odrl` owns the composition alone, by design.
//
// PURITY CONTRACT (load-bearing): this package does ZERO I/O. All network enters
// through the INJECTED seams — {@link VerifyAuthorityOptions.resolveKey} /
// `isControlledBy` / `resolveStatus` — and all RDF/crypto mechanics live in the
// composed packages (`solid-vc` verifies credentials + digests; `solid-odrl`
// parses the signed policy content and walks the delegation chain). The only RDF
// this package reads is the presented policy content, through those packages.
// A second, independent implementation reproduces exactly this composition.
//
// It composes, IN ORDER and FAIL-CLOSED, as TWO PASSES over the ordered chain:
//   assembly — extract each credential's bound policy, order the chain root-first
//              by `odrld:delegatedUnder`; reject cycles / branches / gaps.
//   Pass 1 (Phase A, ALL hops) — `solid-vc.verifyCredential` on EVERY credential
//              at ONE instant (`now`): signature, cryptosuite, validity window,
//              proof purpose. Proof-layer only — Pass 1 runs for the WHOLE chain
//              before any Phase-B/C gate, so a later hop's bad proof is always
//              reported over an earlier hop's Phase-B code.
//   Pass 2 (per hop, only if every hop passed Phase A) —
//     Phase B  — cross-binding: each hop's credential is issued by that hop's
//              `odrl:assigner` (the SUBJECT-ISSUER gate: a subject id differing
//              from the proof-verified issuer → `SUBJECT_ISSUER_MISMATCH`); the
//              delegate it authorizes is the NEXT hop's assigner; the ROOT
//              credential's issuer is the trusted root principal for the target.
//              Plus the G1 policy-content digest gate (`verifyRelatedResources`
//              over `policyContents`): the presented raw policy document must
//              match the credential's SIGNED `relatedResource` digest,
//              fail-closed (a digest failure → a `POLICY_INTEGRITY` deny). The
//              policy Phase D evaluates is the one PARSED from that signed
//              content, and only when its projection re-serialises to exactly
//              the signed graph; the presenter's object is never evaluated for a
//              content-bound hop. A hop without content denies unless the caller
//              opts in with `allowProvisionalPolicy`.
//   Phase C  — status ∪ revocation, fail-closed: each hop credential's W3C
//              Bitstring Status List entry is resolved through solid-vc's
//              `resolveStatus` seam — a set bit → `REVOKED`/`SUSPENDED`; an
//              unconfirmable entry, OR an entry present with NO resolver supplied,
//              → `STATUS_RETRIEVAL_ERROR` (the note's "retrieval failure must
//              deny"). Additionally any chain policy in the `odrld:Revocation`
//              revoked set (the delegation profile's POLICY-level mechanism) → deny.
//   Phase D  — `solid-odrl.evaluateDelegated` over the ordered chain:
//              in-scope intersection, unexpired, unrevoked, depth-bounded, acyclic.
//
// Plus the D9 IDENTITY-COMPOSITION rule: Phase D always runs with the requesting
// agent pinned to the LEAF ASSIGNEE `p` (legal accountability attaches to the
// party the leaf agreement names). An authenticated actor `w ≠ p` is accepted ONLY
// via a SECOND four-phase-verified chain whose trusted root principal IS `p` and
// which permits `w` the requested action — forbidding the fail-open of skipping the
// leaf-assignee check (the roborev round-1 finding this design was hardened against).

import { parseRdf } from "@jeswr/fetch-rdf";
import type {
  ActiveDuty,
  DelegatedEvaluationResult,
  OdrlConstraint,
  OdrlPolicy,
  RequestContext,
} from "@jeswr/solid-odrl";
import {
  DEFAULT_MAX_CHAIN_LENGTH,
  evaluate,
  evaluateDelegated,
  ODRL_ACTIONS,
  parsePolicy,
  policyToRdf,
} from "@jeswr/solid-odrl";
import type {
  PresentedResourceContent,
  VerifiableCredential,
  VerifyCredentialOptions,
} from "@jeswr/solid-vc";
import { digestQuads, SVC, verifyCredential, verifyRelatedResources } from "@jeswr/solid-vc";
import {
  PHASE_A_CODES,
  STATUS_GATE_CODES,
  type VerifierErrorCode,
  type VerifierPhase,
} from "./errors.js";

// solid-vc's phase-1 migration accepts canonical terms but still issues legacy
// terms for pinned verifiers. Read both without rewriting the signed preimage.
const AUTHORIZATION_NAMESPACES = ["https://w3id.org/jeswr/solid-vc#", SVC] as const;

/** The bound agent-authorization claim read from an AgentAuthorizationCredential. */
export interface BoundAuthorization {
  /**
   * The delegating principal — ALWAYS the PROOF-VERIFIED `vc.issuer`, NEVER the
   * self-asserted `credentialSubject.id`. `verifyCredential` proves the signature
   * against `issuer` + key control but does NOT constrain the subject id, so
   * trusting `subject.id` here would let an attacker with their own valid issuer
   * impersonate any assigner/root (a chain-of-trust bypass). The verifier
   * additionally enforces `subject.id === issuer` fail-closed
   * (`SUBJECT_ISSUER_MISMATCH`).
   */
  readonly principal: string;
  /** The delegate the credential authorizes (`svc:authorizes`). */
  readonly authorizes: string;
  /** The authorized action(s) (`svc:action`). */
  readonly action: readonly string[];
  /** The authorized target (`svc:target`), if any. */
  readonly target?: string;
  /** The bound ODRL policy IRI (`svc:policy`) — the hop this credential covers. */
  readonly policy?: string;
}

/**
 * A presented delegation chain: the AgentAuthorizationCredentials (any order), the
 * ODRL policies they bind, and — the G1 policy-content binding — the RAW policy
 * documents, keyed by the policy IRI each credential binds (`svc:policy`).
 *
 * `policyContents` MUST be the raw FETCHED document bytes (Turtle by default), NOT a
 * re-serialisation of the parsed {@link OdrlPolicy} — a lossy parse→re-emit can drop
 * triples the issuer signed over, silently breaking (or, worse, laundering) the
 * digest. When a hop's content is present, the Pass-2 G1 gate
 * (`verifyRelatedResources`) recomputes its RDFC-1.0 canonical digest and
 * compares it against the credential's SIGNED
 * `relatedResource` `digestMultibase`, fail-closed (`POLICY_INTEGRITY` deny on a
 * missing digest or a mismatch). The verifier then parses the policy from that
 * content and evaluates THAT policy: the presented {@link OdrlPolicy} object for a
 * content-bound hop only places the hop in the chain (its id and
 * `delegatedUnder` must agree with the signed content). The parsed policy must
 * re-serialise to exactly the signed graph, so signed statements the evaluator
 * cannot represent deny rather than being dropped. Content must be Turtle,
 * N-Triples/N-Quads/TriG, or JSON-LD with an inline context.
 *
 * When every hop's content is presented and passes, the permit's
 * `policyIntegrityProvisional` is `false`. A hop presented WITHOUT content denies
 * with `POLICY_INTEGRITY` unless {@link VerifyAuthorityOptions.allowProvisionalPolicy}
 * is set, in which case Phase D evaluates the presenter's object for that hop and
 * the permit carries the provisional marker.
 */
export interface PresentedChain {
  readonly credentials: readonly VerifiableCredential[];
  readonly policies: readonly OdrlPolicy[];
  /** RAW fetched policy-document content by policy IRI (the G1 digest gate input). */
  readonly policyContents?: Readonly<Record<string, PresentedResourceContent>>;
}

/** Options for {@link verifyAgentAuthority}. */
export interface VerifyAuthorityOptions {
  /** The request context (action / target / constraint attributes like purpose+time). */
  readonly request: RequestContext;
  /** The trusted root principal for the target — the resource owner for the primary chain. */
  readonly rootPrincipal: string;
  /**
   * The single evaluation instant across all phases (the note's one-instant rule).
   * Must be a valid `Date`; anything else denies with `INVALID_OPTIONS`.
   */
  readonly now: Date;
  /**
   * Resolve a `verificationMethod` IRI to a public `CryptoKey` — the INJECTED key
   * seam (all key I/O lives behind it). Pass solid-vc's
   * `createWebIdKeyResolver().resolveKey` for the fail-closed WebID-document
   * resolution, or any in-memory resolver in a closed setup.
   */
  readonly resolveKey: VerifyCredentialOptions["resolveKey"];
  /**
   * The issuer↔key controller check — the INJECTED controller seam: pass the SAME
   * `createWebIdKeyResolver()` instance's `isControlledBy` for the fail-closed
   * two-directional document resolution. Required: solid-vc's fallback prefix
   * heuristic lets a co-tenant on the issuer's origin pass a key as the issuer's,
   * so a missing seam denies with `INVALID_OPTIONS`.
   */
  readonly isControlledBy: NonNullable<VerifyCredentialOptions["isControlledBy"]>;
  /**
   * Accept a hop presented WITHOUT its raw policy content
   * ({@link PresentedChain.policyContents}), evaluating the presenter's policy
   * object for it. Off by default: such a hop denies with `POLICY_INTEGRITY`,
   * because nothing ties the object to what the issuer signed. When set, a permit
   * that rests on such a hop carries `policyIntegrityProvisional: true`.
   */
  readonly allowProvisionalPolicy?: boolean;
  /**
   * Phase C, the POLICY-level revocation input: policy IRIs revoked via the
   * delegation profile's `odrld:Revocation` (e.g. published in a trace's
   * `revocations.ttl`). Distinct from — and consulted IN ADDITION TO — the
   * credential-level Bitstring status gate (`resolveStatus`). A single string or a
   * `Set` is read as a list; any other non-array value denies.
   */
  readonly revoked?: readonly string[];
  /**
   * Phase C, the CREDENTIAL-level status gate — the INJECTED status seam:
   * solid-vc's `resolveStatus` shape. Pass `createBitstringStatusResolver(…)` and
   * every hop credential's W3C Bitstring Status List entry is fetched
   * (SSRF-guarded, redirects refused, byte-bounded), ITS OWN signature verified,
   * and the bit read. FAIL-CLOSED end to end:
   *  - a set bit → the Phase-C `REVOKED` / `SUSPENDED` deny;
   *  - an entry that cannot be confirmed → `STATUS_RETRIEVAL_ERROR`;
   *  - a hop credential that CARRIES a `credentialStatus` entry while this
   *    option is ABSENT → `STATUS_RETRIEVAL_ERROR` (a status mechanism nobody
   *    checked must never read as "not revoked");
   *  - only a credential with NO `credentialStatus` passes without the gate.
   */
  readonly resolveStatus?: VerifyCredentialOptions["resolveStatus"];
  /**
   * Phase C fail-closed hook: an EXTERNAL status/revocation source that could not
   * be retrieved (e.g. a published revocation list failed to load). When `true`,
   * the verifier denies with `STATUS_RETRIEVAL_ERROR` (the note's "retrieval
   * failure must deny"). The Bitstring gate reports its own retrieval failures
   * through `resolveStatus` — this flag is for sources OUTSIDE the verifier.
   */
  readonly statusUnreachable?: boolean;
  /** Gate the permit on the AGGREGATE chain duties being discharged (Phase D). */
  readonly requireDuties?: boolean;
  /**
   * Absolute chain-length cap (default 8), applied to the presented policies and
   * credentials before any key is resolved, and again in Phase D. Must be a
   * positive integer.
   */
  readonly maxChainLength?: number;
  /** The AUTHENTICATED acting WebID on the wire (D9 identity composition). */
  readonly actor?: string;
  /**
   * The SECOND chain (D9) rooted at the leaf assignee, authorizing `actor` — required
   * when `actor` differs from the primary chain's leaf assignee. Its trusted root
   * principal MUST equal that leaf assignee (composition rule: chain₂.root ≡ chain₁.leaf).
   */
  readonly actorChain?: PresentedChain;
  /**
   * When set, the chain's leaf assignee MUST equal this WebID (else deny in Phase B).
   * Used by the D9 identity composition to PIN the second chain's leaf assignee to the
   * authenticated `actor` — without it, a second chain rooted correctly but authorizing
   * some OTHER party would be wrongly accepted for `actor` (Phase D pins the request to
   * the chain's own leaf assignee, so the actor identity must be checked explicitly).
   */
  readonly requireLeafAssignee?: string;
}

/** The result of a four-phase verification. */
export interface VerifyAuthorityResult {
  /** `true` only when every phase (and, when applicable, the second chain) passed. */
  readonly authorized: boolean;
  /** The phase the result was decided in. */
  readonly phase: VerifierPhase;
  /** The deny code (absent on an authorize). */
  readonly code?: VerifierErrorCode;
  /** Human/agent-readable reason. */
  readonly reason: string;
  /** The chain's policy IRIs, ordered root-first (as far as assembly reached). */
  readonly chainPolicyIds: readonly string[];
  /** The Phase-D delegation decision (present once the chain reached Phase D). */
  readonly decision?: DelegatedEvaluationResult;
  /** The second-chain verification result (D9), when identity composition ran. */
  readonly actorResult?: VerifyAuthorityResult;
  /** The aggregate duties the permit is contingent on. */
  readonly duties: readonly ActiveDuty[];
  /**
   * `true` when the permit (still) rests on a trusted-by-location policy binding
   * for at least one hop — i.e. that hop's raw policy content was NOT presented in
   * {@link PresentedChain.policyContents}, so its signed `relatedResource` digest
   * (if any) could not be checked. `false` IFF every hop of this chain AND of the
   * identity-composition chain (when one ran) passed the G1 content-digest gate.
   */
  readonly policyIntegrityProvisional: boolean;
}

// --- reading the bound authorization from a credential ---------------------

/** Only a single subject record is supported; never ignore signed subjects. */
function subjectRecord(vc: VerifiableCredential): Record<string, unknown> | undefined {
  if (Array.isArray(vc.credentialSubject) && vc.credentialSubject.length !== 1) return undefined;
  const subject = Array.isArray(vc.credentialSubject)
    ? vc.credentialSubject[0]
    : vc.credentialSubject;
  return subject && typeof subject === "object" && !Array.isArray(subject)
    ? (subject as Record<string, unknown>)
    : undefined;
}

/** Coerce a claim value to a string, or `undefined`. */
function claimString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Match credentialToRdf's expansion: bare names and explicit legacy keys share
 * one predicate. Normalize each predicate's set separately, then require aliases
 * to agree. Unioning different namespace predicates would widen the grant.
 */
function authorizationClaimValues(
  subject: Record<string, unknown>,
  claim: string,
): string[] | undefined {
  let values: Set<string> | undefined;
  for (const namespace of AUTHORIZATION_NAMESPACES) {
    const keys =
      namespace === AUTHORIZATION_NAMESPACES[0]
        ? [`${namespace}${claim}`, claim]
        : [`${namespace}${claim}`];
    const alias = new Set<string>();
    let present = false;
    for (const key of keys) {
      // credentialToRdf signs own enumerable claims, never prototype properties.
      if (!Object.prototype.propertyIsEnumerable.call(subject, key)) continue;
      const value = subject[key];
      if (value === undefined) continue;
      present = true;
      const strings = typeof value === "string" ? [value] : value;
      if (!Array.isArray(strings) || strings.some((v) => typeof v !== "string")) return undefined;
      for (const v of strings) alias.add(v);
    }
    if (!present) continue;
    if (
      values !== undefined &&
      (values.size !== alias.size || [...values].some((v) => !alias.has(v)))
    )
      return undefined;
    values ??= alias;
  }
  return [...(values ?? [])];
}

/**
 * Read the AgentAuthorizationCredential's bound claim from its subject graph. The
 * delegating `principal` is the PROOF-VERIFIED `vc.issuer` — never the
 * self-asserted `credentialSubject.id` (see {@link BoundAuthorization.principal}
 * for why trusting the subject id would be a chain-of-trust bypass). The subject
 * carries the grant fields `svc:authorizes` / `svc:action` / `svc:target` /
 * `svc:policy` in either namespace. Identical singleton aliases are accepted;
 * conflicting authorizes/target/policy values are rejected. Action aliases must
 * describe equal sets. Bare names expand to the legacy namespace, as
 * in the signed graph. Multiple subject records are unsupported and rejected.
 * NOTE this is a pure reader — it does NOT verify the proof; the
 * verifier runs Phase A (`verifyCredential`) and the `subject.id === issuer`
 * fail-closed check before any of these fields are trusted.
 */
export function readBoundAuthorization(vc: VerifiableCredential): BoundAuthorization | undefined {
  // Presented credentials reach this reader before Phase A; malformed input fails closed.
  const types: unknown = vc.type ?? [];
  if (
    !Array.isArray(types) ||
    !types.some(
      (type) =>
        type === "AgentAuthorizationCredential" ||
        AUTHORIZATION_NAMESPACES.some(
          (namespace) => type === `${namespace}AgentAuthorizationCredential`,
        ),
    )
  ) {
    return undefined;
  }
  const subject = subjectRecord(vc);
  if (subject === undefined || typeof vc.issuer !== "string") {
    return undefined;
  }
  const authorizesValues = authorizationClaimValues(subject, "authorizes");
  const action = authorizationClaimValues(subject, "action");
  const targetValues = authorizationClaimValues(subject, "target");
  const policyValues = authorizationClaimValues(subject, "policy");
  if (
    authorizesValues?.length !== 1 ||
    action === undefined ||
    targetValues === undefined ||
    targetValues.length > 1 ||
    policyValues === undefined ||
    policyValues.length > 1
  )
    return undefined;
  const authorizes = authorizesValues[0];
  if (authorizes === undefined) return undefined;
  // SECURITY: the delegating principal is the proof-anchored issuer, NOT subject.id.
  const principal = vc.issuer;
  const target = targetValues[0];
  const policy = policyValues[0];
  return {
    principal,
    authorizes,
    action,
    ...(target !== undefined && { target }),
    ...(policy !== undefined && { policy }),
  };
}

// --- assembly: order the chain root-first ----------------------------------

interface AssembledChain {
  readonly ordered: readonly OdrlPolicy[];
}

/**
 * Order the policies root-first by `odrld:delegatedUnder`, fail-closed on any
 * anomaly: duplicate ids, missing ids, ≠1 root, a branch (a policy delegated-under
 * by more than one child), a cycle, or a gap (a disconnected policy).
 */
function assembleChain(policies: readonly OdrlPolicy[]): AssembledChain | { error: string } {
  if (policies.length === 0) {
    return { error: "no policies presented — nothing to assemble." };
  }
  const byId = new Map<string, OdrlPolicy>();
  for (const p of policies) {
    if (p.id === undefined || p.id === "") {
      return { error: "a presented policy has no id." };
    }
    if (byId.has(p.id)) {
      return { error: `duplicate policy id <${p.id}>.` };
    }
    byId.set(p.id, p);
  }
  // Roots: no delegatedUnder (or a delegatedUnder pointing outside the set is a gap).
  const roots = policies.filter((p) => p.delegatedUnder === undefined);
  for (const p of policies) {
    if (p.delegatedUnder !== undefined && !byId.has(p.delegatedUnder)) {
      return {
        error: `policy <${p.id}> is delegatedUnder <${p.delegatedUnder}>, which is not present (gap).`,
      };
    }
  }
  if (roots.length !== 1) {
    return {
      error: `expected exactly one root (a policy with no delegatedUnder); found ${roots.length}.`,
    };
  }
  // Children index — a policy delegated-under by more than one child is a branch.
  const childrenByParent = new Map<string, OdrlPolicy[]>();
  for (const p of policies) {
    if (p.delegatedUnder !== undefined) {
      const list = childrenByParent.get(p.delegatedUnder) ?? [];
      list.push(p);
      childrenByParent.set(p.delegatedUnder, list);
    }
  }
  for (const [parent, children] of childrenByParent) {
    if (children.length > 1) {
      return {
        error: `policy <${parent}> is delegated-under by ${children.length} children (a branch, not a linear chain).`,
      };
    }
  }
  // Walk root → single child, detecting cycles, until exhausted. Cursor by id
  // (a string) so the loop carries no self-referential policy type.
  const ordered: OdrlPolicy[] = [];
  const visited = new Set<string>();
  // biome-ignore lint/style/noNonNullAssertion: roots.length === 1 + ids validated
  let cursor: string | undefined = roots[0]!.id;
  while (cursor !== undefined) {
    if (visited.has(cursor)) {
      return { error: `cycle detected at <${cursor}>.` };
    }
    visited.add(cursor);
    const policy = byId.get(cursor);
    if (policy === undefined) {
      break;
    }
    ordered.push(policy);
    const kids: OdrlPolicy[] = childrenByParent.get(cursor) ?? [];
    const next: OdrlPolicy | undefined = kids[0];
    cursor = next?.id;
  }
  if (ordered.length !== policies.length) {
    return {
      error: `chain is disconnected: walked ${ordered.length} of ${policies.length} policies (gap or branch).`,
    };
  }
  return { ordered };
}

// --- helpers ---------------------------------------------------------------

function deny(
  phase: VerifierPhase,
  code: VerifierErrorCode,
  reason: string,
  chainPolicyIds: readonly string[] = [],
  extra: Partial<VerifyAuthorityResult> = {},
): VerifyAuthorityResult {
  return {
    authorized: false,
    phase,
    code,
    reason,
    chainPolicyIds,
    duties: [],
    policyIntegrityProvisional: false,
    ...extra,
  };
}

/** The validated, normalised options the phases read. */
interface CheckedOptions {
  readonly revoked: readonly string[];
  readonly maxChainLength: number;
  /** A private copy of `now`, so a seam cannot move the one evaluation instant. */
  readonly now: Date;
}

/**
 * Validate the caller's options before any phase runs. Each check closes a
 * fail-open: an Invalid Date makes every validity-window comparison false, a
 * missing `isControlledBy` falls back to solid-vc's prefix heuristic, a bare
 * string `revoked` becomes a set of characters, and a NaN cap never trips.
 */
function checkOptions(
  chain: PresentedChain,
  options: VerifyAuthorityOptions,
): CheckedOptions | VerifyAuthorityResult {
  const invalid = (reason: string) => deny("assembly", "INVALID_OPTIONS", reason);
  // Read the internal time value rather than trust instanceof, so a Date from
  // another realm is accepted; getTime throws on anything without that slot (a
  // spoofed Symbol.toStringTag included), which is refused below as NaN.
  let nowMs = Number.NaN;
  try {
    nowMs = Date.prototype.getTime.call(options.now);
  } catch {
    // not a Date
  }
  if (!Number.isFinite(nowMs)) {
    return invalid("`now` is not a valid Date — refusing to evaluate validity windows.");
  }
  if (typeof options.resolveKey !== "function") {
    return invalid("No resolveKey seam was supplied.");
  }
  if (typeof options.isControlledBy !== "function") {
    return invalid(
      "No isControlledBy seam was supplied — refusing solid-vc's prefix heuristic for key control.",
    );
  }
  const maxChainLength = options.maxChainLength ?? DEFAULT_MAX_CHAIN_LENGTH;
  if (!Number.isSafeInteger(maxChainLength) || maxChainLength < 1) {
    return invalid("maxChainLength must be a positive integer.");
  }
  const rawRevoked: unknown = options.revoked ?? [];
  const revoked =
    typeof rawRevoked === "string"
      ? [rawRevoked]
      : rawRevoked instanceof Set
        ? [...rawRevoked]
        : rawRevoked;
  if (!Array.isArray(revoked) || !revoked.every((r) => typeof r === "string")) {
    return invalid("revoked must be a policy IRI or a list of policy IRIs.");
  }
  if (!Array.isArray(chain.credentials) || !Array.isArray(chain.policies)) {
    return deny("assembly", "CHAIN_MALFORMED", "The presented chain is not a list of hops.");
  }
  if (chain.policies.length > maxChainLength || chain.credentials.length > maxChainLength) {
    return deny(
      "assembly",
      "CHAIN_MALFORMED",
      `The presented chain exceeds the maximum length ${maxChainLength}.`,
    );
  }
  return { revoked, maxChainLength, now: new Date(nowMs) };
}

/** The http(s) document a policy IRI names (its fragment removed), else undefined. */
function policyDocumentUrl(policyId: string): string | undefined {
  try {
    const url = new URL(policyId);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}

/** An XSD dateTime that names its timezone; a bare local time depends on the host TZ. */
const ZONED_DATE_TIME = /^-?\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** A validity bound that is absent, or a zoned dateTime that parses. */
function validBound(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "string" && ZONED_DATE_TIME.test(value) && Number.isFinite(Date.parse(value)))
  );
}

/**
 * A chain prohibition the request might trigger whose constraints name an operand
 * the request does not supply. solid-odrl treats a missing operand as unsatisfied,
 * so the prohibition would not fire: a request could escape it by leaving the
 * operand out. Probes each such prohibition with its unresolved constraints (and
 * its assignee) removed, against the requested action and against `grantUse`
 * (the delegation edge check). Returns the policy holding one that would match.
 */
function unresolvedProhibition(
  chain: readonly OdrlPolicy[],
  request: RequestContext,
  now: Date,
): OdrlPolicy | undefined {
  const attributes = request.attributes ?? {};
  const resolved = (c: OdrlConstraint) =>
    c.leftOperand === "dateTime" ||
    (Object.hasOwn(attributes, c.leftOperand) && typeof attributes[c.leftOperand] !== "boolean");
  // The delegation-depth operand is injected per edge by the evaluator.
  const kept = (c: OdrlConstraint) => resolved(c) && c.leftOperand !== "delegationDepth";
  for (const policy of chain) {
    const suspects = (policy.prohibitions ?? [])
      .filter((r) => (r.constraints ?? []).some((c) => !resolved(c)))
      .map(({ assignee: _assignee, ...r }) => ({
        ...r,
        constraints: (r.constraints ?? []).filter(kept),
      }));
    if (suspects.length === 0) continue;
    const probe: OdrlPolicy = { id: policy.id, prohibitions: suspects };
    for (const action of [request.action, "grantUse"] as const) {
      if (evaluate(probe, { ...request, action }, { now }).matchedProhibitions.length > 0) {
        return policy;
      }
    }
  }
  return undefined;
}

/** Operators that compare against ONE right operand (the evaluator reads only the first). */
const SCALAR_OPERATORS: ReadonlySet<string> = new Set(["eq", "neq", "gt", "gteq", "lt", "lteq"]);

/**
 * Every constraint a policy carries: on its rules, its permissions' duties, and its
 * obligations.
 */
function allConstraints(policy: OdrlPolicy): readonly OdrlConstraint[] {
  const rules = [...(policy.permissions ?? []), ...(policy.prohibitions ?? [])];
  const duties = [...rules.flatMap((r) => r.duties ?? []), ...(policy.obligations ?? [])];
  return [...rules, ...duties].flatMap((x) => x.constraints ?? []);
}

/**
 * The policy a content-bound hop is evaluated as: the one parsed from the SIGNED
 * content (already digest-checked by the caller), never the presenter's object.
 * Returns a reason string when the content cannot stand in for the hop:
 *  - it holds no well-formed policy, or a policy with another id;
 *  - its `delegatedUnder` differs from the hop's (the chain was assembled from
 *    the presented objects, so the position must agree with the signature);
 *  - the parsed policy does not re-serialise to exactly the signed graph — the
 *    projection dropped something (an unknown action, operand or operator), and
 *    evaluating it would weaken what the issuer signed.
 */
async function contentBoundPolicy(
  hop: OdrlPolicy,
  presented: PresentedResourceContent,
): Promise<OdrlPolicy | string> {
  try {
    const contentType = presented.contentType ?? "text/turtle";
    // Resolve relative IRIs (`<#policy>`) against the policy document, as a
    // consumer fetching it would; the digest gate above binds the bytes. Parse once
    // so the policy and the round-trip compare read the same graph.
    const dataset = await parseRdf(presented.content, contentType, {
      ...(policyDocumentUrl(hop.id) !== undefined && { baseIRI: policyDocumentUrl(hop.id) }),
    });
    const parsed = await parsePolicy(dataset);
    if (parsed === undefined) return "the signed content holds no well-formed ODRL policy";
    if (parsed.id !== hop.id) {
      return `the signed content's policy is <${parsed.id}>, not <${hop.id}>`;
    }
    if (parsed.delegatedUnder !== hop.delegatedUnder) {
      return "the signed content places the policy at a different chain position (odrld:delegatedUnder)";
    }
    // An RDF graph has no value order, but the evaluator compares a scalar
    // operator against the FIRST right operand only — so with several values the
    // presenter's triple order would pick the one that counts.
    if (
      allConstraints(parsed).some(
        (c) =>
          SCALAR_OPERATORS.has(c.operator) &&
          Array.isArray(c.rightOperand) &&
          c.rightOperand.length !== 1,
      )
    ) {
      return "a scalar constraint operator carries several right operands, whose order the signed graph does not fix";
    }
    const [signed, projected] = await Promise.all([
      digestQuads([...dataset.match()]),
      digestQuads(policyToRdf(parsed)),
    ]);
    if (signed !== projected) {
      return "the signed content carries statements the evaluator cannot represent — refusing to evaluate a weaker policy than was signed";
    }
    return parsed;
  } catch (e) {
    return `the signed content could not be read as a policy (${e instanceof Error ? e.message : String(e)})`;
  }
}

// --- the composed verifier -------------------------------------------------

/**
 * Verify a presented delegation chain authorizes {@link VerifyAuthorityOptions.request},
 * fail-closed across assembly → Phase A → B → C → D (+ the D9 identity composition).
 * `now` is the single evaluation instant (pass the action's `prov:startedAtTime`
 * for an audit-time re-run).
 */
export async function verifyAgentAuthority(
  chain: PresentedChain,
  options: VerifyAuthorityOptions,
): Promise<VerifyAuthorityResult> {
  const checked = checkOptions(chain, options);
  if ("authorized" in checked) return checked;
  const { request, rootPrincipal, resolveKey, isControlledBy } = options;
  const { now } = checked;

  // --- assembly ------------------------------------------------------------
  const assembled = assembleChain(chain.policies);
  if ("error" in assembled) {
    return deny("assembly", "CHAIN_MALFORMED", `Chain assembly failed: ${assembled.error}`);
  }
  let ordered: readonly OdrlPolicy[] = assembled.ordered;
  const chainIds = ordered.map((p) => p.id);

  // Map each hop policy to its binding credential (svc:policy ≡ policy.id).
  const bound = new Map<string, { vc: VerifiableCredential; auth: BoundAuthorization }>();
  for (const vc of chain.credentials) {
    const auth = readBoundAuthorization(vc);
    if (auth === undefined) {
      return deny(
        "B",
        "BINDING_MISMATCH",
        "A presented credential is not a well-formed AgentAuthorizationCredential.",
        chainIds,
      );
    }
    if (auth.policy === undefined) {
      return deny(
        "B",
        "BINDING_MISMATCH",
        `Credential from <${auth.principal}> binds no svc:policy — nothing to place in the chain.`,
        chainIds,
      );
    }
    if (bound.has(auth.policy)) {
      return deny(
        "B",
        "BINDING_MISMATCH",
        `More than one credential binds policy <${auth.policy}>.`,
        chainIds,
      );
    }
    bound.set(auth.policy, { vc, auth });
  }
  if (bound.size !== ordered.length) {
    return deny(
      "B",
      "BINDING_MISMATCH",
      `Credential/policy count mismatch: ${bound.size} bound credential(s) for ${ordered.length} chain hop(s).`,
      chainIds,
    );
  }
  for (const p of ordered) {
    if (!bound.has(p.id)) {
      return deny(
        "B",
        "BINDING_MISMATCH",
        `Chain hop <${p.id}> has no binding credential.`,
        chainIds,
      );
    }
  }

  // --- Phase A (ALL hops) + the delegation-trust anchor + the G1/G2 gates ---
  // TWO-PASS ORDERING (roborev Medium — a diagnostic phase-ordering finding, NOT
  // a security bypass: every invalid chain was ALREADY rejected either way; this
  // is about which phase/code a MULTI-HOP chain with mixed failures reports).
  // The prior structure ran ONE per-hop loop doing Phase A → subject-issuer →
  // digest → status for hop 0, then hop 1, etc. — so a Phase-B
  // `SUBJECT_ISSUER_MISMATCH` on an EARLIER hop returned BEFORE Phase A ever ran
  // for a LATER hop, masking that later hop's invalid proof behind an earlier
  // hop's Phase-B code. The documented semantics are: Phase A (proof/validity/
  // key-control) for ALL hops FIRST; only once every hop has passed Phase A do
  // the Phase-B/C gates run. Fixed by splitting into two passes:
  //   Pass 1 — Phase-A-ONLY `verifyCredential` (no `presentedResources`, no
  //            `resolveStatus`) for EVERY hop, in order. Any failure returns
  //            immediately with ITS hop's Phase-A code — a later hop's bad proof
  //            can never be masked by an earlier hop's Phase-B/C result, because
  //            no Phase-B/C gate has run for ANY hop yet.
  //   Pass 2 — only reached once every hop has passed Phase A. Per hop, in
  //            order: SUBJECT_ISSUER_MISMATCH → the G1 digest gate
  //            (verifyRelatedResources → POLICY_INTEGRITY) → the G2 status gate
  //            (resolveStatus → REVOKED/SUSPENDED/STATUS_RETRIEVAL_ERROR) — the
  //            existing single-hop gate-precedence order (758607c/6ad0776/
  //            bdabba5), unchanged.
  // No gate is weakened: all four still run and fail-closed for every hop —
  // this only fixes WHICH hop's WHICH code wins when failures span hops.
  const contents = chain.policyContents ?? {};

  // --- Pass 1: Phase A (proof, cryptosuite, validity window, key-control) ---
  // for EVERY hop, no `presentedResources`, no `resolveStatus` — so a genuine
  // proof failure on ANY hop is reported immediately and cannot be masked by,
  // nor itself mask, a downstream digest/status/subject-issuer finding on a
  // DIFFERENT hop. Phase A across the whole chain always wins.
  for (const hop of ordered) {
    // biome-ignore lint/style/noNonNullAssertion: every hop bound (checked above)
    const b = bound.get(hop.id)!;
    const phaseARes = await verifyCredential(b.vc, {
      resolveKey,
      isControlledBy,
      expectedProofPurpose: "assertionMethod",
      now,
    });
    if (phaseARes.verified && !(validBound(b.vc.validFrom) && validBound(b.vc.validUntil))) {
      return deny(
        "A",
        "MALFORMED",
        `Phase A (credential verification) failed for hop <${hop.id}>: a validity bound is not a dateTime with a timezone.`,
        chainIds,
      );
    }
    if (!phaseARes.verified) {
      const detail = phaseARes.errors.map((e) => e.message).join("; ");
      const phaseAError = phaseARes.errors.find((e) =>
        PHASE_A_CODES.has(e.code as VerifierErrorCode),
      );
      const code: VerifierErrorCode =
        phaseAError !== undefined ? (phaseAError.code as VerifierErrorCode) : "INVALID_SIGNATURE";
      return deny(
        "A",
        code,
        `Phase A (credential verification) failed for hop <${hop.id}>: ${detail}`,
        chainIds,
      );
    }
  }

  // --- Pass 2: reached only once EVERY hop has passed Phase A above. Per hop,
  // in order: subject-issuer anchor → G1 digest gate (+ the signed policy that
  // replaces the presented object) → G2 status gate.
  const signedPolicies = new Map<string, OdrlPolicy>();
  for (const hop of ordered) {
    // biome-ignore lint/style/noNonNullAssertion: every hop bound (checked above)
    const b = bound.get(hop.id)!;
    // Snapshot the content once: the digest gate, the parse and the round-trip
    // must all read the same bytes (an accessor could otherwise change them).
    const raw: PresentedResourceContent | undefined = Object.hasOwn(contents, hop.id)
      ? contents[hop.id]
      : undefined;
    if (raw !== undefined && (typeof raw !== "object" || raw === null)) {
      return deny(
        "B",
        "POLICY_INTEGRITY",
        `The content presented for chain hop <${hop.id}> is not a content object.`,
        chainIds,
      );
    }
    const presented: PresentedResourceContent | undefined =
      raw === undefined
        ? undefined
        : Object.freeze({
            content: raw.content,
            ...(raw.contentType !== undefined && { contentType: raw.contentType }),
          });

    // SECURITY (delegation-trust anchor) — runs BEFORE the digest/status gates
    // below, for this hop. Each hop's self-asserted `credentialSubject.id`,
    // when present, MUST equal its proof-verified `issuer`. `verifyCredential`
    // (Phase A) proves the signature against `issuer` + key control but does
    // NOT constrain the subject id — so without this an attacker who
    // legitimately controls their OWN issuer key could sign an otherwise-valid
    // credential whose `subject.id` names a TRUSTED party (a root owner / an
    // authorized delegatee) and have the chain accept it as that party's
    // grant, impersonating any assigner. Placed here so a subject-spoofed
    // credential is rejected with the precise `SUBJECT_ISSUER_MISMATCH` code
    // EVEN WHEN it also fails the digest or status gate below (the single-hop
    // gate-precedence fix, preserved unchanged inside Pass 2).
    const assertedSubjectId = claimString(subjectRecord(b.vc)?.id);
    if (assertedSubjectId !== undefined && assertedSubjectId !== b.vc.issuer) {
      return deny(
        "B",
        "SUBJECT_ISSUER_MISMATCH",
        `Credential subject <${assertedSubjectId}> ≠ its proof-verified issuer <${b.vc.issuer}> — refusing a subject-spoofed authorization.`,
        chainIds,
      );
    }

    // G1 policy-content digest gate (Phase B semantics — the credential↔policy-
    // content cross-binding): recompute the RDFC-1.0 canonical digest of the
    // presented raw policy document and compare it to the credential's SIGNED
    // `relatedResource` `digestMultibase`, fail-closed — a substituted/mutated
    // policy behind the (mutable) `svc:policy` IRI can no longer verify. Run
    // standalone via solid-vc's `verifyRelatedResources` (NOT bundled into the
    // Phase-A call above) so it can never mask — or be masked by — the
    // subject-issuer check above it.
    if (presented !== undefined) {
      const digestRes = await verifyRelatedResources(b.vc, { [hop.id]: presented });
      if (!digestRes.verified) {
        const detail = digestRes.errors.map((e) => e.message).join("; ");
        return deny(
          "B",
          "POLICY_INTEGRITY",
          `Policy-content binding failed for <${hop.id}>: ${detail}`,
          chainIds,
        );
      }
      // The digest binds the CONTENT; evaluate the policy that content states,
      // never a presenter-supplied object beside it.
      const signedPolicy = await contentBoundPolicy(hop, presented);
      if (typeof signedPolicy === "string") {
        return deny(
          "B",
          "POLICY_INTEGRITY",
          `Policy-content binding failed for <${hop.id}>: ${signedPolicy}.`,
          chainIds,
        );
      }
      signedPolicies.set(hop.id, signedPolicy);
    }

    // G2 status gate (Phase C — status ∪ revocation, fail-closed). A credential
    // CARRYING a status entry, verified WITHOUT a status resolver, must deny —
    // a status mechanism nobody checked must never read as "not revoked". (An
    // entry-less credential passes without the gate.)
    if (options.resolveStatus === undefined && b.vc.credentialStatus !== undefined) {
      return deny(
        "C",
        "STATUS_RETRIEVAL_ERROR",
        `Credential for hop <${hop.id}> carries a credentialStatus entry but no status resolver was supplied — denying (fail-closed).`,
        chainIds,
      );
    }
    if (options.resolveStatus !== undefined) {
      // Re-run `verifyCredential` with ONLY the status seam added (Phase A was
      // already confirmed above with the identical `now` + key seams, so this
      // call is deterministic and can only newly fail on the status gate).
      const statusRes = await verifyCredential(b.vc, {
        resolveKey,
        isControlledBy,
        resolveStatus: options.resolveStatus,
        expectedProofPurpose: "assertionMethod",
        now,
      });
      if (!statusRes.verified) {
        const detail = statusRes.errors.map((e) => e.message).join("; ");
        const statusError = statusRes.errors.find((e) => STATUS_GATE_CODES.has(e.code));
        const statusCode: VerifierErrorCode =
          statusError?.code === "STATUS_REVOKED"
            ? "REVOKED"
            : statusError?.code === "STATUS_SUSPENDED"
              ? "SUSPENDED"
              : "STATUS_RETRIEVAL_ERROR";
        return deny(
          "C",
          statusCode,
          `Credential status gate failed for hop <${hop.id}>: ${detail}`,
          chainIds,
        );
      }
    }
  }
  // The permit is fully content-bound (non-provisional) only when EVERY hop's raw
  // policy content was presented — and therefore digest-checked above, fail-closed.
  const allContentBound = ordered.every((p) => signedPolicies.has(p.id));
  // From here on every phase reads the SIGNED policy for each content-bound hop.
  ordered = ordered.map((p) => signedPolicies.get(p.id) ?? p);

  // --- Phase B: cross-binding (root/assigner/linkage) -----------------------
  // The subject↔issuer anchor + the G1/G2 gates already ran per hop above; here
  // the root-principal / assigner / delegation-linkage checks follow.
  // biome-ignore lint/style/noNonNullAssertion: ordered non-empty (assembly)
  const rootHop = ordered[0]!;
  // biome-ignore lint/style/noNonNullAssertion: every hop bound (checked above)
  const rootBound = bound.get(rootHop.id)!;
  if (rootBound.auth.principal !== rootPrincipal) {
    return deny(
      "B",
      "BINDING_MISMATCH",
      `Root credential issuer <${rootBound.auth.principal}> is not the trusted root principal <${rootPrincipal}> for this target.`,
      chainIds,
    );
  }
  for (let i = 0; i < ordered.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: i in bounds
    const hop = ordered[i]!;
    // biome-ignore lint/style/noNonNullAssertion: every hop bound
    const b = bound.get(hop.id)!;
    // The hop's credential must be issued by (and self-assert a subject of) the
    // hop's assigner (the delegator). Pass 2 above already tied issuer ≡
    // subject.id; here we tie both to the ODRL assigner.
    if (hop.assigner !== undefined && b.auth.principal !== hop.assigner) {
      return deny(
        "B",
        "BINDING_MISMATCH",
        `Hop <${hop.id}> assigner <${hop.assigner}> ≠ its credential's issuer/subject <${b.auth.principal}>.`,
        chainIds,
      );
    }
    // The delegate this hop authorizes must be the NEXT hop's assigner (the chain
    // linkage) — and, at the leaf, the party the leaf agreement names as assignee.
    if (i + 1 < ordered.length) {
      // biome-ignore lint/style/noNonNullAssertion: i+1 in bounds
      const nextHop = ordered[i + 1]!;
      if (nextHop.assigner === undefined) {
        return deny(
          "B",
          "BINDING_MISMATCH",
          `Hop <${nextHop.id}> has no assigner to bind to its parent's authorized delegate.`,
          chainIds,
        );
      }
      if (b.auth.authorizes !== nextHop.assigner) {
        return deny(
          "B",
          "BINDING_MISMATCH",
          `Hop <${hop.id}> authorizes <${b.auth.authorizes}> but the next hop's assigner is <${nextHop.assigner}> — broken delegation linkage.`,
          chainIds,
        );
      }
    }
  }

  // The leaf assignee `p`: the party the leaf credential authorizes (must agree
  // with the leaf policy's assignee where it states one).
  // biome-ignore lint/style/noNonNullAssertion: ordered non-empty
  const leafHop = ordered[ordered.length - 1]!;
  // biome-ignore lint/style/noNonNullAssertion: leaf hop bound
  const leafBound = bound.get(leafHop.id)!;
  const leafAssignee = leafBound.auth.authorizes;
  if (leafHop.assignee !== undefined && leafHop.assignee !== leafAssignee) {
    return deny(
      "B",
      "BINDING_MISMATCH",
      `Leaf policy <${leafHop.id}> assignee <${leafHop.assignee}> ≠ the party its credential authorizes <${leafAssignee}>.`,
      chainIds,
    );
  }
  // D9 pin: when the caller requires a specific leaf assignee (the identity
  // composition pins the second chain's leaf to the authenticated actor), the chain
  // MUST prove authority for exactly that party. Without this, a chain rooted
  // correctly but authorizing some OTHER party would be accepted, because Phase D
  // always evaluates the chain's OWN leaf assignee (the roborev round-1 HIGH).
  if (options.requireLeafAssignee !== undefined && leafAssignee !== options.requireLeafAssignee) {
    return deny(
      "B",
      "BINDING_MISMATCH",
      `Chain leaf assignee <${leafAssignee}> ≠ the required party <${options.requireLeafAssignee}>.`,
      chainIds,
    );
  }

  // --- Phase C: status ∪ revocation, fail-closed ---------------------------
  // The CREDENTIAL-level Bitstring status gate ran per hop above (inside the
  // credential-verification loop, reported with Phase-C semantics); here the
  // POLICY-level `odrld:Revocation` set + the external-source flag are consulted.
  if (options.statusUnreachable === true) {
    return deny(
      "C",
      "STATUS_RETRIEVAL_ERROR",
      "A revocation/status source could not be retrieved — denying (fail-closed).",
      chainIds,
    );
  }
  const revoked = new Set(checked.revoked);
  for (const p of ordered) {
    if (revoked.has(p.id)) {
      return deny("C", "REVOKED", `Chain policy <${p.id}> has been revoked.`, chainIds);
    }
  }

  // --- G1 completeness: a hop with no signed content -----------------------
  // Checked after B and C so their codes keep precedence; before D because the
  // evaluator would otherwise read a presenter-chosen policy.
  const unbound = ordered.find((p) => !signedPolicies.has(p.id));
  if (unbound !== undefined && options.allowProvisionalPolicy !== true) {
    return deny(
      "B",
      "POLICY_INTEGRITY",
      `Chain hop <${unbound.id}> was presented without its signed policy content — nothing ties the presented policy to what the issuer signed (set allowProvisionalPolicy to accept it as provisional).`,
      chainIds,
    );
  }

  // --- Phase D: the delegation-profile chain walk --------------------------
  // Pin the requesting agent to the LEAF ASSIGNEE (D9): legal accountability
  // attaches to the party the leaf agreement names, not to whoever authenticated.
  // An action outside the ODRL vocabulary (or a prototype key) has no implication
  // entry; deny it here rather than let the evaluator throw.
  if (
    typeof request.action !== "string" ||
    !(ODRL_ACTIONS as readonly string[]).includes(request.action)
  ) {
    return deny(
      "D",
      "POLICY_DENIED",
      `Phase D denied: the requested action ${JSON.stringify(String(request.action))} is not an ODRL action.`,
      chainIds,
    );
  }
  // solid-odrl reads only the first element of a multi-valued attribute under a
  // scalar operator and lets one element decide a set operator, so a value set
  // could ride an `eq` permission or switch off an `isNoneOf` prohibition. The
  // verifier takes single-valued attributes only.
  // A malformed scalar (an object, NaN, a dateTime that does not parse) could
  // throw inside the evaluator; refuse it here as a denial.
  const malformed = Object.entries(request.attributes ?? {}).find(
    ([key, v]) =>
      Array.isArray(v) ||
      !(
        typeof v === "boolean" ||
        (typeof v === "number" && Number.isFinite(v)) ||
        (typeof v === "string" &&
          (key !== "dateTime" || (ZONED_DATE_TIME.test(v) && Number.isFinite(Date.parse(v)))))
      ),
  );
  if (malformed !== undefined) {
    return deny(
      "D",
      "POLICY_DENIED",
      `Phase D denied: the request attribute ${JSON.stringify(malformed[0])} is not a single well-formed value.`,
      chainIds,
    );
  }
  const primaryRequest: RequestContext = { ...request, agent: leafAssignee };
  const unresolved = unresolvedProhibition(ordered, primaryRequest, now);
  if (unresolved !== undefined) {
    return deny(
      "D",
      "POLICY_DENIED",
      `Phase D denied: a prohibition in <${unresolved.id}> may apply, but the request does not supply every operand it constrains.`,
      chainIds,
    );
  }
  let decision: DelegatedEvaluationResult;
  try {
    decision = evaluateDelegated(ordered, primaryRequest, {
      now,
      revoked: [...revoked],
      ...(options.requireDuties !== undefined && { requireDuties: options.requireDuties }),
      maxChainLength: checked.maxChainLength,
    });
  } catch (e) {
    return deny(
      "D",
      "POLICY_DENIED",
      `Phase D denied: the evaluator failed (${e instanceof Error ? e.message : String(e)}).`,
      chainIds,
    );
  }
  if (decision.decision !== "permit") {
    return deny("D", "POLICY_DENIED", `Phase D denied: ${decision.reason}`, chainIds, {
      decision,
      duties: decision.duties,
    });
  }

  // --- D9 identity composition ---------------------------------------------
  // The authenticated actor `w`. When `w ≠ p` (leaf assignee), `w` is authorized
  // ONLY via a second four-phase-verified chain rooted at `p`.
  let actorResult: VerifyAuthorityResult | undefined;
  if (options.actor !== undefined && options.actor !== leafAssignee) {
    if (options.actorChain === undefined) {
      return deny(
        "composition",
        "IDENTITY_COMPOSITION_FAILED",
        `Acting WebID <${options.actor}> is not the leaf assignee <${leafAssignee}>, and no second chain rooted at <${leafAssignee}> was presented to authorize it.`,
        chainIds,
        {
          decision,
        },
      );
    }
    actorResult = await verifyAgentAuthority(options.actorChain, {
      request: { ...request, agent: options.actor },
      rootPrincipal: leafAssignee, // composition rule: chain₂.root ≡ chain₁.leaf
      // PIN chain₂'s leaf assignee to the actor — chain₂ must prove authority for
      // `actor` itself, not for some other party it happens to be rooted to name.
      requireLeafAssignee: options.actor,
      now,
      resolveKey,
      isControlledBy,
      ...(options.resolveStatus !== undefined && { resolveStatus: options.resolveStatus }),
      revoked: checked.revoked,
      ...(options.allowProvisionalPolicy !== undefined && {
        allowProvisionalPolicy: options.allowProvisionalPolicy,
      }),
      ...(options.statusUnreachable !== undefined && {
        statusUnreachable: options.statusUnreachable,
      }),
      ...(options.requireDuties !== undefined && { requireDuties: options.requireDuties }),
      maxChainLength: checked.maxChainLength,
      // the actor of chain₂ is its own leaf assignee (w authenticates as itself)
    });
    if (!actorResult.authorized) {
      return deny(
        "composition",
        "IDENTITY_COMPOSITION_FAILED",
        `The second (identity-composition) chain for actor <${options.actor}> did not verify: ${actorResult.reason}`,
        chainIds,
        {
          decision,
          actorResult,
        },
      );
    }
  }

  return {
    authorized: true,
    phase: "complete",
    reason:
      actorResult !== undefined
        ? `Authorized: the ${ordered.length}-hop chain permits the leaf assignee <${leafAssignee}>, and a second chain rooted at <${leafAssignee}> authorizes the acting agent <${options.actor}>.`
        : `Authorized: the ${ordered.length}-hop chain permits the request for <${leafAssignee}>.`,
    chainPolicyIds: chainIds,
    decision,
    ...(actorResult !== undefined && { actorResult }),
    duties: decision.duties,
    // G1 — `false` only when every hop of THIS chain and of the identity-
    // composition chain (when one ran) was content-digest-verified above; any hop
    // presented without raw content keeps the honest provisional marker.
    policyIntegrityProvisional:
      !allContentBound || (actorResult?.policyIntegrityProvisional ?? false),
  };
}
