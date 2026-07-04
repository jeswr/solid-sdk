# @jeswr/agent-authz-verifier

The composed **four-phase agent-authorization chain verifier** — the standalone,
independently-checkable keystone of the accountable-agents stack, extracted from
[`@jeswr/accountable-agent-runtime`](https://github.com/jeswr/accountable-agent-runtime)
(its design decision D2 named this package as the extraction target). It answers ONE
question, fail-closed:

> Does this presented chain of **AgentAuthorizationCredentials** + bound **ODRL
> delegation policies** authorize *this* agent to perform *this* action on *this*
> resource, at *this* instant?

Neither [`@jeswr/solid-vc`](https://github.com/jeswr/solid-vc) (credential
signature/digest/status verification) nor
[`@jeswr/solid-odrl`](https://github.com/jeswr/solid-odrl) (the ODRL
agent-delegation profile walker) owns this composition alone, by design — this
package is the composition, and nothing else.

> Experimental, AI-agent-generated (see the `AUTHORED-BY` markers). Not published
> to npm yet; install from GitHub (below).

## The purity / injectable-seam contract

**This package does zero I/O and zero RDF parsing.** Every side effect enters
through an injected seam on `VerifyAuthorityOptions`:

| Seam | Shape | Production implementation |
|---|---|---|
| `resolveKey` | `(verificationMethod) => CryptoKey \| undefined` (may be async) | solid-vc `createWebIdKeyResolver().resolveKey` (fail-closed WebID-document resolution) |
| `isControlledBy` | `(verificationMethod, issuer) => boolean` (may be async) | the SAME `createWebIdKeyResolver()` instance's `isControlledBy` |
| `resolveStatus` | `(vc) => CredentialStatusCheck` (may be async) | solid-vc `createBitstringStatusResolver(…)` (SSRF-guarded, signature-verified W3C Bitstring Status List read) |

Given the same chain, options, and seam behaviour, the verdict is a pure function
of its inputs. That is what makes this the **standalone artifact a second,
independent implementation reproduces** — and what the
[`agentic-solid-conformance`](https://github.com/jeswr/agentic-solid-conformance)
golden test vectors exercise: the 29 agent-authz-credential vectors there were
extracted from exactly this verifier's decision matrix, and an implementation
claiming conformance must reproduce these verdicts (phase + error code) with only
the injected seams doubled.

## The four phases (all fail-closed, in order)

1. **assembly** — order the presented policies root-first by
   `odrld:delegatedUnder`; reject duplicates, gaps, branches, cycles, ≠1 root
   (`CHAIN_MALFORMED`).
2. **Phase A** — `solid-vc.verifyCredential` on every hop credential at ONE
   instant (`now`): signature, cryptosuite, validity window, proof purpose,
   issuer↔key control — plus the **policy-content digest gate**: when a hop's raw
   policy document is presented (`PresentedChain.policyContents`), its RDFC-1.0
   canonical digest must match the credential's SIGNED `relatedResource`
   digest (`POLICY_INTEGRITY` on a mismatch or a missing digest).
3. **Phase B** — cross-binding: each hop's credential is issued by (and
   self-asserts a subject of) that hop's `odrl:assigner`; the delegate it
   authorizes is the NEXT hop's assigner; the ROOT credential's issuer is the
   caller's trusted root principal (`BINDING_MISMATCH`).
4. **Phase C** — status ∪ revocation: every hop credential's status entry is
   resolved through the `resolveStatus` seam (`REVOKED` / `SUSPENDED`; an
   unconfirmable entry — or an entry present with NO resolver supplied — is
   `STATUS_RETRIEVAL_ERROR`: a status mechanism nobody checked must never read as
   "not revoked"), plus the POLICY-level `odrld:Revocation` set (`revoked`) and
   the external-source `statusUnreachable` flag.
5. **Phase D** — `solid-odrl.evaluateDelegated` over the ordered chain: in-scope
   intersection, unexpired, unrevoked, depth-bounded, acyclic (`POLICY_DENIED`).

Plus the **D9 identity-composition rule**: Phase D always evaluates the request
pinned to the chain's **leaf assignee** `p` (legal accountability attaches to the
party the leaf agreement names). An authenticated `actor ≠ p` is accepted ONLY via
a second four-phase-verified chain (`actorChain`) whose trusted root **is** `p`
and whose own leaf assignee **is** the actor (`IDENTITY_COMPOSITION_FAILED`
otherwise).

An authorize additionally reports `policyIntegrityProvisional`: `false` IFF every
hop of the chain (and of the actor chain, when one ran) passed the content-digest
gate; a hop presented without its raw policy bytes keeps the honest provisional
marker.

## Install

```bash
npm install github:jeswr/agent-authz-verifier#main
```

The committed `dist/` is **self-contained with respect to the off-npm `@jeswr`
dependencies** (`@jeswr/solid-vc`, `@jeswr/solid-odrl`, and their off-npm
transitives are esbuild-inlined), so it imports with no build step under
`ignore-scripts=true`. The npm-published dependencies (`n3`, `jose`,
`rdf-canonize`, `multiformats`, `content-type`, `jsonld-streaming-parser`,
`@rdfjs/wrapper`) stay external and are resolved by your install as normal.

## Use

```ts
import { verifyAgentAuthority } from "@jeswr/agent-authz-verifier";
import { createBitstringStatusResolver, createWebIdKeyResolver } from "@jeswr/solid-vc";

const keys = createWebIdKeyResolver({ fetch: myGuardedFetch });

const result = await verifyAgentAuthority(
  {
    credentials, // the AgentAuthorizationCredentials, any order
    policies, // the parsed ODRL policies they bind
    policyContents, // the RAW fetched policy bytes, keyed by policy IRI (G1)
  },
  {
    request: { action: "read", target, attributes: { purpose, dateTime } },
    rootPrincipal: resourceOwnerWebId,
    now: new Date(),
    resolveKey: keys.resolveKey,
    isControlledBy: keys.isControlledBy,
    resolveStatus: createBitstringStatusResolver({ ...keys, fetch: myGuardedFetch }),
    revoked: policyLevelRevocations,
    actor: authenticatedWebId,
    actorChain, // when actor ≠ the chain's leaf assignee (D9)
  },
);

if (result.authorized) {
  // result.decision (Phase D detail), result.duties, result.policyIntegrityProvisional
} else {
  // result.phase + result.code + result.reason pin the exact deny
}
```

`policyContents` MUST be the raw FETCHED document bytes — never a re-serialisation
of the parsed policy (a lossy parse→re-emit can drop triples the issuer signed
over, silently breaking or laundering the digest).

## API

- `verifyAgentAuthority(chain, options): Promise<VerifyAuthorityResult>` — the verifier.
- `readBoundAuthorization(vc): BoundAuthorization | undefined` — read the
  `svc:authorizes` / `svc:action` / `svc:target` / `svc:policy` claim from an
  AgentAuthorizationCredential (no verification — pair with Phase A).
- Types: `PresentedChain`, `VerifyAuthorityOptions`, `VerifyAuthorityResult`,
  `BoundAuthorization`, `VerifierPhase`, `VerifierErrorCode` (+ re-exported seam
  types `OdrlPolicy`, `RequestContext`, `ActiveDuty`, `DelegatedEvaluationResult`,
  `VerifiableCredential`, `PresentedResourceContent`, `CredentialStatusCheck`).
- Code sets: `PHASE_A_CODES`, `RELATED_RESOURCE_CODES`, `STATUS_GATE_CODES`.

### The error taxonomy

Every deny carries exactly one code, so a recorded decision is machine-comparable:

| Phase | Codes |
|---|---|
| assembly | `CHAIN_MALFORMED` |
| A | `MALFORMED`, `NO_PROOF`, `UNKNOWN_CRYPTOSUITE`, `INVALID_SIGNATURE`, `EXPIRED`, `NOT_YET_VALID`, `ISSUER_MISMATCH`, `PROOF_PURPOSE_MISMATCH`, `UNTRUSTED_ISSUER` |
| B | `BINDING_MISMATCH`, `POLICY_INTEGRITY` |
| C | `REVOKED`, `SUSPENDED`, `STATUS_RETRIEVAL_ERROR` |
| D | `POLICY_DENIED` |
| composition | `IDENTITY_COMPOSITION_FAILED` |

## Tests

The golden-master decision matrix from the runtime is ported here against purely
injected in-memory seams (real Ed25519 crypto, doubled key/status seams) and
reproduces the runtime's verdicts row for row — see
`test/decision-matrix.test.ts` and its snapshot. The runtime keeps the
pod-document-resolved end-to-end variant of the same matrix; the two must agree.

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

## Provenance

Extracted from `@jeswr/accountable-agent-runtime` `src/chain-verifier/` @
`72ec20a` (semantics unchanged). Security review discipline: the runtime original
was hardened over multiple adversarial review rounds (including the
identity-composition bypass its round-1 review caught); this extraction preserves
that logic verbatim and re-runs the pinned decision matrix against it.

## License

MIT © Jesse Wright
