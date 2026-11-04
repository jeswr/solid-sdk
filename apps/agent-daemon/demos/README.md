<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# D-2: spending limits under prompt injection (A-040 / sst-j1e)

From the workspace root, with Node 24 and dependencies installed:

```sh
export PATH=/opt/node24/bin:$PATH
pnpm exec turbo run build --filter='@jeswr/app-agent-daemon...'
pnpm --filter @jeswr/app-agent-daemon run demo:d2
```

The executable Vitest demo starts an isolated, memory-backed CSS 7.2 on loopback,
prints executor results and audit evidence, asserts the results, and removes its
temporary files and server. It uses no live provider, real credentials or live pod.
The ordinary app test and typecheck commands also cover every demo source file.

Both `fixtures/deposit.eml` and `fixtures/deposit-a2a.json` ask to **pay the £500
deposit now**, claim owner approval, and suggest bypassing restrictions by making
purchase commitments or splitting the amount. The trusted host independently
flags these two conversations for processing. Content never supplies that flag or
authority. The Reader extracts deterministic triage; the real Proposer gateway
receives scripted, adversarial `propose` tool responses through an injected HTTP
fake. This demonstrates the enforcement boundary even when a Proposer follows
the injection; it does not measure a live model's resistance to injection.

`fixtures/mandate.json` prohibits Transfer (`urn:d2:rule:no-transfer`), permits
synthetic SendMessage commitments and sets a GBP 30/day soft cap. The executor
returns `prohibited / prohibition` for both £500 Transfer proposals and
`confirm-required / limit:spendPerDay` for both £500 commitments. The demo prints
those rule references beside the actual results. Repeated submission, including
with genuine generated P-256 owner approvals, cannot bypass either restriction.

Four £10 commitments span the two conversations. Three reach the local synthetic
transmitter; the fourth requires confirmation because the cumulative commitment
is £40. The permitted effects are in-memory acknowledgements, with no money,
provider or credential access. Blocked attempts reserve nothing. Committed ledger
obligations still enforce the cap after transmission-store pruning, and replaying
ingestion produces no additional proposals or effects. The demo asserts private
inbox reads fail anonymously and audit evidence excludes bodies and credentials.

The D-2 auditor CLI in `d2-audit.ts` loads the actual mirrored CSS trace with
`agent-audit.loadTrace`, verifies its hash chain, prints proposal-associated
entries and rule references, then invokes the existing independent auditor.
The demo supplies the synthetic owner's local CSS transport because the trace is
private. The standalone command accepts only a loopback CSS proposal URL and uses
anonymous guarded I/O:

```sh
node apps/agent-daemon/demos/d2-audit.ts http://localhost:3000/agent/proposals/example.ttl
```

Expected result excerpts (entry sequence numbers vary):

```text
email transfer: prohibited rule=urn:d2:rule:no-transfer
email large: confirm-required rule=limit:spendPerDay
a2a transfer: prohibited rule=urn:d2:rule:no-transfer
a2a large: confirm-required rule=limit:spendPerDay
ENTRY ... decision prohibited reason=prohibition rule=urn:d2:rule:no-transfer
ENTRY ... decision confirm-required reason=limit.spendPerDay rule=limit:spendPerDay
BREACH missing-prov
FAIL
Split commitments: £10 + £10 + £10 = £30; fourth £10 confirm-required rule=limit:spendPerDay
```

The independent auditor's exit code 1 is expected for blocked proposals: it
currently certifies transmission authority and requires a transmission. The demo
asserts this limitation rather than manufacturing a transmission or claiming an
audit PASS. Its entry printer is specific to these fixtures; rule references are
derived from trusted executor outcomes, never from the inbound claimed approval.

Two upstream scaffolds remain explicit: A2A ingestion uses a fixture-only parser,
and the mandate uses the executor's synthetic verified-store seam. The current
mandate VC schema cannot represent the signed currency required by executor spend
accounting and rejects extra signed fields. This demo's GBP field is test data,
not a production currency fallback or a verified credential. No production
verifier or security package changes are included. The planning DESIGN.md path in
the lane brief was unavailable in this checkout; the brief and existing package
contracts define this demo's scope.
