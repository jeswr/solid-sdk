<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-7wpk — SHT-L2 lane report

Implementation complete on `lane/sst-7wpk`, based on `8c73e21f266896914a67b6434814b8bb567e1ba7`. No pushes, PRs, branch switches or merges performed.

## Commits

- `3dd501d0` — `feat: add sheet references and structural edits`: typed immutable reference model, A1/R1C1 parsing and formatting, column conversion, structural row/column insertion/deletion, formula tokenization and rewriting, exact intersection/union, barrel exports, synthetic example fixtures and property tests, per-file 100% coverage inclusion, and conservative interpretations in `QUESTIONS.md`.
- `cb9638bb` — `fix: reject ambiguous formula intersections`: reject reference-shaped function/intersection ambiguity, preserve unchanged R1C1 reference spelling when the origin does not move, and document the API, accepted dialect and limits beside the library.
- Final `docs: record sheet reference lane validation` commit contains this report (its hash is available from `git log -1`).

## Validation

The environment has Corepack and cached pnpm 10.4.1, but no `pnpm` executable on PATH. Commands below used a temporary `/tmp/sst-7wpk-bin/pnpm` wrapper executing `corepack pnpm "$@"`, with `PATH=/tmp/sst-7wpk-bin:$PATH`. No repository toolchain files were changed.

| Exact command (after PATH setup) | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; build-only prerequisite for the app's existing workspace imports. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; production Next.js build, strict TypeScript, Biome and all 450 tests across 14 files. |
| `pnpm run lint:root` | PASS; root Biome, workspace/dependency/transport/fetch/token guards, 74 contrast pairs with zero failures. |
| `TURBO_SCM_BASE=8c73e21f266896914a67b6434814b8bb567e1ba7 pnpm run gate` | PASS; 7/7 Turbo tasks, including 341 root tests and the app's 450 tests. |
| `pnpm run gate:full` | FAIL (environment, outside lane scope); `@jeswr/unstorage-solid#build` runs its existing dependency build, which fails during `npm install --no-audit --no-fund --ignore-scripts --prefer-offline` with `EROFS` writing `/home/runner/.npm/_cacache/tmp/…`. No unrelated source changes made. |
| `git diff --check` | PASS. |

The `src/apps/sheets/lib/refs/**/*.ts` coverage glob is enforced at **100% per file** for statements, branches, functions and lines. Measured totals: 263/263 statements, 226/226 branches, 43/43 functions, 233/233 lines. The barrel has no executable statements. Tests cover parsing/formatting, mixed absolute/relative axes, ranges, whole rows/columns, quoted and escaped sheet names, insert/delete boundaries, deleted targets, range contraction, cross-sheet targets, moving R1C1 origins, strings containing references, rejected syntax, safe-integer boundaries, exact cell-set geometry and immutability.

Early development checks exposed two numeric-boundary bugs, now fixed and covered. An initial typecheck before building `suite-ui` could not resolve its uncommitted `dist`; the prescribed dependency-first sequence above passes.

## Dependencies, UI and review

- No dependencies or manifests changed; `check:packages` was not applicable. Lifecycle scripts remain disabled.
- Pure library only: no React/hooks/network/UI, rendered states, fixture routes, screenshots, axe runs or Playwright specs applicable. No browser launched.
- roborev skill read; CLI unavailable and no post-commit hook present in this checkout, so automated review could not be queued or read. No tooling installed. Manual adversarial checks produced the second commit.

## Remaining items and questions

- Full-workspace validation remains blocked by the unrelated npm-cache filesystem restriction; the required app and affected gates are green.
- Automated roborev review remains unavailable in this environment.
- Conservative choices are recorded in `QUESTIONS.md`: one-based safe-integer coordinates without an invented sheet-size cap, explicit R1C1 origins, rejecting reversed ranges, exact unions, explicit sheet scopes and a fail-closed formula subset. None blocks this lane; engine-specific extensions belong to future integration work.
