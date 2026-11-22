<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

# Brief 36g report

## Review fixes

| Finding | Fix and regression |
| --- | --- |
| G1 matched a substitute bar to a retained step | G1 matches bars by decision fields and producing step ID, and still requires the bar to precede the same shared releases. The regression removes one main bar, leaves the other bar’s step in the branch, and inserts an identical bar from a third step before the shared release. Only the removed bar is reported as `notReached`, and the replacement fails G1. |
| A different source could store part of a refused claim | Stores, outbound packets and effect parameters use the same recursive matcher. It checks refused claim values within strings, including nested entries and UTF-8 bytes, and retains checks for statement IDs, digests and copies. The regression admits a differently named claim from an independent issuer whose nested text includes just the refused account. |
| Email text could carry an embedded compact JWS | The matcher looks for the original carriage and also decodes compact JWS payloads within longer strings. Both email regressions reach approval and an effect release. One uses the exact refused token followed by the runtime footer. The other embeds a re-signed token with a new issuer and statement ID in prose. |
| First startup could append ledger records before it had a recovery anchor | A trusted empty ledger is checkpointed at genesis before startup records the mandate. The regression interrupts the save after the mandate appends, reopens, then verifies that a new write replaces the uncommitted suffix and that the next checkpoint can be audited and exported. A ledger already left nonempty by an older startup with no saved head still fails closed because it lacks a trusted recovery anchor. |

All five new regression cases reproduced the failures against the source at `60ea7d0a2`.

## Manifest and oracle

The replay covered all **283 manifest paths** in 112 scenario and configuration combinations with the local sparq adapters. It measured **277 runs, one disagreement and five blocked**. All 278 executable paths produced traces. The replay verified the six saved joint trace hashes.

The only changed row is the baseline `pay-an-invoice/branch-1`. The business agent refuses the email-sourced account at event 4. At event 78 it stores an invoice signed by the supplier that contains the same `urn:account:supplier` value. P4 still rejects payment at events 83–84. The manifest keeps the continuation disagreement and retains the witnessed result `refuse / source-not-authoritative / source`.

Ruling 34d still holds for `mortgage-main/a2a-task-state-lies` under `transport-a2a`. The row reports `admit / intact / integrity` with main events 131 and 153 marked `notReached`. The invoice and mortgage A2A traces both reproduced byte for byte with their saved commit metadata.

The 163-path decision oracle retains SHA-256 `4f63d12f5e58b1d4a2f085c3d524b671663a1d96dd61c45ee875838d1308922f`.

## Verification

- All 103 focused tests passed on Node 24 with `--maxWorkers=2`. Branch comparison, email and labels accounted for 100 tests. The two oracle files accounted for three tests and ran with the live aggregate adapter required.
- The package typecheck, Biome lint, schema export check, workspace RDF discipline guard and agent-layer guard passed. The package RDF pipeline reported zero failures and 212 allowances.

Changes are uncommitted.
