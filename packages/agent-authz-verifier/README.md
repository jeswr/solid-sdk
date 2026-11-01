<!-- AUTHORED-BY Codex GPT-5 -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/agent-authz-verifier

Fail-closed verification of agent authorization chains composed from signed credentials and ODRL delegation policies.

The package performs no network I/O. Key control and credential-status checks enter only through
injected seams, so a decision can be reproduced independently.

Each hop's policy is evaluated as parsed from its signed policy content, not from the presented
policy object. The parsed policy must re-serialise to exactly the signed graph; content the ODRL
projection cannot fully represent denies with `POLICY_INTEGRITY`, as does a scalar operator (`eq`,
`lteq`, …) with several right operands, since a graph does not order them. A hop presented without content
denies unless `allowProvisionalPolicy: true` is set, which marks the permit
`policyIntegrityProvisional`.

`isControlledBy` is required, and an invalid `now`, `revoked` or `maxChainLength` denies with
`INVALID_OPTIONS`. The chain-length cap (default 8) applies before any key is resolved. An unknown
request action, a multi-valued or malformed request attribute, a value for an operand the chain
compares as an instant (`dateTime`, or any constraint typed `xsd:dateTime`/`xsd:date`) that is not a
dateTime string with a timezone, a signed temporal bound that is not an instant (it would compare as
text), or a chain prohibition that may apply but constrains an operand the request leaves out,
denies in Phase D, as does any evaluator failure. The prohibition check probes each policy exactly
as the delegation walk reads it (the same agent, action and injected `delegationDepth`), dropping
only the constraints whose operand is missing, so a prohibition assigned to someone else or out of
depth range does not deny. A credential validity bound that is not a dateTime with a
timezone denies in Phase A. Signed policy content is parsed with its relative IRIs resolved against
the policy document (the policy IRI without its fragment). The credential's `svc:action` and `svc:target` claims are read
but not enforced; the bound policy decides scope.

Authorization credentials must contain one subject record (a single-element array is
accepted). Canonical and legacy claim aliases must agree, including action sets after
deduplication. Bare claim names expand to the legacy namespace. Conflicts, malformed
aliases, and multiple subject records deny with `BINDING_MISMATCH`.

> Experimental and security-critical. Present the raw fetched policy source text and Content-Type
> for signed content-digest verification; do not reserialize them first.

## Install

```sh
npm install github:jeswr/agent-authz-verifier#main
```

Requires Node.js 24 or newer.

## Minimal usage

```ts
import { verifyAgentAuthority } from "@jeswr/agent-authz-verifier";

const result = await verifyAgentAuthority(
  {
    credentials,
    policies,
    policyContents,
  },
  {
    request: { action: "read", target },
    rootPrincipal: resourceOwnerWebId,
    now: new Date(),
    resolveKey,
    isControlledBy,
    resolveStatus,
    actor: authenticatedWebId,
  },
);

if (!result.authorized) {
  console.error(result.phase, result.code, result.reason);
}
```

## Key API

- `verifyAgentAuthority(chain, options)`: assembly, credential integrity, cross-binding, status,
  revocation, ODRL evaluation, and optional actor-chain composition.
- `readBoundAuthorization(vc)`: read an authorization claim without verifying it.
- Results: `VerifyAuthorityResult`, `VerifierPhase`, `VerifierErrorCode`.
- Code sets: `PHASE_A_CODES`, `RELATED_RESOURCE_CODES`, `STATUS_GATE_CODES`.
- Seams: `resolveKey`, `isControlledBy`, `resolveStatus`; implementations are available from
  `@jeswr/solid-vc`.

## Links

- [Source](https://github.com/jeswr/agent-authz-verifier)
- [Issues](https://github.com/jeswr/agent-authz-verifier/issues)
- [Credential layer](https://github.com/jeswr/solid-vc)
- [ODRL layer](https://github.com/jeswr/solid-odrl)

## License

MIT © Jesse Wright
