---
name: synthetic-rdf
description: Use when generating deterministic RDF/JS instances from SHACL shapes, defining synthetic persona overrides, adding generator plugins, or integrating @jeswr/synthetic-rdf validation and Turtle output.
---
<!-- AUTHORED-BY GPT-5.6 Sol via codex -->

# Deterministic synthetic RDF

Use `generate()` by default and inject an independent `ShaclValidator`. Import
`shaclEngineValidator()` from `@jeswr/synthetic-rdf/validate` when `shacl-engine` is available.
`generateUnchecked()` is an explicit escape hatch only for exact inputs already validated in CI.

## Load-bearing rules

- Pass a stable string `seed`; never introduce ambient entropy.
- Pass `now` whenever a temporal default can fire. Do not read the wall clock in a plugin.
- Plugins may draw only from `context.random`; fork it for logically separate choices.
- Preserve coordinate identity: shape IRI, instance index, predicate path, and occurrence determine
  a stream. Do not add shared sequential random state.
- Use `{ fragment }` for identities that solid-seed will rebase. Use `{ external }` only for real
  absolute IRIs, and exact-list each one in `allowedExternalIris`.
- Treat an override as replacement of the property's full value set. Never post-process generated
  quads to implement a persona.
- Keep shapes and ontology graphs caller-supplied. The package performs no fetch or RDF parsing.
- Serialize through `SyntheticRdfResult.toTurtle()` so canonical quad order and prefixes remain
  stable.

## Resolution and failures

Resolution order is override, `sh:hasValue`, `sh:in`, `sh:node`/`sh:class`, datatype facets,
pattern, plugins, defaults. The selected tier drives generation; every other supported constraint
is still checked. Unsupported constraints, recursive shapes, invalid overrides, and failed
independent validation are errors, never best-effort output.

## Tests

Pin `seed` and `now` in golden tests. For a new constraint, test its driving tier, conflicting
conjunctive facets, deterministic output, and an invalid override. For a plugin, test that changing
an unrelated coordinate does not perturb its output.
