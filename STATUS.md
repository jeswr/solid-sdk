<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-543 / A-007 lane status

Implemented on `lane/sst-543`; no push, PR, remote fetch, merge or branch switch.

## Commits

- `81ce3948` — `feat(credentials): port pilot OAuth and store`: retain the pilot store,
  PKCE/state/nonce loopback flow, signed ID-token checks, account/client pinning, profile locks,
  refresh rotation, calendar adapters and helper protocol; import the pilot tests.
- `d3c87e8d` — `feat(credentials): separate grants and provision tokens`: platform store paths,
  explicit purpose/resource binding, Google/Microsoft scope profiles, eight token-file providers,
  structural channel TokenProvider, package exports/documentation and fake-op provisioning tests.
- `6c18c920` — `test(credentials): cover adversarial credential paths`: exercise ownership,
  symlinks, permissions, atomic-write failures, callback/identity errors, refresh races,
  helper failures and CLI boundaries; enforce unchanged 100% per-file coverage thresholds.
- `806daf62` — `fix(credentials): verify provisioning process exit`: pipe op stdout privately
  inside the writer and check process completion independently before storing anything; reject
  arbitrary partial output from failed op processes, including a trailing NUL.
- Final `docs: record credential lane verification` commit — this status and public-export TSDoc.

## Implementation and scope

The pilot modules were absent from `packages/personal-agent` in this base, so the port used
only the read-only pilot source path supplied in the brief. No source checkout was modified.
The existing scaffold already appears in `suite.json`; no new package entry was needed.

OAuth profiles and grants explicitly bind provider, connection/account, purpose (`read` or
`send`) and resource (`mail`, `calendar`, `teams`). Overlapping scopes never substitute for the
other purpose. Missing, ambiguous, malformed, expired or incorrectly bound credentials refuse.
Calendar grants remain separate from mail; the pilot Microsoft calendar read adapter remains.
The task's explicit token-file list is implemented: anthropic, openai, slack, matrix, discord,
telegram, bluesky and mastodon. Telegram personal-account MTProto remains deferred.

Conservative choices where the base supplied no concrete contract:

- `agent-channels` is a scaffold without TokenProvider types, so this package exposes the
  structural `read(account): Promise<string>` / `send(account): Promise<string>` seam locally.
  Account denotes the registry connection id; provider and resource are constructor options.
- Network transport must be injected explicitly. Missing transport refuses; the executable
  helper can serve cached tokens but does not acquire an ambient network capability. Hosts
  supply transport through the library API for login/refresh and provider adapters.
- Existing CLI profile creation defaults to calendar/read. Persisted profiles/grants require
  purpose/resource fields; unmarked legacy records do not silently gain authority.
- Store parents must exist, retaining the pilot's explicit-directory semantics. The default
  path function performs no filesystem access. Platforms without verifiable ownership refuse.
- Provisioning requires an explicit directory and provider; token files also require account
  and purpose. The zsh entry delegates each op read to its private pipe writer, exactly once
  per reference. Receipts contain only `credentialRef`; values never enter argv, shell variables,
  public output or temporary files outside the private store. Runtime never invokes op.

## Verification

All commands ran in this checkout. No live provider, real credential store or real op
executable was used by lane tests. Fake-op tests prepend their own executable to PATH.

| Command | Result |
| --- | --- |
| `pnpm run check:packages zod jose` | PASS; both dependencies cleared full npm policy checks before manifest changes. These are existing pilot dependencies required by the port. |
| `pnpm install --ignore-scripts` | PASS; lifecycle scripts stayed disabled. Lockfile changes are limited to the credential package importer. Existing unrelated peer warnings were reported. |
| `pnpm install --lockfile-only --offline --ignore-scripts --frozen-lockfile` | PASS. |
| `pnpm --filter @jeswr/agent-credentials run lint` | PASS; no warnings or fixes. |
| `pnpm --filter @jeswr/agent-credentials run build` | PASS. |
| `pnpm --filter @jeswr/agent-credentials run typecheck` | PASS, including test TypeScript. |
| `pnpm --filter @jeswr/agent-credentials run test` | PASS; 8 files, 117 tests; 100% statements (1319), branches (993), functions (203), lines (1193), with per-file thresholds unchanged. Includes all imported pilot tests and fake-op shell tests. |
| `pnpm run lint:root` | PASS, also rerun by the affected gate. |
| `TURBO_SCM_BASE=agent/integration pnpm run gate` | Cannot resolve SCM base: this checkout has no `agent/integration` ref. Root lint passed before Turbo stopped. |
| `TURBO_SCM_BASE=6ad0939808c3c1c438415d45409a5a4c30e281bd pnpm run gate` | PASS using the exact base SHA supplied in the brief; 6 tasks, including 686 root tests and credential package checks. Final rerun after public-export documentation also passed: 6/6 tasks, 686 root tests, in 21.943s. |
| `pnpm run gate:full` | FAIL in unrelated `@jeswr/federation-codegen#test`, after 285 successful tasks out of 345, in 2m21s. Two generator tests expect old `https://w3id.org/jeswr/...` inputs/output while the vocabulary source uses `https://jeswr.org/ns/...`. |
| `git diff --exit-code 6ad0939808c3c1c438415d45409a5a4c30e281bd -- tools/federation-codegen packages/solid-federation-vocab` | PASS; the full-gate failure paths are unchanged from the supplied base. |
| `git diff --check` | PASS. |

No timeout configuration was raised and no test timeout flakes were observed. The loaded-machine
package rerun took about 30 seconds overall and still passed. The shell script uses the POSIX
subset and was tested with bash because zsh is unavailable; native zsh execution was not verified.
Build-generated untracked public assets from the full gate were removed; no dist is committed.

## Remaining limitations and open questions

Implementation and acceptance tests are complete. The full-workspace gate remains blocked by
the unrelated namespace fixture drift above; no out-of-scope correction was made.

Roborev is not installed (`command -v roborev` returned no executable), so automated per-commit
review could not run. This security-critical lane still needs the repository's review process
before integration. Bead closure/sync remains with the integration owner; no tracker was opened
inside this worktree.

Open design questions: none. No live consent, provisioning, provider request or send was performed.
