<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/agent-authz-verifier

Fail-closed verification of agent authorization chains composed from signed credentials and ODRL delegation policies.

The package performs no network I/O or RDF parsing. Key control and credential-status checks enter
only through injected seams, so a decision can be reproduced independently.

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
