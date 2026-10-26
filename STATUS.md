<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Lane sst-8xm.33 — T-012

Implemented on `lane/sst-8xm.33`, based on `6ad0939808c3c1c438415d45409a5a4c30e281bd`.

## Commits

- `68d3646f` — `feat: parse Solid storage description services`: internal dataset mapper,
  JSON-LD/Turtle acceptance fixtures and malformed-input tests, required RDF dependencies,
  and the storage-capabilities lockfile importer update.
- `docs: record Solid description parser lane results` (this final commit): package README,
  local skill guidance, and this report.

## Result

`src/solid-description.ts` implements ADR-002 step 5c using `@rdfjs/wrapper` views.
Subscriptions on any subject map to SolidNotificationService entries with channel types
and features. Root-scoped DID services, LWS capabilities, and ACQ endpoints map to the
existing contracts. Unknown types, profiles, identifiers, and expanded extra properties
are retained. Nested blank-node extras support the ADR-008 PatchSupport structure;
cycles, repeated nodes, and excessive nesting remain finite.

The three acceptance cases pass: CSS-style `/.well-known/solid` JSON-LD produces two
SolidNotificationService entries; the ADR-008 Turtle example produces four services and
three capabilities; ACQ endpoints produce SparqlQueryService entries. All RDF fixtures
are parsed through `@jeswr/fetch-rdf`'s `parseRdf`, with the notification context supplied
offline through an explicit loader. No tests use network access.

Conservative integration choice: the mapper remains internal and returns only
`{ services, capabilities }`. Fetching, origin validation, complete StorageDescription
metadata, and public resolver APIs belong to the resolver lane. The existing type-only
package root and reserved subpath exports are unchanged. Extra singleton values are
scalars, repeated values are arrays, and literal values retain their lexical strings.
Named entries retain IRI identifiers; anonymous entries omit `id`. Missing/non-IRI
service endpoints are skipped while valid sibling entries survive.

## Validation

All final validation commands below exited 0 before this final commit:

```sh
pnpm --filter @jeswr/fetch-rdf run build
pnpm --filter @jeswr/storage-capabilities run lint && pnpm --filter @jeswr/storage-capabilities run build && pnpm --filter @jeswr/storage-capabilities run typecheck && pnpm --filter @jeswr/storage-capabilities run test
pnpm run lint:root
pnpm exec turbo run build typecheck test --filter=...@jeswr/storage-capabilities
pnpm install --offline --frozen-lockfile
git diff --check
```

- Package gate: PASS; five test files, 113 tests, including ten new mapper tests.
- Coverage: PASS; statements 238/238, branches 158/158, functions 28/28, lines 198/198
  (100% in all four categories, with the existing thresholds unchanged).
- Root lint: PASS, including all workspace, layer, transport, fetch, token, and contrast guards.
- Turbo gate: PASS, four tasks. No workspace package currently depends on
  storage-capabilities; Turbo selected it and built its fetch-rdf prerequisite.
- Offline frozen installation: PASS; lifecycle scripts remain disabled. Initial
  `pnpm install --offline` also passed, with existing unrelated peer-dependency warnings.
  Unrelated peer snapshot churn was removed; the final lockfile diff only adds this
  package's importer dependencies and the frozen install confirms consistency.
- Initial test attempts found missing local fetch-rdf build output and an incorrect test
  loader return shape. Both were corrected before the passing package/Turbo gates.
- Whole-workspace gates and `gate:full` were not run, per the lane brief.

## Dependency checks

Run before adding the third-party dependencies:

```sh
pnpm run check:packages @rdfjs/wrapper @rdfjs/types n3
pnpm run check:packages @types/n3
```

Both PASS in full npm mode (policy, registry existence, and minimum age).
The runtime dependencies are `@rdfjs/wrapper`, `@rdfjs/types`, and `n3` (factory only);
development dependencies add `@types/n3` and the existing workspace package
`@jeswr/fetch-rdf` for real RDF parsing in tests. Versions match existing suite consumers.
No new third-party package versions were introduced into the lockfile.

Additional policy-only validation also passed:

```sh
pnpm run check:packages --scan packages/fetch-rdf/package.json --mode policy
```

## Unfinished, blocked, and open questions

Implementation and scoped gates are complete. No open design questions.

Automated per-commit review could not run: `roborev status` exited 127
(`roborev: command not found`), and no roborev tool or post-commit hook is available in
this environment. The dispatcher must run the charter's review before integration.
No other checkout was modified, and no fetch, push, PR, or branch switch was performed.

## Fix round 1 — shared blank-node definitions

Addressed the sole finding from the review of `9cde00e79766`.
Expanded nested blank-node definitions now retain an `@id` matching subsequent references.
Callers can resolve a shared PatchSupport format to its source and patch types regardless
of whether the extension predicate or `ssd:format` occurs first. The conservative choice
is to keep the existing bounded, once-per-node expansion and identify its definitions,
as permitted by the review. Package documentation describes the reference representation.

Commits:

- `64fe4893` — `fix: preserve shared blank-node definitions`: mapper fix, two regression
  cases covering both predicate orders after JSON serialization, adjusted nested-object
  expectations, and package README/skill guidance.
- `docs: record shared blank-node fix validation` (this final commit): this report.

Validation commands run in this checkout:

```sh
pnpm --filter @jeswr/fetch-rdf run build
pnpm --filter @jeswr/storage-capabilities run lint && pnpm --filter @jeswr/storage-capabilities run build && pnpm --filter @jeswr/storage-capabilities run typecheck && pnpm --filter @jeswr/storage-capabilities run test
pnpm run lint:root
pnpm exec turbo run build typecheck test --filter=...@jeswr/storage-capabilities
git diff --check
```

All commands above PASS before the final commit. Package tests: five files, 115 tests;
coverage: 100% statements (238/238), branches (158/158), functions (28/28), and lines
(198/198). Root lint passes all guards. Scoped Turbo gate passes all four tasks, including
the fetch-rdf prerequisite build; no dependent workspace packages are selected.
Whole-workspace gates and `gate:full` were not run, per the lane brief.

The regression command below was run from `packages/storage-capabilities` before the fix:

```sh
pnpm exec vitest run src/solid-description.test.ts --coverage.enabled=false -t 'resolves shared PatchSupport'
```

Both cases failed on the original mapper because the expanded definition lacked `@id`;
both pass in the final package gate. An earlier test attempt could not load fetch-rdf's
missing `dist/`; the prerequisite build resolved that environment issue. Initial package
lint requested formatting of the changed expression; formatting was applied before the
passing gates.

No dependencies or manifests changed; `check:packages` was not required. No unfinished
implementation work or open questions. Automated commit review remains unavailable:
`roborev status` exits 127 (`roborev: command not found`), so the dispatcher must perform
the charter's review before integration. No fetch, push, PR, branch switch, or modification
of another checkout was performed.
