<!-- AUTHORED-BY Codex GPT-6 -->

# sst-8xm.80 — T-072H

Implemented the policy-subject identity finding from
`solid-sdk-lane-sst-8xm.60-1c3aaf153585.md` in commit `0609f8ae`
(`fix(rdf-engine): preserve policy subject term identity`).

Tracing recovers the selected subject from recognized policy type assertions,
then uses RDF term equality for policy rule and obligation scans. Same-value
named and blank subjects cannot contribute each other's references. Repeated
type assertions for one subject remain supported. Regression tests cover both
real and fake engines, unchanged inputs, repeat evaluation, and unrelated,
permission, prohibition and obligation references on the other subject.

Conservative choice: when distinct typed subjects share the projected policy ID,
reject with exported `PolicySubjectUnsupportedError` rather than infer the lost
term type. The error extends `TypeError`, carries `identifier`, and is exported
from all four entry points. Tests cover rejection before action matching.

Validation:

- All 18 new regression cases fail against the original implementation; all
  100 policy tests pass with the fix.
- `pnpm exec turbo run lint build typecheck test --filter '...@jeswr/rdf-engine' --concurrency=4`
  passes: 8 tasks including dependency builds and `lint:root`, 224 package tests,
  99.79% line and 98.17% branch coverage. Turbo reports no current dependants.
- `pnpm run gate:full` fails at `@jeswr/federation-codegen#test` after 228
  successful tasks. Two existing generator tests expect `w3id.org` bookmarks
  namespaces while ontology inputs use `jeswr.org/ns`; fresh generated output
  therefore differs from committed output. The tool has no rdf-engine dependency;
  its files and solid-federation-vocab are unchanged from the lane base. The
  remaining full-workspace tasks were not all completed. Root tests passed
  (686 tests).
- `git diff --check` passes.

Environment limitations: `lanes/bdl show sst-8xm.80` cannot open the tracker's
read-only database. The bead description was read from its existing issue JSONL
export instead; tracker state was not changed. `roborev` is not installed and no
post-commit review hook is present, so automated review could not run. No tools
were installed, dependencies added, or remotes accessed.

Implementation is complete within the named finding. Full-workspace validation
remains blocked by the unrelated generator failures. No open implementation
questions. This status report is the final lane change.
