<!-- AUTHORED-BY Claude Fable 5 -->

# Design decisions — @jeswr/solid-odrl

One entry per non-obvious design call: what was chosen, the alternatives, and
why. Newest at the bottom. (File established with the agent-delegation profile;
earlier design rationale lives in the source-file headers and commit messages.)

## Agent-delegation profile (docs/delegation-profile.md)

### D1. `nextPolicy` as a duty ACTION, not a minted property

**Chosen:** express the mandated downstream policy as ODRL 2.2 does — a duty on
the `grantUse` permission whose `odrl:action` is `odrl:nextPolicy` and whose
`odrl:target` is the downstream Policy.
**Alternatives:** (a) mint `odrld:nextPolicy` as a Rule→Policy property (the
ODRL 2.1 shape); (b) put the downstream policy inline.
**Why:** in the ODRL 2.2 Vocabulary (verified against the published TTL and
`https://www.w3.org/ns/odrl.jsonld`), `nextPolicy` is an **Action** concept —
there is no property form — so the duty shape is the standard-conformant one
and needs zero new model fields (`OdrlDuty` already has `action` + `target`).

### D2. Delegation actions excluded from the `use` umbrella (profile restriction)

**Chosen:** `grantUse`, `nextPolicy` (and `transfer`) never match under a `use`
permission; delegation authority requires a literal `grantUse` rule
(`NOT_UNDER_USE` in `src/vocab.ts`; spec §3.2).
**Alternatives:** follow the vocabulary's *"Included In: use"* literally.
**Why:** followed literally, every `use`-grantee could re-delegate the asset —
a privilege escalation for usage control. Restriction is deny-biased, so a
conforming evaluator only ever permits less than core semantics; same posture
as the earlier `control`-outside-`use` fix.

### D3. Per-request intersection instead of syntactic policy-subset

**Chosen:** "the delegate's effective permissions are the intersection of the
chain" is enforced per concrete request: the actual request must be permitted by
the leaf AND by every ancestor for its own delegate, plus not directly
prohibited anywhere (spec §6).
**Alternatives:** prove hop_{i+1} ⊆ hop_i syntactically at issue time.
**Why:** syntactic subset over arbitrary constraint languages is intractable
and any approximation risks over-granting; per-request intersection is
decidable, cheap (O(chain length) evaluations) and can only under-grant.

### D4. Default re-delegation depth = 1

**Chosen:** a `grantUse` permission with no `odrld:delegationDepth` constraint
authorises exactly ONE hop (the delegate may not re-delegate).
**Alternatives:** (a) unlimited depth by default; (b) require the constraint
always.
**Why:** (a) is fail-open — an owner who wrote a bare `grantUse` almost
certainly meant "you may enlist a sub-agent", not "build me an arbitrary
authority tree". (b) rejects the vocabulary's own bare-`grantUse` idiom.
Depth 1 keeps the bare idiom meaningful and errs closed.

### D5. `delegationDepth` as a walker-reserved LEFT OPERAND

**Chosen:** the depth bound is an ordinary ODRL constraint on the `grantUse`
rule; the chain evaluator injects the TRUE remaining depth as the request value
(and strips any caller-asserted value).
**Alternatives:** bespoke depth fields outside the constraint model.
**Why:** reuses the whole existing constraint machinery (serialisation,
round-trip, operators — `lteq`/`lt`/`eq` all work), keeps `evaluate()` itself
untouched (the base decision matrix stays byte-identical), and is fail-closed
outside the walker: nothing else supplies the operand, so a depth-constrained
`grantUse` can never match a plain evaluation.

### D6. Mint `odrld:delegatedUnder` ⊑ `prov:wasDerivedFrom`

**Chosen:** an explicit upstream authority edge, declared a subproperty of
`prov:wasDerivedFrom`.
**Alternatives:** (a) reuse `prov:wasDerivedFrom` bare; (b) reconstruct the
chain from the parents' `nextPolicy` duties only.
**Why:** (a) is semantically too loose for a fail-closed authority check (any
derivation asserts it); (b) fails for the common no-`nextPolicy` case and makes
the leaf non-self-describing. The subproperty keeps generic PROV consumers in
the loop for free.

### D7. `nextPolicy` mandate = policy IDENTITY (child.id === duty.target)

**Chosen:** when the authorising `grantUse` carries a `nextPolicy` duty, the
delegated hop MUST BE the referenced policy.
**Alternatives:** allow a *different* child policy if it can be shown narrower
than the referenced one (via a caller-supplied resolver seam).
**Why:** the IM's intent is "the policy that MUST be used for third-party
grants"; identity is exact, decidable, and needs no I/O or resolver trust. A
resolver-based narrowing check re-imports the D3 subset problem. If a genuine
need appears, a resolver seam can be added compatibly (it can only widen what
currently denies).

### D8. Revocation = caller-supplied revoked set + minted RDF form; no I/O

**Chosen:** `evaluateDelegated` takes `options.revoked` (policy IRIs); the RDF
form (`odrld:Revocation`/`odrld:revokedPolicy`) is specified for publication,
but the evaluator never fetches.
**Alternatives:** (a) evaluator fetches revocation lists; (b) no revocation
(expiry only).
**Why:** (a) breaks the package's pure/deterministic/no-I/O contract and would
embed a trust policy (whose lists? how fresh?) that belongs to the caller; (b)
leaves an owner unable to withdraw a compromised sub-agent's grant before
expiry — unacceptable for the accountability story. Trust rule (only the
assigner's revocations count) is spec'd (§7) for the layer that gathers them.

### D9. Two-valued delegated result (permit/deny, no notApplicable)

**Chosen:** `evaluateDelegated` never returns `notApplicable`.
**Why:** the tri-state exists so a caller can layer defaults over a single
policy; a delegation chain is presented as the PROOF of a grant — a chain that
doesn't prove it is a deny, and letting callers default around it invites
fail-open composition. (The single-policy chain keeps `evaluate()`'s tri-state
available via the plain API when needed.)

### D10. Explicit-assignee requirement on the authorising `grantUse`

**Chosen:** an assignee-free `grantUse` permission does not authorise any edge.
**Why:** an assignee-free rule matches EVERY agent in the core evaluator; for
delegation authority that means "anyone may re-delegate", which is almost
always an authoring accident. Requiring the delegator to be named (directly or
via policy-level assignee inheritance) keeps authority individually granted.

### D11. `requireDuties` gates the AGGREGATE chain duties

**Chosen:** duties from every matched ancestor grant accumulate with the
leaf's; `requireDuties` is applied to the union at the chain level.
**Why:** delegation must not shed conditions — if the root permission required
attribution, the sub-agent inherits that requirement; gating only the leaf's
duties would let a delegator launder a conditioned grant into an unconditioned
one.

### D12. A2A `grant` verb mapping left at `control` (not remapped to `grantUse`)

**Chosen:** `A2A_ACTION_TO_ODRL.grant` still maps to `control`.
**Why:** the A2A `grant` verb means "change access control on the resource"
(an ACL-document operation), which is exactly `acl:Control`; ODRL `grantUse`
means "issue a downstream USAGE policy" — different operation. Remapping would
also change the pinned compose golden master for no semantic gain. An A2A verb
for delegation, if needed, is a new verb mapped to `grantUse` (follow-up).

### D13. JSON-LD `@context` extension is CONDITIONAL

**Chosen:** the `odrld:` context terms are added to an emitted JSON-LD document
only when the policy actually uses one (currently `delegatedUnder`).
**Why:** keeps every pre-profile policy's JSON-LD projection — including its
`@context` — byte-identical (the golden master proves it), and honours the
"the profile must not change any non-delegation output" contract.

### D14. `revoked` typed as array/Set, never `Iterable<string>`

**Chosen:** `DelegationEvaluateOptions.revoked` is `readonly string[] |
ReadonlySet<string>`, with a runtime bare-string guard.
**Alternatives:** the looser `Iterable<string>`.
**Why:** a bare string IS an `Iterable<string>`, so `revoked: oneIri` would
typecheck yet iterate as CHARACTERS — silently disabling revocation
(fail-open). Excluding strings at the type level plus a runtime guard for
plain-JS callers keeps the misuse impossible; found in adversarial self-review,
regression-tested.

### D15. Prohibitions are STRICT in a delegation chain (perm-conflict override ignored)

**Chosen:** in a chain of ≥ 2 policies, a MATCHED prohibition at any hop (scope
check, direct check, grantUse authorization, leaf) denies — even where that
hop's own `conflict: "perm"` strategy would override it for direct use. A
single-policy chain keeps the policy's declared conflict semantics.
**Alternatives:** honour each hop's conflict strategy uniformly (the original
behaviour — flagged as a High by roborev/codex: the documented "never launder
around an upstream prohibition" rule was weaker than stated under
`odrl:perm`).
**Why:** the profile's posture is deny-biased; strictness here costs nothing a
policy author is entitled to (an agent whose direct access is genuinely
perm-permitted can still act DIRECTLY via `evaluate()`), and it removes the
one path where a prohibited request could succeed by being routed through a
delegation chain.

### D16. grantUse-edge duties join the aggregate duty set

**Chosen:** the duties of the authorising `grantUse` evaluation (minus the
structurally-enforced `nextPolicy` duties) are aggregated with the scope + leaf
duties, so `requireDuties` gates on them and callers see them.
**Alternatives:** discard them (the original behaviour — flagged as a Medium by
roborev/codex: a "duty-conditioned" delegation authority was silently
unconditioned).
**Why:** a duty on the delegation authority (e.g. *inform the owner when
delegating*) conditions everything delegated under it; dropping it sheds a
condition, violating the §6.3 duties-accumulate rule.

### D17. Edge duties come from ALL valid authorizing candidates (conjunctive)

**Chosen:** when several `grantUse` rules validly authorise the same edge, the
duties of EVERY one of them aggregate (candidates that failed the profile
checks, and non-candidate matched rules, still contribute nothing).
**Alternatives:** (a) aggregate `auth.duties` wholesale (round-2 state —
leaked failed candidates' duties, roborev Medium); (b) only the first passing
candidate's duties (round-2 fix — dropped later valid candidates' duties,
roborev round-3 Medium).
**Why:** (b) was inconsistent with the core evaluator's pinned semantics,
where the duties of ALL matched permissions aggregate and `requireDuties`
gates on each; matching it is deny-biased and gives policy authors one mental
model for duty conjunction. Regression tests pin all three behaviours (failed
candidate excluded; every valid candidate included; `nextPolicy` structural).
