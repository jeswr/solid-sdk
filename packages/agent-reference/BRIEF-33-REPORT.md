<!-- AUTHORED-BY Codex GPT-6 -->
# Brief 33 — Solid reference access and access control

Sam’s agent keeps the exact bank-signed balance statement in the fictional evidence pod. The approved disclosure binds the requested address, reader and duration. At release the gate applies a conditional WAC update, verifies Read access, and substitutes a signed pointer for the balance statement. Income remains in the delivery. The lender checks the pointer at delivery, reports the pending statement, then checks the fetched statement and stores a purpose-bound copy through its deletion date. Withdrawal removes the original rule through the ordinary effect gate.

The access-control configuration inherits this world. It checks a proposed translation against the supplier policy, the agreement and the matched mandate before any ACL write. The ACL and pointer name the supplier’s share permission and the agreement’s read permission. Purpose, onward sharing, storage, derivation, aggregation and duties remain in the signed terms.

| Configuration | Path | Measured verdict | Added exchanges |
|---|---|---|---:|
| By reference on Solid | `main` | Disclosure and data terms pass. The lender admits both delivery and read. The final application receipt equals the baseline’s. | 1 |
| By reference on Solid | `grant-wider-than-terms` | `disclosure` / `excessive-scope` → `stop` | 0 |
| By reference on Solid | `read-after-withdrawal` | Withdrawal goes. The pod returns 403. `source` / `not-authorised` → `refuse`. The lender retains its permitted copy. | 1 |
| Solid access control | `main` | Data terms approves the translation. The lender admits the read and its policy provenance. The final application receipt equals the reference run’s. | 1 |
| Solid access control | `translation-grants-more` | Disclosure passes. `data-terms` / `prohibited` → `stop`. | 0 |

All five rows moved from blocked to runs. The manifest changed from **251 runs, 18 disagreements, 14 blocked** to **256 runs, 18 disagreements, 9 blocked**, with **283 paths** both times. Every other row retains its previous content. Both main paths pass C1–C5 using the unchanged comparisons. The usage-control comparison uses the by-reference main run as its reference. The five traces and outlines are published, and their caption, rule, chat, resolution and stand-in prose contains no raw IRIs. Existing outlines, local-holder traces and the 164-path oracle file are byte-identical to the starting revision.

## Design calls

- The fictional provider enforces resource-specific WAC. Its signed receipt records HTTP carriage. The bank’s signature supplies source evidence. The fixture introduces actor keys to the stand-in in place of Solid-OIDC. The provider sees each read and can read the stored balance statement.
- ODRL translation is specific to this evidence disclosure. A supplier permission that lets the current holder use the balance does not itself authorize transfer to a new reader. The supplier’s share permission and the agreement’s read permission establish the exported links. The matched local mandate limits the grant and stays in Sam’s signed record.
- The pod-access SDK’s `translatePolicy` and `assertNotWider` operate on normalized effective storage policies. They take storage subjects and modes as inputs, so using them here would first require a separate mapping for the signed supplier terms, agreement, time bound and permission provenance. The gate checks that mapping directly. No dependency was added.
- The second intake receipt uses the existing agreement conversation. The new pending count is a declared numeric field on the Solid configuration’s profile. Both configurations keep `replaces` empty.
- D2, D6, D7 and D8 remain pending maintainer decisions.
- The release transaction restores the original ACL bytes when its grant was the only intervening update. When the pod is unavailable during compensation, the sender records the unresolved withdrawal and withholds the pointer. The tested provider outage occurred before the ACL update.
- The agreement allows 60 days of copying. The gate limits the pod lease to whole days that end strictly before Sam’s signed mandate expires, giving this lease 59 days. The 60-day lease would have ended two minutes after the mandate. The approved access parameters bind the shorter lease, and expiry uses the same gated effect as principal withdrawal.

## Verification

The restart interrupted the all-scenario build and full package Vitest invocation. The orchestrator owns the full gate under the resume instruction.

- TypeScript build, generated-file copy, schema drift check, typecheck, lint and targeted scenario regeneration passed.
- Both main paths passed the unchanged C1–C5 comparisons.
- Seven focused Vitest files passed 33 tests, including the grant transaction, rollback, withdrawal, expiry, translation, registry and trace checks.
- The RDF pipeline reported **0 failures and 213 allowances**.
- The artifact audit verified all 283 manifest row keys, the five status changes, the new trace and outline files, and the preserved local-holder traces. The 164-path oracle file matches the starting revision.
- Removing each of the three decisive checks made its focused test fail with the expected verdict missing. All three files were restored after the isolated runs. The engine report records each mutation and result.
- The live oracle matched all 164 baseline paths after the repository installer verified and loaded the pinned local SPARQ aggregate archive. The first run reached 158 paths while that optional adapter was absent.
- Final regeneration reproduced all five trace files byte-for-byte. The workspace agent-layer check and `git diff --check` passed.
