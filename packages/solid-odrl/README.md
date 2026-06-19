<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

# @jeswr/solid-odrl

> **Express + evaluate ODRL usage-control policies for Solid resources and agent interactions.**
> Build an [ODRL 2.2][odrl] `Policy` / `Permission` / `Prohibition` / `Duty` / `Constraint` graph
> using the **real W3C ODRL vocabulary** (`http://www.w3.org/ns/odrl/2/`), serialise/parse it
> (Turtle / JSON-LD via the suite RDF libraries), and evaluate it **client-side**: given a policy +
> a request context (agent WebID, action, target, constraints like time / purpose / recipient),
> decide **permit / deny / duty** — pure, deterministic, testable.

This is the **ODRL piece** of the [agentic-Solid roadmap][roadmap] — the expression + evaluation
layer of **M3** (*"ODRL contract negotiation between agents, attached to pod resources"*). It is the
foundation that the M3 negotiation state machine + signed-Agreement layer (`@jeswr/agent-odrl`) and
the **CORE-PSS** M5a pod-side authorizer build *on*.

> ⚠️ **Experimental, AI-agent-generated.** Not production-hardened. Models the ODRL 2.2 Information
> Model + Vocabulary (W3C Rec, 2018) and the [ODRL Formal Semantics][formal] conflict/constraint
> semantics, scoped to single-policy, single-request evaluation.

## What this is — and what it is NOT

| | |
|---|---|
| ✅ **Express** an ODRL policy as RDF (the real `odrl:` vocab; never hand-built triples). | ❌ A new policy vocabulary — it uses the W3C ODRL Rec verbatim. |
| ✅ **Parse** a policy back from Turtle / JSON-LD (lossless on the policy fields). | ❌ A SPARQL/N3 reasoner — the evaluator is a focused, pure decision function. |
| ✅ **Evaluate** a request against a policy, **client-side**, pure + deterministic. | ❌ **Server-side enforcement.** A pod-side ODRL authorizer beside WAC = **M5a = CORE-PSS** — it needs prod-solid-server `src/` changes + an ADR + maintainer approval, and is *deliberately not here*. |

The roadmap is explicit: *"the SERVER-SIDE enforcement (authorizer beside WAC) is M5a = CORE-PSS"*.
This package is the **client-side expression + evaluation library** that M5a (when approved) and the
M3 negotiation client would reuse.

## Composability

An ODRL policy attaches to **a Solid resource** and **gates an agent interaction**:

- **M1 — [`@jeswr/solid-agent-card`][m1]:** a policy's `assignee` / `assigner` is an agent WebID; a
  policy can govern access to the agent's resources.
- **M2 — [`@jeswr/solid-a2a`][m2]:** `requestContextFromA2AIntent()` turns an A2A *intent* into an
  ODRL request context, so a policy can **permit/deny an A2A action** end-to-end.
- **Solid / WAC:** `requestContextFromWac()` turns a WAC-mode request (`Read`/`Write`/…) into an ODRL
  request context, so a policy **attached to a pod resource** can be evaluated for it.

These are *structural* adapters — this package does **not** import `solid-a2a` / `solid-agent-card`;
it only mirrors their shared field shapes, so it stays a zero-coupling, separate-codebase library.

## Install

Published from a GitHub branch (the committed `dist/` makes it installable under the suite's
`ignore-scripts=true` invariant with **no build step**):

```sh
npm install github:jeswr/solid-odrl#main
```

## The public API

```ts
import {
  // express
  policyToRdf, policyToTurtle, policyToJsonLd,
  // parse (round-trip)
  parsePolicy, policyFromRdf,
  // evaluate
  evaluate, constraintSatisfied,
  // compose with the sibling packages
  requestContextFromA2AIntent, requestContextFromWac,
  // serialise raw quads
  serialize,
} from "@jeswr/solid-odrl";
```

### 1. Express a policy

```ts
const policy = {
  id: "https://alice.example/policies/p1",
  type: "Offer",                       // Set (default) | Offer | Agreement
  assigner: "https://alice.example/profile/card#me",
  conflict: "prohibit",                // perm | prohibit | invalid (default: prohibit = deny wins)
  permissions: [
    {
      type: "permission",
      action: "read",                  // odrl:read
      target: "https://alice.example/notes/private.ttl",
      assignee: "https://bob.example/profile/card#me",
      constraints: [
        { leftOperand: "purpose", operator: "eq", rightOperand: "https://w3id.org/dpv#Research" },
        { leftOperand: "dateTime", operator: "lteq", rightOperand: "2027-01-01T00:00:00Z" },
      ],
      duties: [{ action: "attribute" }],   // odrl:duty conditioning the permission
    },
  ],
  prohibitions: [{ type: "prohibition", action: "distribute", target: "https://alice.example/notes/private.ttl" }],
  obligations: [{ action: "inform", target: "https://alice.example/profile/card#me" }],
};

const turtle = await policyToTurtle(policy);   // n3.Writer — never hand-concatenated RDF
const jsonld = policyToJsonLd(policy);          // self-contained inline @context (no network)
```

### 2. Parse a policy back

```ts
const parsed = await parsePolicy(turtle);                       // text/turtle (default)
const fromJson = await parsePolicy(JSON.stringify(jsonld), "application/ld+json");
// round-trips losslessly on the policy fields (parsed via @jeswr/fetch-rdf — never a bespoke parser)
```

### 3. Evaluate a request — permit / deny / duty

```ts
const result = evaluate(
  policy,
  {
    agent: "https://bob.example/profile/card#me",
    action: "read",
    target: "https://alice.example/notes/private.ttl",
    attributes: { purpose: "https://w3id.org/dpv#Research" },   // supplies the constrained values
  },
  { now: new Date("2026-06-16T12:00:00Z") },                    // injectable clock → deterministic
);

result.decision;            // "permit" | "deny" | "notApplicable"
result.reason;              // explainable: which rule / conflict strategy drove it
result.matchedPermissions;  // the rule(s) that matched (action+target+assignee+constraints)
result.matchedProhibitions;
result.duties;              // active duties the assignee must discharge (with .fulfilled)
result.conflict;            // was the perm-vs-prohibit conflict strategy invoked?
```

## Evaluation semantics (per ODRL 2.2 + the Formal Semantics CG draft)

- **Rule match.** A rule applies when its action *implies* the requested action (`odrl:use` is the
  umbrella that covers any concrete **data-use** action), its `target` equals the requested target
  (or it has no target), its `assignee` equals the requesting agent (or it has no assignee), and
  **every** one of its constraints is **satisfied**. The `control` action (ACL-document access) is
  deliberately **outside** the `use` umbrella — a broad "permit use" data policy never grants ACL
  control (see "Solid / WAC mode mapping" below).
- **Fail-closed.** A constraint whose left-operand the request context does not supply is
  **unsatisfied** — a constrained permission never silently grants. (`dateTime` falls back to the
  injected `now`.)
- **Conflict resolution.** When a permission *and* a prohibition both match → the policy's `conflict`
  strategy decides: `perm` → permit, `prohibit` → deny, `invalid` → deny (the policy is void,
  fail-closed). The **default when unset is `prohibit`** (deny wins — the safe, ODRL-recommended
  default).
- **Duties.** Duties of a matched permission (and policy-level obligations) are reported in
  `result.duties`. By default a permit with an unfulfilled duty still permits but **reports** the
  outstanding duty (advisory). Pass `{ requireDuties: true }` to make an unfulfilled duty a **deny**.
- **Operators.** `eq` `neq` `gt` `gteq` `lt` `lteq` `isAnyOf` `isAllOf` `isNoneOf`, with type-aware
  comparison (numeric / temporal / lexical).
- **Left-operands.** `dateTime` `purpose` `recipient` `count` `spatial` `elapsedTime` `systemDevice`.

## Solid / WAC mode mapping

`requestContextFromWac()` (and the A2A verb map) translate a WAC access mode to an ODRL action
**conservatively — never broadening**. ODRL has no native action faithful to `acl:Append` or
`acl:Control`, so (following the [OAC profile][oac], which reuses the standard `acl:` mode IRIs as
the `odrl:action` value rather than minting new terms) those two map to **distinct, narrow** actions
backed by the standard ACL IRIs:

| WAC mode | ODRL action | action IRI | note |
|---|---|---|---|
| `Read` | `read` | `odrl:read` | faithful |
| `Write` | `write` | `odrl:write` | faithful |
| `Append` | `append` | `acl:Append` | add-only — a **strict subclass** of `acl:Write`; **not** `modify` |
| `Control` | `control` | `acl:Control` | governs the **ACL document**, not data use; **outside** the `use` umbrella |

This is a deliberate **security tightening** ([jeswr/sparq#890][sparq890]): previously `Append → modify`
and `Control → use` over-granted (an append-only intent compiled to full mutation; a Control request
matched any data-use permission). The mapping now maps each mode to a strictly narrower-or-equal
action, so an Append/Control request can never be widened into a broader grant. A policy written with
the correct action for a mode is unaffected; a policy that *relied* on the old over-grant (writing
`modify`/`use` to mean append/control) must now use the explicit `append`/`control` action.

[oac]: https://w3id.org/oac
[sparq890]: https://github.com/jeswr/sparq/issues/890

## RDF discipline

Parse via `@jeswr/fetch-rdf`; read/write terms via `@rdfjs/wrapper` typed accessors; serialise via
`n3.Writer`. **Never a bespoke parser; never a hand-built triple** (the suite house rule). The minted
vocabulary is **zero** — every IRI is a standard ODRL / ACL / DPV / XSD term.

## Development

```sh
npm run lint        # biome
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # esbuild bundles dist/index.js (inlining @jeswr/fetch-rdf) + tsc emits .d.ts
npm run check:dist  # guard the committed dist/ against drift from src/
npm run check:lockfile-transport  # guard package-lock.json against the SSH git transport (#78: npm install rewrites @jeswr github: deps to git+ssh, breaking npm ci)
```

The committed `dist/` is kept in sync with `src/` by `scripts/check-dist-fresh.mjs` (the suite
GitHub-installable-under-`ignore-scripts` pattern).

## License

MIT © Jesse Wright

[roadmap]: https://github.com/jeswr/prod-solid-server/blob/main/docs/design/agentic-solid-infrastructure.md
[odrl]: https://www.w3.org/TR/odrl-model/
[formal]: https://w3c.github.io/odrl/formal-semantics/
[m1]: https://github.com/jeswr/solid-agent-card
[m2]: https://github.com/jeswr/solid-a2a
