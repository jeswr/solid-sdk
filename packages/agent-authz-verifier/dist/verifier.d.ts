import type { ActiveDuty, DelegatedEvaluationResult, OdrlPolicy, RequestContext } from "@jeswr/solid-odrl";
import type { PresentedResourceContent, VerifiableCredential, VerifyCredentialOptions } from "@jeswr/solid-vc";
import { type VerifierErrorCode, type VerifierPhase } from "./errors.js";
/** The bound agent-authorization claim read from an AgentAuthorizationCredential. */
export interface BoundAuthorization {
    /** The issuer / subject / delegator (svc credential: issuer ≡ subject.id). */
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
 * digest. When a hop's content is present, `verifyCredential` recomputes its
 * RDFC-1.0 canonical digest and compares it against the credential's SIGNED
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
/**
 * Read the AgentAuthorizationCredential's bound claim from its subject graph —
 * `issuer` is the principal (solid-vc asserts issuer ≡ subject.id); the subject
 * carries `svc:authorizes` / `svc:action` / `svc:target` / `svc:policy`.
 */
export declare function readBoundAuthorization(vc: VerifiableCredential): BoundAuthorization | undefined;
/**
 * Verify a presented delegation chain authorizes {@link VerifyAuthorityOptions.request},
 * fail-closed across assembly → Phase A → B → C → D (+ the D9 identity composition).
 * `now` is the single evaluation instant (pass the action's `prov:startedAtTime`
 * for an audit-time re-run).
 */
export declare function verifyAgentAuthority(chain: PresentedChain, options: VerifyAuthorityOptions): Promise<VerifyAuthorityResult>;
//# sourceMappingURL=verifier.d.ts.map