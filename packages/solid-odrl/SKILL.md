---
name: solid-odrl
description: Use when building, parsing, evaluating, or recording ODRL usage policies, including recipient PartyCollection membership through an injected resolver.
---

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# ODRL policies and recipient collections

Read the repository [AGENTS.md](../../AGENTS.md) and this package's
[README](README.md). This package is security-critical. Keep policy evaluation
pure and deny by default unless the result is `permit`; `notApplicable` grants
nothing. Duties are advisory unless `requireDuties: true` is supplied.

Use `policyToRdf`, `policyToTurtle`, and `policyToJsonLd` to express policies, and
`parsePolicy`/`policyFromRdf` to read them. Parsing uses `@jeswr/fetch-rdf`, RDF
access uses the typed wrappers in `src/wrappers.ts`, and serialization uses
`n3.Writer` through `serialize`. Use these paths in tests and examples too; never
hand-build triples or concatenate Turtle.

## Recipient membership

Express membership as an `OdrlConstraint` with `leftOperand: "recipient"`,
`operator: "isPartOf"`, and `rightOperand` equal to one absolute PartyCollection
IRI. This uses standard ODRL 2.2 terms (`ODRL_IS_PART_OF` exports
`http://www.w3.org/ns/odrl/2/isPartOf`); mint no collection operators or vocabulary.
The request supplies one absolute recipient IRI in `attributes.recipient`.

Inject `EvaluateOptions.resolvePartyCollection` with signature
`(collectionIri: string) => ReadonlySet<string> | undefined`. Return a trusted,
stable snapshot of the collection's party IRIs, or `undefined` for unknown
collections. Membership is exact lexical IRI equality; do not normalize WebIDs
or infer membership from their origin. The evaluator never fetches or requires
an RDF type declaration for the collection inside the policy.

Fail closed: a missing resolver, unknown/empty collection, resolver exception,
non-member, missing/non-IRI/array recipient, or malformed collection operand
cannot satisfy membership. Only `recipient` is supported with `isPartOf`, and
its right operand must be a single IRI without a literal datatype. Serializers
reject unsupported forms. The parser retains malformed membership as an
unsatisfied constraint rather than dropping it and widening a permission.

Permissions and duties require positively satisfied membership. For prohibitions,
missing/invalid operands or unavailable membership evidence are indeterminate,
distinct from confirmed nonmembership. An otherwise applicable indeterminate
prohibition forces `deny` before conflict resolution, even with `conflict: "perm"`.
A mismatched action, target, assignee, or another unsatisfied constraint rules out
the prohibition. Only confirmed matches appear in `matchedProhibitions`; the
decision reason explains indeterminate denials. A satisfied prohibition denies
under the default `prohibit` conflict strategy. With no matching or indeterminate
rules, `evaluate` returns `notApplicable`; enforcement callers must default deny.

The resolver flows through `evaluate`, `evaluateDelegated`, `matchingPermissions`, duty constraints,
`constraintSatisfied(c, request, now, options)`, and `recordEvaluation`.
For separate `decisionRecord`/`decisionRecordJsonLd` calls, pass the same resolver
in `DecisionRecordInput.resolvePartyCollection` and the same evaluation clock in
`evaluatedAt`. Keep the snapshot stable across these calls so anonymous rules
resolve to the constraints that actually decided the result. Prefer
`recordEvaluation` to pass the clock and resolver together automatically.

## Verification

Cover members and non-members, resolver absence/failure, malformed operands,
prohibitions, duties, RDF round trips, and decision-record attribution with fixture
tests. Run the package lint, build, typecheck, and test scripts in that order;
follow the repository's affected and full gate requirements before finishing.
