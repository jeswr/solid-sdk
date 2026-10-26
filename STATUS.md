<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-vaj lane report

Branch: `lane/sst-vaj`. Base: `917d3be9c7967622829adc43c1aaabb0964ec993`.
Runtime: Node `v24.22.1`, pnpm `10.4.1`.

## Commits

- `b65ae95c` — `feat: add stateless MCP HTTP handlers`: export `./http`, implement
  overloaded Node/Web handlers using the existing SDK's stateless transport, bind a
  fresh server to each authenticated principal, reject reused servers, validate Host
  and exact origins, provide explicit CORS/preflight responses, issue the 401 metadata
  challenge, cap streamed request bodies at 1 MiB, and close servers/transports.
  Includes 70 fixture/local HTTP tests, enforced HTTP coverage thresholds, README
  usage, and conservative interpretations in `QUESTIONS.md`.
- `docs: record sst-vaj lane validation` — this final report commit.

## Validation

Passed:

```sh
pnpm install --offline --ignore-scripts --frozen-lockfile
GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/solid-mcp run lint
GIT_ALLOW_PROTOCOL=file pnpm run lint:root
pnpm --filter @jeswr/solid-mcp exec vitest run test/http.test.ts --coverage
git diff --check
```

Installation kept the lockfile unchanged and lifecycle scripts disabled. HTTP tests:
70 passed, including MCP SDK client initialization and tool discovery over real local
HTTP, the Web fetch adapter, principal isolation, authentication failures, origin/Host
rejections, body limits, preflights, and cleanup. `src/http.ts` coverage: 65/65 branches,
101/101 lines, 106/106 statements, 10/10 functions (all 100%). Other source files are
not covered by this focused run.

The isolated HTTP entry also passed strict TypeScript declaration emission, bundling,
and import through the actual package subpath. From `packages/solid-mcp`:

```sh
pnpm --filter @jeswr/solid-mcp exec tsc --ignoreConfig src/http.ts --declaration --emitDeclarationOnly --strict --skipLibCheck --target es2022 --module nodenext --moduleResolution nodenext --lib es2022,dom,dom.asynciterable --types node --outDir dist
pnpm --filter @jeswr/solid-mcp exec esbuild src/http.ts --bundle --packages=external --platform=node --format=esm --outfile=dist/http.js
node --input-type=module -e 'import { createMcpHttpHandler } from "@jeswr/solid-mcp/http"; if (typeof createMcpHttpHandler !== "function") process.exit(1)'
```

Required package gate attempted:

```sh
GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/solid-mcp run lint && GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/solid-mcp run build && GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/solid-mcp run typecheck && GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/solid-mcp run test
```

Lint passed; build exited 1 in the existing `scripts/build-deps.mjs`, before compiling
the package. Typecheck and test were then attempted separately with the exact commands
below; both exited 1 in the same dependency prelude, before tsc/Vitest ran:

```sh
GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/solid-mcp run typecheck
GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/solid-mcp run test
```

Required affected gate and session-close full gate attempted:

```sh
PATH=/tmp/sst-vaj-git-bin:$PATH GIT_ALLOW_PROTOCOL=file TURBO_SCM_BASE=917d3be9c7967622829adc43c1aaabb0964ec993 pnpm run gate
PATH=/tmp/sst-vaj-git-bin:$PATH GIT_ALLOW_PROTOCOL=file pnpm run gate:full
```

- Affected gate: exit 1; `@jeswr/solid-mcp#build` failed (3 successful tasks, 5 total).
- Full gate: exit 1; `@jeswr/unstorage-solid#build` failed (13 successful tasks, 53 total).
- Both fail because the installed, pinned Git `@jeswr/fetch-rdf` dependency contains
  no `dist/`, and existing build helpers try cloning its network remote to rebuild it.
  The temporary PATH guard rejects Git network URLs; no guard/tooling change is committed.
  Logs: `/tmp/sst-vaj-affected-gate.log`, `/tmp/sst-vaj-full-gate.log`.

An initial package typecheck invoked that existing helper before its network behavior
was identified: it cloned the dependency into a temporary directory, then npm failed
with a read-only cache (`EROFS`). A first Turbo run also discarded `GIT_ALLOW_PROTOCOL`
under strict environment filtering. Subsequent gate runs used the PATH guard above to
prevent further Git network access. Temporary helper clones were removed by its cleanup.

No dependencies were added; `check:packages` was therefore not required or run.
No `dist/` files are committed. No push, PR, merge, or publication was performed.

## Remaining blockers and questions

- A green package/workspace gate requires the exact pinned `fetch-rdf` build artifact
  to be provisioned within the allowed environment. No substitute dependency or
  unrelated build-helper change was introduced.
- `roborev` is not installed, so per-commit automated review could not run and no
  verdict is available. The tracker was left unchanged: this is a dedicated lane
  checkout and the tracking skill forbids worktree-local tracker mutations.
- The supplied base does not contain MCP-01's PodPort/tool registry/scaffolds despite
  the brief's dependency note. The transport accepts an SDK server factory and does
  not require those changes; no MCP-01 work is included here.
- Conservative choices are numbered in `QUESTIONS.md`: principal-to-server factory,
  fixed 1 MiB cap with stateless JSON responses, and exact public authority/origins
  with absent Origin allowed for native clients. No unresolved choice blocks HTTP.

<!-- AUTHORED-BY Codex GPT-6 — fix round 2 validation -->
## Fix round 2

Starting commit: `9c3f13e8aa5f9ffbb2e2f23aee2a4210859e17fa`.

- `2234cf0f` — `fix: correct MCP HTTP preflights and parse errors`: allow GET
  preflights and include GET in `Access-Control-Allow-Methods`; preserve 405 and
  `Allow: POST, OPTIONS` for actual authenticated GET requests. Make the JSON-RPC
  error code configurable and return `-32700` for JSON/UTF-8 parse failures.
  Regression tests also preserve the default `-32000` body validation error code.
- `docs: record sst-vaj round two validation` — this report update.

The regression tests failed before the implementation (six failures covering the
preflight advertisement, GET preflight rejection, and four malformed-body cases).
After the fix, all 74 HTTP tests pass. `src/http.ts` retains 100% coverage:
69/69 branches, 107/107 lines, 114/114 statements, and 11/11 functions.

Passed commands:

```sh
pnpm --filter @jeswr/solid-mcp exec vitest run test/http.test.ts --coverage
PATH=/tmp/sst-vaj-git-bin:$PATH GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/solid-mcp run lint
pnpm --filter @jeswr/solid-mcp exec tsc --ignoreConfig src/http.ts --noEmit --strict --skipLibCheck --target es2022 --module nodenext --moduleResolution nodenext --lib es2022,dom,dom.asynciterable --types node
git diff --check
```

Required package gate attempted before the final commit:

```sh
PATH=/tmp/sst-vaj-git-bin:$PATH GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/solid-mcp run lint && PATH=/tmp/sst-vaj-git-bin:$PATH GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/solid-mcp run build && PATH=/tmp/sst-vaj-git-bin:$PATH GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/solid-mcp run typecheck && PATH=/tmp/sst-vaj-git-bin:$PATH GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/solid-mcp run test
```

Lint passed; build exited 1 in the existing `build-deps.mjs` because the pinned
`@jeswr/fetch-rdf` dependency lacks `dist/`. Its attempted Git network clone was
rejected by the existing temporary PATH guard. Typecheck and test were attempted
separately and both exited 1 in the same dependency prelude:

```sh
PATH=/tmp/sst-vaj-git-bin:$PATH GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/solid-mcp run typecheck
PATH=/tmp/sst-vaj-git-bin:$PATH GIT_ALLOW_PROTOCOL=file pnpm --filter @jeswr/solid-mcp run test
PATH=/tmp/sst-vaj-git-bin:$PATH GIT_ALLOW_PROTOCOL=file TURBO_SCM_BASE=9c3f13e8aa5f9ffbb2e2f23aee2a4210859e17fa pnpm run gate
PATH=/tmp/sst-vaj-git-bin:$PATH GIT_ALLOW_PROTOCOL=file pnpm run gate:full
```

The affected gate passed root lint and workspace checks, then exited 1 at
`@jeswr/solid-mcp#build` (2 successful tasks, 4 total). The full gate exited 1 at
`@jeswr/unstorage-solid#build` (9 successful tasks, 134 total), also due to the
missing pinned `fetch-rdf` output and blocked network clone. Logs:
`/tmp/sst-vaj-round2-{typecheck,test,affected-gate,full-gate}.log`.

Both review findings are fixed. No dependencies were added, so `check:packages`
was not required. The existing dependency-artifact gate blocker remains;
`roborev` is still unavailable. No new design questions or unfinished implementation
work. No remote fetch, push, PR, merge, publication, or tracker changes were made.
