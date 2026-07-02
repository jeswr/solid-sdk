<!-- AUTHORED-BY Claude Fable 5 -->

# The ODRL Agent-Delegation Profile

**Profile IRI:** `https://w3id.org/jeswr/odrl-delegation`
**Term namespace (`odrld:`):** `https://w3id.org/jeswr/odrl-delegation#`
**Status:** Draft profile specification, implemented by `@jeswr/solid-odrl`
(`evaluateDelegated`, `delegationProvenance`). Experimental, AI-agent-generated.

This document specifies an [ODRL 2.2](https://www.w3.org/TR/odrl-model/) profile
for **agent delegation**: how an agent that holds permissions over a resource
grants a sub-agent a *subset* of those permissions, such that

1. the sub-agent's effective permissions can never exceed the delegator's
   (conservative subset semantics, [§6](#6-subset-semantics-the-chain-intersection)),
2. the authority to delegate is itself an explicit, bounded, expirable and
   revocable grant ([§5](#5-chain-validity), [§7](#7-expiry-and-revocation)), and
3. every delegated action is traceable to the delegating principal through a
   standard [PROV-O](https://www.w3.org/TR/prov-o/) attribution trail
   ([§8](#8-prov-o-attribution-the-accountability-trail)) — the accountability
   story of the agentic-Solid roadmap.

The profile follows the ODRL profile mechanism (ODRL Information Model 2.2,
[§2.1 "Profiles"](https://www.w3.org/TR/odrl-model/#profile); see also the ODRL
CG's [Profile Best Practices](https://w3c.github.io/odrl/profile-bp/)): a policy
opts in by asserting `odrl:profile <https://w3id.org/jeswr/odrl-delegation>`.
Standard ODRL terms are used verbatim wherever the standard provides one; the
profile mints terms **only** for genuine gaps, each listed with its rationale in
[§4](#4-minted-terms-odrld).

The key words MUST, MUST NOT, SHOULD and MAY are to be interpreted as described
in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

---

## 1. Motivation

An autonomous agent acting for a person (or another agent) frequently needs to
enlist a sub-agent for part of its task — a research agent hands a summarisation
sub-agent read access to one dataset; an operations agent hands a scheduler
append access to one calendar. Access-control alone (WAC/ACP) answers *"may this
request proceed?"*; it does not express *"who allowed this agent to allow that
agent?"* — the question an accountability audit asks. ODRL 2.2 already contains
the raw machinery for downstream granting (`odrl:grantUse`, `odrl:nextPolicy`,
Offer/Agreement, assigner/assignee) but leaves the *chain* semantics — depth
bounds, upstream authority links, revocation, verification order — unspecified.
This profile pins those semantics, fail-closed.

## 2. The delegation model

A **delegation chain** is an ordered, acyclic list of ODRL policies, **root
first**:

```
chain[0]   the ROOT grant — the originating policy (typically issued by the
           resource owner). Any policy subtype; SHOULD be an odrl:Agreement
           between the owner (odrl:assigner) and the first agent (odrl:assignee).
chain[i]   (i ≥ 1) a DELEGATED HOP — an odrl:Agreement issued by the previous
           hop's grantee: odrl:assigner = the delegator (the agent that held the
           permission), odrl:assignee = the delegate (the sub-agent), declaring
           odrld:delegatedUnder <chain[i-1]> (§4.2).
```

Two standard ODRL constructs carry the delegation authority:

- **`odrl:grantUse`** (ODRL Vocabulary 2.2,
  [§4.4.22](https://www.w3.org/TR/odrl-vocab/#term-grantUse) — *"To grant the
  use of the Asset to third parties"*; the vocabulary's note reads *"This action
  enables the assignee to create policies for the use of the Asset for third
  parties. The nextPolicy is recommended to be agreed with the third party. Use
  of temporal constraints is recommended."*). A permission whose action is
  `grantUse` is what authorises its assignee to issue a delegated hop.
- **`odrl:nextPolicy`** (ODRL Vocabulary 2.2,
  [§4.4.29](https://www.w3.org/TR/odrl-vocab/#term-nextPolicy) — *"To grant the
  specified Policy to a third party for their use of the Asset"*). In ODRL 2.2
  `nextPolicy` is an **Action** concept, not a property; it is used here as the
  action of a **duty on the `grantUse` permission** whose `odrl:target` is the
  downstream Policy the delegate must issue ([§5.2.6](#52-per-edge-checks)).
  (`odrl:transfer` — ODRL Vocabulary
  [§3.12.2](https://www.w3.org/TR/odrl-vocab/#term-transfer), *ownership*
  transfer in perpetuity — is exposed by the library for completeness but is NOT
  part of the delegation chain semantics: delegation shares use, it never moves
  ownership.)

An `odrl:Offer` MAY be used to *propose* a delegation (the delegator publishes
the offered downstream policy); a hop only becomes part of a valid chain once it
is concluded as an `odrl:Agreement` naming both parties
([§5.2.1](#52-per-edge-checks)).

## 3. Vocabulary

### 3.1 Standard terms used verbatim

| Term | Role in this profile | Source |
|---|---|---|
| `odrl:Agreement`, `odrl:Offer` | the hop policy subtypes | [ODRL IM §2.4](https://www.w3.org/TR/odrl-model/#policy-agreement) |
| `odrl:assigner` / `odrl:assignee` | delegator / delegate per hop | [ODRL IM §2.5](https://www.w3.org/TR/odrl-model/#function) |
| `odrl:grantUse` | the delegation-authority action | [ODRL Vocab §4.4.22](https://www.w3.org/TR/odrl-vocab/#term-grantUse) |
| `odrl:nextPolicy` | duty action pinning the mandated downstream policy | [ODRL Vocab §4.4.29](https://www.w3.org/TR/odrl-vocab/#term-nextPolicy) |
| `odrl:dateTime` constraints | hop expiry ([§7](#7-expiry-and-revocation)) | [ODRL Vocab §2.9.4](https://www.w3.org/TR/odrl-vocab/#term-dateTime) |
| `prov:wasAttributedTo`, `prov:actedOnBehalfOf`, `prov:wasDerivedFrom` | the attribution trail ([§8](#8-prov-o-attribution-the-accountability-trail)) | [PROV-O](https://www.w3.org/TR/prov-o/) |

### 3.2 Profile restriction: delegation actions are NOT under the `use` umbrella

The ODRL 2.2 Vocabulary marks `grantUse` and `nextPolicy` as *"Included In:
use"*. Followed literally in an evaluator, a bare `odrl:use` permission would
therefore authorise its assignee to **re-delegate** the asset — a privilege
escalation in a usage-control setting (every use-grantee could mint downstream
grants for arbitrary third parties).

This profile RESTRICTS the action hierarchy: a processor conforming to this
profile MUST NOT treat a `use` (or any non-`grantUse`) permission as matching a
`grantUse` request; delegation authority MUST be granted by a rule whose action
is literally `odrl:grantUse` (the same restriction applies to `nextPolicy` and
`transfer`). Restricting matching is deny-biased and therefore safe relative to
core semantics: a conforming evaluator can only ever permit **less** than a
core-vocabulary evaluator would. (Design record: `docs/DECISIONS.md` D2.)

## 4. Minted terms (`odrld:`)

Each term below is minted because ODRL 2.2 offers no term with the required
semantics. Nothing else is minted.

### 4.1 `odrld:delegationDepth` (LeftOperand)

The number of delegation hops remaining **at and below** a `grantUse`
permission. Used as `odrld:delegationDepth odrl:lteq N` on a `grantUse`
permission to bound re-delegation: `N = 1` allows the delegate to be granted but
not to re-delegate; `N = 2` allows one further level; and so on.

*Gap:* ODRL 2.2's left-operand list has no depth concept. `odrl:count` is the
nearest term but counts *exercises of an action*, not the depth of a downstream
chain — reusing it would be a semantic pun that breaks genuine count constraints
on the same rule.

*Reserved operand:* the request value for `delegationDepth` is supplied
exclusively by the chain evaluator (the true number of remaining hops,
[§5.2.5](#52-per-edge-checks)); a conforming evaluator MUST ignore
caller-asserted `delegationDepth` values. Absent the constraint, the default
budget is **1** ([§5.2.5](#52-per-edge-checks)) — fail-closed.

### 4.2 `odrld:delegatedUnder` (ObjectProperty; Policy → Policy)

Declared by a delegated hop: *"this policy was issued under the authority of
that policy"*. `rdfs:subPropertyOf prov:wasDerivedFrom`.

*Gap:* `odrl:nextPolicy` points *downstream* from the delegator's duty; ODRL has
no *upstream* authority link. A verifier holding a leaf grant needs the explicit
reverse edge to assemble and check the chain, and `prov:wasDerivedFrom` alone is
too loose (any derivation whatsoever) for a fail-closed authority check.
Declaring the subproperty keeps every authority edge visible to generic PROV
consumers at no extra cost.

### 4.3 `odrld:Revocation` (Class) and `odrld:revokedPolicy` (ObjectProperty)

A revocation statement: `[] a odrld:Revocation ; odrld:revokedPolicy <policy>`,
published by the revoking assigner (e.g. as a resource in their pod, beside the
policy it withdraws). See [§7](#7-expiry-and-revocation) for the trust rule.

*Gap:* ODRL 2.2 has no revocation vocabulary at all — expiry is expressible via
`odrl:dateTime` constraints; withdrawal-before-expiry is not.

## 5. Chain validity

A conforming evaluator (implemented as `evaluateDelegated(chain, request,
options)`) MUST evaluate **fail-closed**: the decision is `permit` only if every
check below affirmatively passes; any malformed, ambiguous or unverifiable
condition yields `deny`. The result is deliberately two-valued — a delegated
request either proves its grant or it does not; there is no `notApplicable`
fall-through for a caller to default around.

### 5.1 Chain-level checks

1. The chain MUST be non-empty and MUST NOT exceed the evaluator's absolute
   length cap (implementation default: 8 policies including the root).
2. Every policy MUST have an IRI (`odrl:uid`); no IRI may appear twice
   (**acyclicity** — a cycle can otherwise manufacture unbounded authority).
3. No policy IRI may be in the caller-supplied revoked set
   ([§7](#7-expiry-and-revocation)).

### 5.2 Per-edge checks

For every edge `chain[i-1] → chain[i]` (`i ≥ 1`), with *remaining depth* `r =
length − i` (the edge itself plus every edge below it):

1. `chain[i]` MUST be an `odrl:Agreement` (a concluded grant between named
   parties — an Offer or Set is not yet a delegation).
2. `chain[i]` MUST name both `odrl:assigner` (the delegator) and `odrl:assignee`
   (the delegate).
3. `chain[i]` MUST declare `odrld:delegatedUnder <chain[i-1]>` exactly.
4. `chain[i-1]` MUST **permit** the request `{agent: chain[i].assigner, action:
   grantUse, target: request.target}` at evaluation time — full ODRL evaluation,
   so prohibitions on `grantUse` and the policy's conflict strategy are
   honoured — AND at least one matching `grantUse` permission MUST carry an
   **explicit assignee** equal to `chain[i].assigner`. An assignee-free
   `grantUse` (anyone may delegate) does NOT authorise an edge: delegation
   authority is granted individually.
5. **Depth budget:** if the authorising `grantUse` permission carries an
   `odrld:delegationDepth` constraint, it is evaluated against the true
   remaining depth `r` (injected by the evaluator; caller-asserted values are
   stripped). If it carries none, the budget defaults to **1**, so `r > 1`
   fails. A hop can therefore never obtain more depth than its parent granted,
   and the root's budget bounds the whole subtree.
6. **Mandated `nextPolicy`:** every duty on the authorising `grantUse`
   permission whose action is `nextPolicy` MUST have a target, and the delegated
   hop's IRI MUST equal it — the delegator granted *exactly* the mandated
   policy, which then itself (being in the chain) governs everything below.
   A `nextPolicy` duty with no target, or a delegated hop that is not the
   mandated policy, fails the edge.

## 6. Subset semantics: the chain intersection

A delegate's effective permissions are the **intersection** of the whole chain,
enforced per request (deciding syntactic policy-subset in general is
intractable over arbitrary constraints; per-request intersection is decidable
and can never over-grant):

1. **Scope:** for every ancestor `chain[i]` (`i < length−1`), the evaluator
   re-evaluates the *actual request* with the agent replaced by that hop's
   delegate (`chain[i+1].assigner`) and requires `permit` — i.e. the capability
   being exercised must itself have been granted at every level. An ancestor
   that yields `deny` **or** `notApplicable` fails the chain (an ancestor that
   never granted the capability cannot have delegated it). Action subsumption
   applies as in the core evaluator (e.g. an ancestor `write` grant covers a
   delegated `append` request; the reverse never holds).
2. **Prohibitions:** additionally, an ancestor that *directly prohibits* the
   actual request (evaluated with the real requesting agent) fails the chain —
   delegation must never launder a request around an upstream prohibition.
3. **Duties accumulate:** the duties imposed by every matched ancestor grant
   plus the leaf's are aggregated into the result — delegation never sheds a
   duty. Under `requireDuties`, the aggregate must be discharged for the permit
   to stand.

Finally the **leaf** policy itself must permit the actual request (the
delegate's own grant, with its own constraints, at evaluation time).

## 7. Expiry and revocation

**Expiry** is expressed with standard `odrl:dateTime` constraints (as the
`grantUse` vocabulary note recommends) and interacts with the chain as follows:
a temporal constraint on a **`grantUse` permission** expires the *authority to
delegate* (the edge check fails from that instant, taking every hop below it
down); a temporal constraint on an **ordinary permission** expires the
*capability* (the scope/leaf checks fail). Both are evaluated at the injected
evaluation instant, so an expired **middle** hop invalidates the whole suffix of
the chain — exactly the containment an owner expects.

**Revocation** withdraws a policy before expiry. The revoking assigner publishes
an `odrld:Revocation` statement ([§4.3](#43-odrldrevocation-class-and-odrldrevokedpolicy-objectproperty));
the party relying on the chain gathers applicable revocations and passes their
`odrld:revokedPolicy` IRIs to the evaluator (`options.revoked`) — the evaluator
itself performs no I/O, so revocation freshness is the caller's trust decision
(how recently it fetched, from where). A revocation statement SHOULD only be
trusted when attributed to the revoked policy's own assigner (or an ancestor
assigner in its chain). Revoking a hop denies every chain that contains it;
hops above it are unaffected.

Because a delegated hop is only valid while its whole ancestry is valid, an
owner can cut off an entire delegation subtree by revoking (or letting expire)
the single hop at its head.

## 8. PROV-O attribution: the accountability trail

Every hop carries a standard [PROV-O](https://www.w3.org/TR/prov-o/) attribution
triple set (emitted by `delegationProvenance(chain)`), so that a delegated
action is auditable back to the delegating principal with plain PROV tooling:

```turtle
# per hop i (chain[i], i ≥ 1); chain[0] gets its attribution triple only
<policy_i>    prov:wasAttributedTo   <assigner_i> .      # who issued the hop
<policy_i>    odrld:delegatedUnder   <policy_{i-1}> .    # the authority edge (§4.2)
<policy_i>    prov:wasDerivedFrom    <policy_{i-1}> .    # its PROV super-property
<assignee_i>  prov:actedOnBehalfOf   <assigner_i> .      # agent-level delegation
```

When the delegate finally **acts**, the acting system SHOULD record the action
as a `prov:Activity` that `prov:wasAssociatedWith` the delegate and
`prov:used`/`prov:generated` the affected resources, with the leaf Agreement as
the plan (`prov:qualifiedAssociation [ prov:agent <delegate>; prov:hadPlan
<leaf-policy> ]`). Walking `prov:hadPlan` → `odrld:delegatedUnder*` →
`prov:wasAttributedTo` then answers the audit question — *which principal's
authority does this action trace to?* — in standard vocabulary end to end.

## 9. Worked example

Alice (owner `O`) grants her research agent `A` read access to a dataset and
the authority to delegate it one further level, mandating exactly what may be
passed on; `A` delegates read to summariser `B`:

```turtle
@prefix odrl:  <http://www.w3.org/ns/odrl/2/> .
@prefix odrld: <https://w3id.org/jeswr/odrl-delegation#> .

<https://alice.example/policies/root> a odrl:Agreement ;
  odrl:profile <https://w3id.org/jeswr/odrl-delegation> ;
  odrl:uid <https://alice.example/policies/root> ;
  odrl:assigner <https://alice.example/profile/card#me> ;
  odrl:permission [
    odrl:action odrl:read ;
    odrl:target <https://alice.example/data/records.ttl> ;
    odrl:assignee <https://agent-a.example/id#it>
  ] , [
    odrl:action odrl:grantUse ;
    odrl:target <https://alice.example/data/records.ttl> ;
    odrl:assignee <https://agent-a.example/id#it> ;
    odrl:constraint [
      odrl:leftOperand odrld:delegationDepth ;
      odrl:operator odrl:lteq ;
      odrl:rightOperand 1
    ] ;
    odrl:duty [
      odrl:action odrl:nextPolicy ;
      odrl:target <https://agent-a.example/policies/to-b>
    ]
  ] .

<https://agent-a.example/policies/to-b> a odrl:Agreement ;
  odrl:profile <https://w3id.org/jeswr/odrl-delegation> ;
  odrl:uid <https://agent-a.example/policies/to-b> ;
  odrld:delegatedUnder <https://alice.example/policies/root> ;
  odrl:assigner <https://agent-a.example/id#it> ;
  odrl:assignee <https://agent-b.example/id#it> ;
  odrl:permission [
    odrl:action odrl:read ;
    odrl:target <https://alice.example/data/records.ttl> ;
    odrl:assignee <https://agent-b.example/id#it>
  ] .
```

`B`'s read request evaluates `permit` against the chain `[root, to-b]`; `B`
re-delegating to anyone evaluates `deny` (depth 1 exhausted); `B` requesting
`write` evaluates `deny` (outside the intersection); after Alice publishes a
revocation of `to-b`, every request over the chain evaluates `deny`. The full
decision matrix is pinned as golden-master snapshots in
`test/characterization.test.ts` ("delegation decision matrix").

## 10. Relationship to Verifiable Credentials (the Phase-2 standards pairing)

This profile defines the **policy** half of agent authorization: what a
delegation grants, bounded how, verified in what order. The **credential** half —
a portable, signed proof that a delegation was issued (W3C [Verifiable
Credentials 2.0](https://www.w3.org/TR/vc-data-model-2.0/) carrying the hop
Agreement, signed by the delegator via `@jeswr/solid-vc`) — is deliberately out
of scope here and is the subject of the planned CCG agent-authorization
credential note: the credential attests *issuance and integrity* of a hop;
this profile decides *validity and scope* of the chain. The two compose:
`credentialSubject` carries the hop policy; verification checks the signature
chain, then evaluates the policy chain with this profile. Revocation likewise
pairs (`odrld:Revocation` ↔ VC credential-status mechanisms).

## 11. Conformance

A **conforming policy** asserts the profile IRI and satisfies the structural
requirements of §2, §4 and §5.2.1–3. A **conforming evaluator** implements
§5–§7 fail-closed and treats `odrld:delegationDepth` as a reserved operand
(§4.1). The reference implementation is this package's `evaluateDelegated`,
whose behaviour is pinned by the delegation decision matrix
(`test/characterization.test.ts`) and the adversarial unit suite
(`test/delegation.test.ts`).

## 12. References

- ODRL Information Model 2.2, W3C Recommendation, 15 Feb 2018 —
  <https://www.w3.org/TR/odrl-model/>
- ODRL Vocabulary & Expression 2.2, W3C Recommendation, 15 Feb 2018 —
  <https://www.w3.org/TR/odrl-vocab/> (Grant Use §4.4.22; Next Policy §4.4.29;
  Transfer Ownership §3.12.2)
- ODRL RDF ontology — <https://www.w3.org/ns/odrl/2/ODRL22.ttl>
- ODRL Profile Best Practices (ODRL CG) — <https://w3c.github.io/odrl/profile-bp/>
- PROV-O: The PROV Ontology, W3C Recommendation, 30 Apr 2013 —
  <https://www.w3.org/TR/prov-o/>
- Verifiable Credentials Data Model 2.0, W3C —
  <https://www.w3.org/TR/vc-data-model-2.0/>
- Web Access Control (Solid) — <https://solidproject.org/TR/wac>
