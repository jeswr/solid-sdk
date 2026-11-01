<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

The SHACL gate recursively discovers `sectors/**/*.shacl.ttl`. Each directory
containing property constraints needs a matching fixture directory here (including
`core/` and `health/diet/`). Shapes are composed with locally available imported
sector profiles, including Core. No network imports or ontology inference run.
Class assertions needed by a fixture are explicit in its Turtle data.

Ordinary `.ttl` files must conform with no Warning or Info results either.
Every `.invalid.ttl` file must begin with `# expect: https://…` naming the full
`sh:path` IRI. It must produce exactly one underlying constraint result at that
path, including advisory constraints. Nested `sh:node` wrapper results are
unwrapped and duplicate reports of the same underlying failure are counted once.

Every NodeShape with enforceable property constraints needs positive target
coverage and a negative result from one of its properties. This includes
properties inherited through `sh:node`; untargeted helpers are exercised through
their callers. Empty shapes, metadata-only properties and `sh:minCount 0` alone
cannot fail. Diet's node-level genetic safety rules remain active but have no
property result path; see [the lane interpretation](../../../../QUESTIONS.md).

The package test command also runs `scripts/test-shacl-fixtures.mjs`, which breaks
copied expectations, adds extra failures and removes fixture coverage to prove
that the gate fails. Temporary copies are removed afterward.
