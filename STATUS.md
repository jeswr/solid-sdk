<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-xex / VOC-02 lane report

Branch: `lane/sst-xex`. Base: `6b46636d065fd49f4a07d86c92cacad8ef4bea96`
(`suite/integration`). Work completed on 2026-10-25 in this checkout only.

## Commits

- `384a8fc2` — `feat(vocab): generate legacy namespace alignments`: snapshot the
  pre-change term inventory from the base revision, generate 774 mappings, exclude
  the compatibility sidecar from the merged build, accept Codex provenance, and
  record conservative interpretations in `QUESTIONS.md`.
- `28cbe3f1` — `feat(vocab): rebase ontologies to jeswr.org`: move the package's
  active bases to `https://jeswr.org/ns/`, version all 34 suite-owned ontology
  nodes at 2.0.0 with explanatory descriptions, regenerate `docs/`, and add
  migration checks plus the portfolio URL verification script/output.
- Final `docs: record VOC-02 lane validation` commit — this report.

The 17 main ontologies retain all 774 terms: 220 classes, 304 properties and
250 individuals. Their generated old-to-new OWL mappings are opt-in only; the
build and all 14 offline catalog closures exclude that sidecar. `fedcon:` keeps
its ontology identity, term IRIs and version; references to rebased siblings
follow the new bases. Existing `prof:Profile` version histories retain their
version numbers under the new base. No packages/apps were added, and no
dependencies or lockfile entries changed.

## Validation

All commands below ran from the repository root unless stated otherwise.

| Command | Result |
| --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | PASS, exit 0; lockfile unchanged, lifecycle scripts disabled. |
| `node packages/solid-federation-vocab/scripts/legacy-w3id-alignments.mjs` | PASS, exit 0; 774 mappings from all 17 pre-change ontologies. Re-running with typed wrapper accessors reproduced the committed Turtle byte-for-byte. |
| `pnpm exec biome check packages/solid-federation-vocab/scripts/legacy-w3id-alignments.mjs packages/solid-federation-vocab/scripts/test-rebase.mjs packages/solid-federation-vocab/scripts/verify-persistent-ids.mjs` | PASS, exit 0; all three new scripts. |
| `pnpm --filter @jeswr/solid-federation-vocab run gate` | PASS, exit 0; lint, build, typecheck, test/validate and ontology gate. HermiT consistency was explicitly skipped because Java/ROBOT is unavailable. |
| `node packages/solid-federation-vocab/scripts/verify-persistent-ids.mjs /tmp/sst-xex-persistent-ids.ts` | PASS, exit 0; all 17 entries, all 51 live representation URLs HTTP 200, all local artifact filenames present, legacy predecessor fields retained. |
| `pnpm run lint:root` | FAIL, exit 1; three existing suite UI contrast failures, detailed below. All earlier root lint/guard steps passed. |
| `TURBO_SCM_BASE=6b46636d065fd49f4a07d86c92cacad8ef4bea96 pnpm run gate` | FAIL, exit 1; stops at the same root contrast failures before the affected Turbo tasks. |
| `pnpm run gate:full` | FAIL, exit 1; unrelated `@jeswr/unstorage-solid` build cannot write `/home/runner/.npm/_cacache/tmp/` (EROFS). Turbo reports 3 successful / 27 started tasks before stopping. |
| `git diff --check` | PASS. |
| `grep -rl 'w3id.org/jeswr' packages/solid-federation-vocab` | PASS; only source/served `legacy-w3id-alignments.ttl` and a historical comment in its generator. |
| `roborev status` | Unavailable, exit 127: command not found. No automated review verdicts could be read. |

The brief's explicit package sequence also passed in full (exit 0):

```sh
pnpm --filter @jeswr/solid-federation-vocab run lint && pnpm --filter @jeswr/solid-federation-vocab run build && pnpm --filter @jeswr/solid-federation-vocab run typecheck && pnpm --filter @jeswr/solid-federation-vocab run test && pnpm --filter @jeswr/solid-federation-vocab run ontology
```

The ontology gate parsed all 56 sector Turtle files and checked term hygiene for
every core/sector and root governance vocabulary. The migration checks verify
mapping completeness, relation types and direction, major-version metadata,
absence of active legacy IRIs, served-sidecar equality, unchanged fedcon identity,
and offline resolution of all 14 catalog closures. Existing temporal JSON-LD
and positive/negative scheduling SHACL fixtures still pass after the rebase.
The package gate builds before validating generated contexts/artifacts.

The three root contrast failures are in files unchanged from the lane base:

| Theme | Foreground | Background | Actual ratio | Required |
| --- | --- | --- | --- | --- |
| light | `--warning-foreground` | `--warning` | 4.331 | 4.5 |
| light | `--border-strong` | `--background` | 1.786 | 3 |
| dark | `--border-strong` | `--background` | 2.095 | 3 |

The checks/scripts and suite UI tokens have no diff from the base commit. They
were left outside this vocabulary lane's scope. Temporary execution logs are
`/tmp/sst-xex-{install,build,validate,ontology,package-gate,lint-root,gate,gate-full}.log`.

## Portfolio evidence and handoff

The portfolio checkout named in the brief was absent. Its public
`config/persistent-ids.ts` was read without modification through the GitHub
connector: blob `10324e948403513b10e70e3935c78cef70331d08` on `main`.
The unmodified contents were saved temporarily as `/tmp/sst-xex-persistent-ids.ts`
for the verification command. The script's committed output is
[`packages/solid-federation-vocab/verification/persistent-ids.tsv`](packages/solid-federation-vocab/verification/persistent-ids.tsv).
It contains the UTC timestamp, every checked URL and final URL, and all 51 HTTP
statuses. All existing registry slugs, representation filenames and legacy
`w3id` fields already satisfy the brief, so no registry change was needed.

The 200 checks establish availability of the currently published endpoints;
they do not publish this lane's new ontology bytes. No push, PR, branch switch,
remote git fetch/merge, portfolio edit or deployment was performed. The draft-PR
acceptance step is handed to the integration lead because the lane rules
expressly prohibit opening PRs; production deployment still needs Jesse's go.

## Remaining limits and questions

- The repository-wide gates are not green for the unrelated reasons above.
- Authoritative HermiT consistency remains unverified on this host because
  Java/ROBOT is unavailable; `ontology-gate.mjs` reported its normal explicit skip.
- Per-commit roborev review remains unavailable because the executable is absent.
  Beads was not modified: this is a dedicated lane checkout with no `.beads/`,
  and the tracker skill restricts tracker mutations to the repository root.
- No dependency was added, so `check:packages` was not applicable.
- Screenshots: none; this task changes vocabulary identifiers and generated docs.
- No unanswered question blocks the code. The three specification interpretations
  and their conservative resolutions are recorded in [`QUESTIONS.md`](QUESTIONS.md).
