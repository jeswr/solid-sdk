<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Proactive origin API behavior report: @jeswr/solid-auth-core

This focused report records runtime defaults; the TypeScript signatures are unchanged.
Entry point: `@jeswr/solid-auth-core`.

```ts
export function deriveProactiveAllowedOrigins(
  inputs: ProactiveAllowedOriginsInputs,
): ReadonlySet<string>;
```

| Input | Behavior when supplied |
| --- | --- |
| `podRoot` | Include the pod/storage origin, even when it shares the issuer origin. |
| `extraOrigins` | Include additional explicit resource origins. |
| `webId` | Include its origin unless `includeWebIdOrigin` is false; disable for a WebID document outside the pod. |
| `issuer` | Exclude its origin unless `includeIssuerOrigin` is true. |
| `includeIssuerOrigin` | **Default false**, changed from true. Explicit true opts in; false excludes issuer-derived admission. |
| `allowInsecureLoopback` | Default false. Only explicit true permits loopback HTTP origins. |

All admitted origins pass `computeAllowedOrigins` validation: HTTPS by default, invalid URLs
and other schemes dropped, empty result authenticates nothing. An issuer origin independently
admitted through resource inputs stays allowed. `computeAllowedOrigins` itself still defaults
`includeIssuerOrigin` to true for its separate credential boundary.
