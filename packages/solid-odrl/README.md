<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-5 -->

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
