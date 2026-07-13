<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-odrl

Build, parse, and evaluate ODRL 2.2 policies for Solid resources and agent interactions.

> Experimental. This is a client-side policy expression and evaluation library; it does not
> enforce policies inside a Solid server.

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
