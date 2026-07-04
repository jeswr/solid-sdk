// AUTHORED-BY Claude Fable 5
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
// PURITY CONTRACT (load-bearing): this package does ZERO I/O and ZERO RDF
// parsing. All network enters through the INJECTED seams —
// {@link VerifyAuthorityOptions.resolveKey} / `isControlledBy` / `resolveStatus`
// — and all RDF/crypto mechanics live in the composed packages (`solid-vc`
// verifies credentials + digests; `solid-odrl` walks the delegation chain).
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
//              fail-closed (a digest failure → a `POLICY_INTEGRITY` deny).
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

import type {
  ActiveDuty,
  DelegatedEvaluationResult,
  OdrlPolicy,
  RequestContext,
} from "@jeswr/solid-odrl";
import { evaluateDelegated } from "@jeswr/solid-odrl";
import type {
  PresentedResourceContent,
  VerifiableCredential,
  VerifyCredentialOptions,
} from "@jeswr/solid-vc";
import { SVC, verifyCredential, verifyRelatedResources } from "@jeswr/solid-vc";
import {
  PHASE_A_CODES,
  STATUS_GATE_CODES,
  type VerifierErrorCode,
  type VerifierPhase,
} from "./errors.js";

// The `svc:` claim IRIs the Phase-B cross-binding reads, derived from solid-vc's
// exported `SVC` namespace — the exact IRIs `issueAgentAuthorization` writes.
const SVC_AUTHORIZES = `${SVC}authorizes`;
const SVC_ACTION = `${SVC}action`;
const SVC_TARGET = `${SVC}target`;
const SVC_POLICY = `${SVC}policy`;

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
 * missing digest or a mismatch). When every hop's content is presented and passes,
 * the permit's `policyIntegrityProvisional` is `false`; a hop presented WITHOUT
 * content falls back to the trusted-by-location reading and keeps the honest
 * provisional marker.
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
  /** The single evaluation instant across all phases (the note's one-instant rule). */
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
   * two-directional document resolution. When omitted, solid-vc falls back to
   * its documented prefix heuristic — acceptable only for closed test setups.
   */
  readonly isControlledBy?: VerifyCredentialOptions["isControlledBy"];
  /**
   * Phase C, the POLICY-level revocation input: policy IRIs revoked via the
   * delegation profile's `odrld:Revocation` (e.g. published in a trace's
   * `revocations.ttl`). Distinct from — and consulted IN ADDITION TO — the
   * credential-level Bitstring status gate (`resolveStatus`).
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
  /** Absolute chain-length cap (Phase D structural guard). */
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

/** The credentialSubject as a claim record (first subject if an array). */
function subjectRecord(vc: VerifiableCredential): Record<string, unknown> | undefined {
  const subject = Array.isArray(vc.credentialSubject)
    ? vc.credentialSubject[0]
    : vc.credentialSubject;
  return subject && typeof subject === "object" ? (subject as Record<string, unknown>) : undefined;
}

/** Coerce a claim value to a string, or `undefined`. */
function claimString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Coerce a claim value to a string array. */
function claimStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

/**
 * Read the AgentAuthorizationCredential's bound claim from its subject graph. The
 * delegating `principal` is the PROOF-VERIFIED `vc.issuer` — never the
 * self-asserted `credentialSubject.id` (see {@link BoundAuthorization.principal}
 * for why trusting the subject id would be a chain-of-trust bypass). The subject
 * carries the grant fields `svc:authorizes` / `svc:action` / `svc:target` /
 * `svc:policy`. NOTE this is a pure reader — it does NOT verify the proof; the
 * verifier runs Phase A (`verifyCredential`) and the `subject.id === issuer`
 * fail-closed check before any of these fields are trusted.
 */
export function readBoundAuthorization(vc: VerifiableCredential): BoundAuthorization | undefined {
  const types = vc.type ?? [];
  if (!types.includes("AgentAuthorizationCredential")) {
    return undefined;
  }
  const subject = subjectRecord(vc);
  const authorizes = claimString(subject?.[SVC_AUTHORIZES]);
  if (subject === undefined || authorizes === undefined || typeof vc.issuer !== "string") {
    return undefined;
  }
  // SECURITY: the delegating principal is the proof-anchored issuer, NOT subject.id.
  const principal = vc.issuer;
  const action = claimStrings(subject[SVC_ACTION]);
  const target = claimString(subject[SVC_TARGET]);
  const policy = claimString(subject[SVC_POLICY]);
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
  const { request, rootPrincipal, now, resolveKey } = options;

  // --- assembly ------------------------------------------------------------
  const assembled = assembleChain(chain.policies);
  if ("error" in assembled) {
    return deny("assembly", "CHAIN_MALFORMED", `Chain assembly failed: ${assembled.error}`);
  }
  const ordered = assembled.ordered;
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
      ...(options.isControlledBy !== undefined && { isControlledBy: options.isControlledBy }),
      expectedProofPurpose: "assertionMethod",
      now,
    });
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
  // in order: subject-issuer anchor → G1 digest gate → G2 status gate.
  for (const hop of ordered) {
    // biome-ignore lint/style/noNonNullAssertion: every hop bound (checked above)
    const b = bound.get(hop.id)!;
    const presented: PresentedResourceContent | undefined = contents[hop.id];

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
        ...(options.isControlledBy !== undefined && { isControlledBy: options.isControlledBy }),
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
  const allContentBound = ordered.every((p) => contents[p.id] !== undefined);

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
    // hop's assigner (the delegator). solid-vc already tied issuer ≡ subject.id;
    // here we tie both to the ODRL assigner.
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
  const revoked = new Set(options.revoked ?? []);
  for (const p of ordered) {
    if (revoked.has(p.id)) {
      return deny("C", "REVOKED", `Chain policy <${p.id}> has been revoked.`, chainIds);
    }
  }

  // --- Phase D: the delegation-profile chain walk --------------------------
  // Pin the requesting agent to the LEAF ASSIGNEE (D9): legal accountability
  // attaches to the party the leaf agreement names, not to whoever authenticated.
  const primaryRequest: RequestContext = { ...request, agent: leafAssignee };
  const decision = evaluateDelegated(ordered, primaryRequest, {
    now,
    revoked: [...revoked],
    ...(options.requireDuties !== undefined && { requireDuties: options.requireDuties }),
    ...(options.maxChainLength !== undefined && { maxChainLength: options.maxChainLength }),
  });
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
      ...(options.isControlledBy !== undefined && { isControlledBy: options.isControlledBy }),
      ...(options.resolveStatus !== undefined && { resolveStatus: options.resolveStatus }),
      ...(options.revoked !== undefined && { revoked: options.revoked }),
      ...(options.statusUnreachable !== undefined && {
        statusUnreachable: options.statusUnreachable,
      }),
      ...(options.requireDuties !== undefined && { requireDuties: options.requireDuties }),
      ...(options.maxChainLength !== undefined && { maxChainLength: options.maxChainLength }),
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
    // The second chain must actually authorize the ACTOR (its leaf assignee ≡ w).
    // verifyAgentAuthority already pins Phase D to chain₂'s leaf assignee; confirm
    // that leaf assignee is the actor so the chain proves `w`, not a third party.
    if (actorResult.decision === undefined) {
      return deny(
        "composition",
        "IDENTITY_COMPOSITION_FAILED",
        "The second chain produced no Phase-D decision.",
        chainIds,
        { decision },
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
