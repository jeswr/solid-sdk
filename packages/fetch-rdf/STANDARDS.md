# Standards (managed by master repo)

This file is **synced from the `solid-app-suite` master repo** by
`scripts/sync-standards.sh`. Do not edit it directly — edit
`templates/sub-repo/STANDARDS.md` in the master and re-sync.

## Standards in force

1. **Continuous review with `roborev`.** The post-commit hook runs
   automatically; reviews land in the local `roborev` ledger.
2. **Reviewer model:** GitHub Copilot agent, currently `gpt-5.4` (must remain
   non-Anthropic — different provider from the development model).
3. **Unsigned commits.** `git config --local commit.gpgsign false` is set in
   this repo; do not re-enable.
4. **No `--no-verify`.** Don't skip hooks. Fix the underlying problem.

See the master repo's `REVIEWER-MODEL.md` and `CLAUDE.md` for rationale and
the re-evaluation cadence.
