<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-5 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/solid-odrl

Build, parse, and evaluate ODRL 2.2 policies for Solid resources and agent interactions.

> Experimental. This is a client-side policy expression and evaluation library; it does not
> enforce policies inside a Solid server.

Phase-1 writers keep emitting `https://w3id.org/jeswr/odrl-delegation#` delegation
terms. Canonical emission is deferred to phase 2 because deployed verifiers pinned
to earlier packages reject it. Policy readers accept `https://jeswr.org/ns/odrl-delegation#`,
legacy and mixed terms; contradictory parent edges are rejected. The published
`https://w3id.org/jeswr/odrl-delegation` profile identifier remains unchanged because
it identifies the protocol opt-in. The A2A adapter uses plain action verbs and has
no dependency on A2A namespace constants.

## Install

```sh
npm install github:jeswr/solid-odrl#main
```

Requires Node.js 24 or newer.

## Minimal usage

```ts
import { evaluate, parsePolicy, policyToTurtle } from "@jeswr/solid-odrl";

const policy = {
  id: "https://alice.example/policies/read",
  type: "Set" as const,
  permissions: [
    {
      type: "permission" as const,
      action: "read",
      target: "https://alice.example/private/notes.ttl",
      assignee: "https://bob.example/profile/card#me",
    },
  ],
};

const turtle = await policyToTurtle(policy);
const parsed = await parsePolicy(turtle);
if (!parsed) throw new Error("No ODRL policy found");
const result = evaluate(parsed, {
  agent: "https://bob.example/profile/card#me",
  action: "read",
  target: "https://alice.example/private/notes.ttl",
});
```

`result.decision` is `"permit"`, `"deny"`, or `"notApplicable"`; it also explains matched
rules, conflicts, and outstanding duties.

For enforcement, treat `"notApplicable"` as a default deny. Duties are advisory unless evaluation
uses `{ requireDuties: true }`; enable it when outstanding duties must block access.

## Recipient collection membership

Use standard ODRL 2.2 `odrl:isPartOf` (`http://www.w3.org/ns/odrl/2/isPartOf`)
with the `recipient` left operand and a single `odrl:PartyCollection` IRI as the
right operand. The caller supplies trusted membership through
`EvaluateOptions.resolvePartyCollection`; the evaluator never fetches collections.

```ts
import { evaluate, type OdrlPolicy } from "@jeswr/solid-odrl";

const organisation = "https://alice.example/parties/organisation";
const bob = "https://bob.example/profile/card#me";
const policy: OdrlPolicy = {
  id: "https://alice.example/policies/share-with-organisation",
  permissions: [{
    type: "permission",
    action: "distribute",
    constraints: [{
      leftOperand: "recipient",
      operator: "isPartOf",
      rightOperand: organisation,
    }],
  }],
};
const members: ReadonlySet<string> = new Set([bob]);
const result = evaluate(policy, {
  action: "distribute",
  attributes: { recipient: bob },
}, {
  resolvePartyCollection: (iri) => iri === organisation ? members : undefined,
});
// result.decision === "permit"
```

Membership uses exact IRI strings, including non-HTTP absolute IRIs. Non-members,
missing/non-IRI/array recipients, missing resolvers, unknown collections (`undefined`),
and resolver errors leave the constraint unsatisfied. A constrained permission then
does not match; if no other rule matches, the result is `"notApplicable"` (default deny).
A prohibition with a satisfied membership constraint denies under the default
conflict strategy. Unavailable membership evidence is indeterminate: if a
prohibition otherwise could apply, evaluation returns `"deny"` before conflict
resolution, including with `conflict: "perm"`. Only confirmed nonmembership or
another unsatisfied constraint rules out that prohibition. Its action, target,
and assignee must still apply to the request. Indeterminate prohibitions are not
reported as matched rules; the decision reason explains the denial.
Other left operands, array right operands, and literal
datatypes are unsupported for `isPartOf`; policy serializers reject malformed forms.
Collection RDF type declarations are not required inside the policy; the resolver
identifies the referenced PartyCollection and its members.

The resolver option also applies to `matchingPermissions`, the optional fourth
argument of `constraintSatisfied(constraint, request, now, options)`, duty constraints,
`evaluateDelegated`, and `recordEvaluation`. Supply a stable membership snapshot throughout evaluation
and recording. When calling `decisionRecord` or `decisionRecordJsonLd` separately,
pass the same `resolvePartyCollection` in their input so anonymous deciding rules
are attributed correctly. Records preserve the `isPartOf` constraint and collection IRI.

## Key API

- Express: `policyToRdf`, `policyToTurtle`, `policyToJsonLd`, `serialize`.
- Parse: `parsePolicy`, `policyFromRdf`.
- Evaluate: `evaluate`, `constraintSatisfied`, `matchingPermissions`.
- Delegation: `evaluateDelegated`, `delegationProvenance`.
- Adapters: `requestContextFromA2AIntent`, `requestContextFromWac`.

## Links

- [Source](https://github.com/jeswr/solid-odrl)
- [Issues](https://github.com/jeswr/solid-odrl/issues)
- [ODRL 2.2 Information Model](https://www.w3.org/TR/odrl-model/)
- [Delegation profile](https://github.com/jeswr/solid-odrl/blob/main/docs/delegation-profile.md)

## License

[MIT](./LICENSE) © Jesse Wright

<!-- AUTHORED-BY Codex GPT-6 -->

Explicit target (including duty targets), assignee, assigner and profile identifiers
accept clean absolute HTTP(S) IRIs and syntactically valid RFC 8141 URNs. URN NIDs
contain 2–32 ASCII letters, digits or hyphens, with alphanumeric endpoints; the NSS
is nonempty and uses RFC 8141 syntax (including valid percent escapes). Optional
r/q components and fragments follow that RFC. Identifiers are preserved exactly.
Relative references, blank-node identifiers, other schemes, empty strings, whitespace
and characters requiring `escapeIri` escaping are refused. An invalid explicit value
throws rather than disappearing and widening the policy to a wildcard.
