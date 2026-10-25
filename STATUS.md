<!-- AUTHORED-BY Codex GPT-6 -->

# Lane sst-8xm.30 — T-004, fix round 3

Date: 2026-10-25. Branch: `lane/sst-8xm.30`. Resumed from `d7030277`.

Both supplied review findings are fixed. Fetch-rdf's lint, build, typecheck,
and tests pass, as does standalone root lint. The full-workspace gate fails
on the same federation-trust characterization snapshot mismatch recorded at
the previous lane head; a green full-workspace gate is not claimed.

## Commits this round

- `c7bfd3f8 fix: cancel rejected RDF response bodies` — wrap response handling
  in guarded cleanup that awaits `response.body?.cancel()` before rethrowing
  the original failure. This covers HTTP status and content-type rejection,
  plus parser and context-policy failures. Cancellation failures cannot mask
  the original error.
- `a0b9c645 fix: ship N3 types with fetch-rdf` — move the existing `@types/n3`
  range (`^1.16.0`, locked at `1.26.1`) into production dependencies and update
  the lockfile without changing the resolution. Add an isolated downstream
  declaration fixture with no direct consumer dependency on `@types/n3`.
- Final report commit: `docs: report third fetch-rdf fix validation` — update
  this STATUS.md after all implementation, checks, and artifact cleanup.

## Regression coverage

Eight cancellation tests record underlying stream cancellation for non-2xx
responses, unsupported and malformed content types, and remote-context policy
refusal. They also prove cleanup is awaited and that rejected cancellation
or a locked body preserves the HTTP error. Existing null-body error and
successful parsing cases remain passing.

The declaration fixture copies the built package into a temporary consumer
outside the workspace and links only the package's production dependencies.
The consumer has no `@types/n3` dependency or workspace ambient types. It
checks both `fetchRdf` and `parseRdf` results, including N3 Store methods.
Like the workspace, it uses `skipLibCheck: true` to tolerate transitive Node
type-version conflicts. Negative type assertions prove the Stores are typed;
removing the production `@types/n3` link makes those assertions fail, so
unresolved declarations cannot silently pass as `any`. The fixture is part
of the normal fetch-rdf test gate and removes its temporary files.

## Validation

PASS (exit 0):

```sh
pnpm run check:packages @types/n3
pnpm install --lockfile-only --offline --frozen-lockfile --ignore-scripts
pnpm exec turbo run lint build typecheck test \
  --filter=@jeswr/fetch-rdf --concurrency=4 --continue=always
pnpm run lint:root
git diff d7030277 --check
```

Scoped Turbo gate: **5/5 tasks successful**, including root lint. Fetch-rdf:
**6 test files / 56 tests pass** (47 existing tests plus 9 new tests).
Root tests also pass in the full gate: **2 files / 26 tests**.

The charter-required `pnpm run gate:full` was run before the final commit.
FAIL (exit 1): **227 successful / 278 total tasks**, 4 cached. It stops at
`@jeswr/federation-trust#test`: 53 tests pass and one characterization snapshot
fails at `test/characterization.test.ts:196`. The serialized `delegateKey` JWK
has property order `kty, crv, x`; the snapshot expects `crv, x, kty`. This is
the exact mismatch already documented at `d7030277`. No federation-trust
source or snapshot was changed. Tasks left unfinished by this fail-fast gate
are not claimed to pass.

## Scope and remaining limitations

No requested implementation work or open design questions remain. The
conservative interpretation of the finding is cleanup for all existing
response rejection paths: fetch-rdf currently has no size-limit rejection
or size-policy option, and this round introduces neither.

The referenced original brief and `.fix1.md` remain absent from this checkout;
the supplied fix brief and previous STATUS.md provided context. Roborev is
unavailable on PATH, so no automated per-commit verdict was obtained. Manual
review checked error preservation, cancellation ownership, and fixture isolation.

No push, PR, branch switch, remote fetch/merge, or other checkout changes were
made. No new package or dependency version was introduced. Untracked generated
web public artifacts from the full gate were removed. STATUS.md was edited last.
