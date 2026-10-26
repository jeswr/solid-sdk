<!-- AUTHORED-BY Codex GPT-6 -->

# sst-imb.3 — DRV-L4H

Implemented only finding 1 from
`solid-sdk-lane-sst-lkde-7ecb4f33828a.md`: keep-both naming could discard a
capped file's extension after its remaining stem became only dots.

Implementation commit: `846530f5` — `fix(drive): reject extension-ambiguous capped names`.
Normalization now checks that capping preserves the detected extension chain.
The conservative choice is to throw the existing
`UploadPlanningError("invalid-name")` when capping would change that boundary.
Valid names retain their full extension through collision numbering.

Nine regression cases cover simple, multipart and Unicode extensions, the last
non-dot stem character at the cap, single- and multi-digit collision suffixes,
path encoding, and existing/pending upload collisions. The rejection cases
failed against the original implementation. The focused suites pass all 142 tests.
The upload README documents the rejection policy. No dependencies changed.

Validation completed before the final status commit:

- `pnpm --filter @jeswr/app-suite run lint`: passed, with existing warnings.
- `pnpm --filter @jeswr/app-suite run typecheck`: passed.
- `pnpm --filter @jeswr/app-suite run test`: passed, 121 files and 6,422 tests;
  100% statements, branches, functions and lines across configured coverage files,
  including `upload/names.ts`.
- `pnpm run lint:root`: passed.
- `pnpm run gate`: passed, all 10 tasks. Used
  `TURBO_SCM_BASE=67abf7f1d67285756c2e31e6b2ab801d93cea95a`, the supplied lane base,
  because this checkout has no local `main` branch.
- `pnpm run gate:full`: failed at the unrelated
  `@jeswr/federation-trust` characterization snapshot
  (`test/characterization.test.ts:196`): serialized `delegateKey` JSON property
  order differs. 319 tasks succeeded before the failure. That package is unchanged.
- `git diff --check`: passed.

The brief's `@jeswr/suite` filter was interpreted as the current package name,
`@jeswr/app-suite`. Required workspace dependencies were built locally first;
the root TypeScript binary built suite-vocab because its local runner was absent.
Repository gates included the root binary directory in `PATH` and were invoked
with `GIT_ALLOW_PROTOCOL=none`. No remote fetch or merge ran. The full gate's
16 untracked generated client identity/callback assets were removed afterward.

`lanes/bdl show sst-imb.3` could not acquire the tracker database locks on the
read-only tracker checkout. The bead description was read from its existing
`.beads/issues.jsonl` record instead; tracker state was not changed. `roborev`
is not installed, so automated per-commit review could not run.

No unfinished implementation work or open questions. The full-workspace snapshot
failure and unavailable automated review remain validation limitations.
