<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# D-3: an auditor with zero credentials

From the workspace, with Node 24 on PATH and dependencies already installed:

```sh
pnpm --filter @jeswr/agent-audit demo
```

This builds the demo's runtime dependencies and typechecks its TypeScript before
starting a fresh CSS 7.2.0 server, bound only to loopback, with memory-backed storage.
It creates a throwaway owner account and agent WebID. Account passwords, CSS client
credentials, DPoP keys, owner signing keys and recipient salts exist only in memory;
the transcript contains public identifiers and verification results. CSS stops and
the temporary configuration is removed on completion or a handled failure.

Two proposals each receive a fresh P-256 owner approval bound to
`proposalApprovalTerms`. The real executor verifies the signed mandate, its current
status, policy and approval, then delivers to a synthetic in-memory sink. The default
mandate's Gmail binding is retained; no Gmail or other provider is contacted. The
executor's stores and sink are ephemeral test seams, so this demonstrates enforcement
and audit verification rather than crash durability or provider delivery.

Four isolated synthetic evidence fixtures demonstrate forged approval, out-of-scope
authority, revocation at the evaluation instant, and a missing PROV entry. They do
not cause additional sends or modify the approved examples. Each workspace starts
owner-only. The demo proves anonymous reads fail before granting inherited
`acl:Read` to `foaf:Agent` on `agent/audit/`, `agent/mandates/` and
`agent/approvals/`; the owner's public WebID publishes the verification methods.
Approvals and WebID keys are necessary for independent verification in addition to
the two containers named in DESIGN §5. Inbox bodies and proposal previews stay
private, and anonymous writes remain forbidden.

The transcript includes six invocations of the real `runAuditCli`: two `PASS`
results with exit 0, then four `FAIL` results with exit 1 and their specific
`BREACH` names. `D-3 PASS` means all six matched expectations. Any unexpected
result, unreadable pod, unrelated breach or setup failure makes the command exit 1.
The ledger and PROV contain message digests and account-bound recipient hashes.
The auditor receives no owner transport, credentials, key resolver or status stub;
it fetches the public evidence and re-verifies signatures and the hash chain.

## Read-only replay against a prepared pod

```sh
pnpm --filter @jeswr/agent-audit demo --base https://pod.example/jesse/
```

`--base` is the pod root, including the trailing slash. It skips CSS, account
creation, sends, seeding and ACL writes, and audits these existing locations:

| Workspace under the base | Proposals under its `agent/proposals/` | Expected result |
| --- | --- | --- |
| `demos/d3/approved/` | `1.ttl`, `2.ttl` | exit 0 for both |
| `demos/d3/forged-approval/` | `1.ttl` | `forged-approval` |
| `demos/d3/out-of-scope/` | `1.ttl` | `out-of-scope` |
| `demos/d3/revoked-at-time/` | `1.ttl` | `revoked-at-time` |
| `demos/d3/missing-prov/` | `1.ttl` | `missing-prov` |

The owner must prepare these workspaces and their read grants before replay.
`seedWalkthrough({ pod, owner, io, anonymous, print })` in `scenario.ts` is the
configuration seam for an owner-operated preparation tool: supply a scoped owner
transport and a separate anonymous transport on a dedicated demo pod. It writes
the listed workspaces and publishes generated verification methods in the owner
profile. Do not apply it to existing workspaces: conditional mirror creation will
refuse conflicting history. No live-pod preparation or live credentials were used
to develop this demo; the automated replay test also uses local CSS.

Production replay uses anonymous DNS-pinned guarded fetch, refuses redirects and
never logs in. An explicit loopback base enables local CSS replay. The default
local run is ephemeral, so its printed base stops working when the command exits.
The negative revocation example proves evaluation against a signed current status
list; it does not establish authoritative historical status. Hash chains verify
the published prefix and require a trusted external head to detect tail truncation.

The workspace-relative executor imports are confined to this development demo.
Building production dependencies avoids the agent-model development comparison
cycle and keeps the audit library free of an executor dependency. The source API
and its 100% coverage requirements remain unchanged.
