<!-- AUTHORED-BY Codex GPT-6 -->

# sst-imb.6 — CON-00H

Fixed the single finding in the cited `solid-sdk-lane-sst-hd1k-c16412abe0d9.md`
review. The shared `Contact.webId` getter now gives explicit `vcard:WebId` blank
nodes priority over generic URLs. An explicit node without a valid value preserves
a cleared selection. `parsePerson` inherits these semantics from the getter.
Legacy URL fallback remains available when no explicit WebID node exists.

Implementation commits:

- `3ef4aa69` — honor explicit selections and clearing in the shared contacts reader;
  add regression fixtures through both public APIs.
- `5d7b6d98` — retain the cited reader's RDF IRI validation as well as canonical URL
  validation for explicit selections; cover RDF-forbidden in-memory values.

Verification used Node 24.22.1 and pnpm 10.4.1:

- `pnpm --filter @jeswr/solid-task-model lint`, `build`, `typecheck`, and `test`:
  passed; 166 tests, including 26 WebID regressions.
- `pnpm --filter @jeswr/app-suite lint` and `typecheck`: passed. Lint reports 40
  existing warnings in unrelated application libraries.
- `pnpm --filter @jeswr/app-suite test --maxWorkers=1 --testTimeout=30000`: passed;
  4,399 tests and 100% statement, branch, function, and line coverage.
- `pnpm run lint:root`: passed.
- `pnpm run test:root --maxWorkers=1 --testTimeout=30000`: passed; 745 tests.
- `pnpm run gate:full`: failed in unchanged root tests. An agent-layer test exceeded
  its five-second timeout, and the SDK-layer pathological-spec assertion took
  101 ms against a 50 ms limit. Both passed in the isolated root run above.
- The initial application test run also exceeded a calendar test's five-second
  timeout. Parallel retries encountered vCard/calendar timeouts, including a
  calendar test's explicit ten-second limit. The final single-worker run passed
  without source or test-configuration changes.

Conservative scope and limitations:

- The supplied base lacks `apps/suite/src/apps/contacts/lib/model/`. The fix targets
  the available shared package, using the cited commit's persisted RDF shapes and
  selection semantics. No missing feature branch or application model was imported;
  `loadContact` integration tests cannot run in this base.
- The brief's `@jeswr/suite` filter matches no project. Application checks used the
  actual package name, `@jeswr/app-suite`.
- The tracker wrapper waited on its lock and was stopped. The bead description was
  read from the tracker's checked-in issue record; tracker state was not changed.
- Roborev is not installed, so automated per-commit review was unavailable.

No additional finding work or open questions remain within this lane's scope.
The full-workspace gate is not green; its unrelated timing failures are recorded
above. No dependencies were added, and no branch was pushed or merged.
