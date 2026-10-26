<!-- AUTHORED-BY Codex GPT-6 -->

# sst-5ax.2 — MCP-04H

Implemented the three findings named in bead sst-5ax.2 and the cited review
`solid-sdk-lane-sst-jhl3-14489f73ce44.md`. Base:
`6323e7ec0bd7a9dc7cf1a1426db29c8634773044`.

Commits:

- `98095e68` — validate blank-node labels against the Turtle/TriG grammar before
  assertion hashing/building and serialization. Export the typed
  `UnsupportedBlankNodeLabelError`. Reject unsupported labels without remapping;
  cover malformed labels, Unicode, and shared subject/object/graph references.
- `db2ed4fb` — deduplicate otherwise identical language statements without case
  within each graph, retaining the first spelling. Cover caller datasets,
  Turtle, mutable stores, graph isolation, assertion sharing and TriG parsing.
  Pin named/blank-subject IDs and graphs with RDFlib 7.1.4 reference oracles.
- `42b22255` — apply the existing date-literal normalizer to document/email
  source dates. Pin reference-builder results for timezone forms, leap/early
  dates and unrepresentable lexical values, including audit-only batches and
  typed rejection of excluded literal characters.

Validation:

- Package typecheck and tests passed: **436 tests**, with **100% statements,
  branches, functions and lines**.
- The required affected gate passed, including package lint/build/typecheck/test,
  dependency builds and `pnpm run lint:root`: **7/7 Turbo tasks**.
  Command: `GIT_ALLOW_PROTOCOL=file TURBO_SCM_BASE=6323e7ec0bd7a9dc7cf1a1426db29c8634773044 pnpm run gate`.
  There are no current workspace dependants of `@jeswr/pkg-memory`.
- The initial unqualified `pnpm run gate` selected all projects because this
  checkout has no local `main` ref. It failed on two unchanged
  `tools/federation-codegen/test/generator.test.ts` tests: bookmarks target-class
  namespace mismatch and generated `ontology.ttl` drift.
- `GIT_ALLOW_PROTOCOL=file pnpm run gate:full` failed on the same two unrelated
  tests. No changes were made outside the brief's package surface and this report;
  no remote fetch/merge or dependency additions were performed.
- `git diff --check` passed. Python fixtures were generated with the existing
  local RDFlib 7.1.4 environment and unmodified reference builder, using synthetic
  inputs only.

Operational limitations: `roborev` is unavailable, so automated commit verdicts
could not be obtained. `lanes/bdl show sst-5ax.2` could not open the read-only
tracker database; the bead description and notes were read from its checked-in
issue record instead. Tracker state was not changed.

No implementation work remains. No open questions. The conservative choice for
unsafe blank-node labels is typed rejection rather than identity remapping.
