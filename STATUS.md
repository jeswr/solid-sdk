<!-- AUTHORED-BY Codex GPT-6 -->

# sst-kvnf lane report

Implemented the findings in the three reviews named by the brief, restricted to
`packages/personal-agent` and `packages/agentic-legacy-bridge`. Based on
`67abf7f1d67285756c2e31e6b2ab801d93cea95a`; branch `lane/sst-kvnf`.

## Commits

| Commit | Finding and regression coverage |
| --- | --- |
| `477fb750` | Require typed recipient acknowledgement. Actor-written reply/provenance pointers and recipient changes cannot lower friction; update confirmed end-to-end fixtures. |
| `0adf4f74` | Separate send failures from receipt finalization failures. `ReceiptPersistenceError` retains the successful channel receipt; HTTP/network persistence failures leave the claim and cannot trigger a resend. |
| `920ea487` | Reject conflicting action types, duplicate action aliases, and competing type properties before verified extraction. Cover both orderings, accepted single aliases, and structural Message compatibility. |
| `111dfe78` | Derive DST candidates from the zone's actual surrounding offsets. Cover Lord Howe's thirty-minute repeat/gap, widened Microsoft busy intervals, skipped days, and ordinary fractional offsets. |
| `2ccc646f` | Enforce the credential response cap during streaming, cancel oversized responses, and release the reader. Cover misleading lengths, inclusive size limits, split UTF-8, and sanitized failures. |
| `1199e957` | Validate retained raw resources by SHA-256 and byte length before reuse. `RawResourceMismatchError` stops graph/chat provenance writes; cover changed bytes, read failures, matching replay, and partial repair. |

## Validation

The final tree passes the specified gate, run sequentially:

```sh
pnpm --filter ./packages/personal-agent --filter ./packages/agentic-legacy-bridge lint
pnpm --filter ./packages/personal-agent --filter ./packages/agentic-legacy-bridge typecheck
pnpm --filter ./packages/personal-agent --filter ./packages/agentic-legacy-bridge test
pnpm run lint:root
```

- Bridge: 37 test files, 671 tests passed.
- Personal agent: 57 test files, 552 tests passed.
- Dependency-first builds for both packages and their workspace dependencies passed.
- Both `test:coverage` scripts passed on the final tree. Statements/branches/functions/lines:
  bridge 94.05% / 87.03% / 97.08% / 96.34%; personal agent
  87.12% / 75.05% / 90.5% / 89.64%.
- An earlier coverage run concurrent with the full gate timed out in the existing scheduling
  restart test; the isolated rerun passed without changing tests or timeout settings.
- `pnpm run gate:full` failed after 282 successful tasks (41 cached), at the unchanged
  `packages/federation-trust/test/characterization.test.ts:196` delegation-credential
  snapshot: the embedded JWK string orders `kty`, `crv`, `x` differently. Root tests,
  including mirror publishing, passed in this final run. No snapshot was updated.
- Frozen offline dependency installation and `git diff --check` passed. Generated application
  public assets were removed after the full gate; no build output is committed.

## Conservative decisions and remaining scope

- Confirmation stays high friction for every proposal: the synchronous API has no trusted
  Reader evidence source binding both thread and recipient. No new evidence API was invented.
- Receipt persistence failure rejects the executor run, preserves the channel result for
  recovery, and retains the at-most-once claim. It never writes a false failed-send receipt.
- Raw-resource replay validation requires Read access to retained raw anchors in addition
  to Append for creation. Unreadable anchors fail before writing provenance.
- **RDF parser dependency finding: out of scope under the brief's one-line allowance.**
  Changing the two manifest lines to `workspace:*` works with existing parser call sites,
  but breaks both root mirror-import tests: `test/mirror-publish.test.mjs:46` explicitly
  requires the registry `^0.1.0` dependency. Completing the switch therefore requires a
  root test change outside that allowance. The experiment was reverted entirely; manifests
  and lockfile are unchanged. Full lockfile resolution also wanted an unrelated remote Git
  lookup, which was blocked; no remote was fetched or merged.
- The bead's additional note-only findings (Microsoft all-day date interpretation,
  confirmation-record ACLs, and full-IRI mandate policy loading) are not in the three selected
  reviews and remain under the existing `sst-kvnf` tracking scope.
- `lanes/bdl show sst-kvnf` could not open the read-only tracker database. The description
  and notes were read from its `.beads/issues.jsonl` export; no tracker state was changed.
- Automated per-commit roborev verdicts are unavailable because `roborev` is not installed.
  The final source diff was reviewed manually. No pushes, PRs, branch switches, or mirror
  publishing were performed.

No open implementation questions. The parser follow-up requires the broader scope described above.
