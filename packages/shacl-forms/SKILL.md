---
name: shacl-forms
description: Use when compiling a runtime SHACL form, designing form descriptors, validating form values, or building/parsing/serializing pod response RDF with @jeswr/shacl-forms.
---
<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->

# Runtime SHACL forms

Use `compileForm(dataset, namedShapeIri)` to admit shapes before displaying a form.
It returns frozen descriptors. Use `validate`, then `build`, `serialize`, and `parse`
for responses. Use `formToShapes` for designer writes, then compile the resulting
shapes again. Import all six from `@jeswr/shacl-forms`.

- This is the generic P2 runtime, not a domain model. Domain model packages still
  use federation-codegen; never hand-write domain accessors or edit generated code.
- Read the [admission table](README.md#admission-table). Only reviewed SHACL
  constraints are supported. Unsupported components throw `FormAdmissionError`
  naming the construct and shape. Never catch admission failure and render a
  partially compiled form.
- Keep model-runtime guards imported. No duplicated scalar, datatype, sanitization
  or class-membership implementations. Use wrapper accessors for graph writes.
- Four nested NodeShapes including the root are allowed. Node references must be
  named, explicit NodeShapes; complex paths, aliases and cycles are rejected.
- `sh:maxLength` is rejected for generator parity; multiline comes only from
  `dash:singleLine false`. No arbitrary regex compilation.
- Date fields accept valid `Date`s, numeric fields numbers, boolean fields booleans.
  `maxCount: 1` parses as a scalar; all other cardinalities parse as arrays.
- `validate().valid` ignores advisory issues; build throws on violations. Parse
  drops malformed values and never throws. Nested children must fully conform.
- Response subjects and IRI values are HTTP(S) only. Preserve IRI enum identities;
  other IRI values use the shared runtime normalization. Class constraints use
  actual data types/subclasses; no remote graph fetches.
- Keep `name`, reviewed `pattern`, `message`, `hasClass` and graph `prefixes` while
  editing descriptors. A custom `key` supplies `sh:name` for a new descriptor;
  keep retained `name` and `key` consistent on edits. Unknown descriptor keys or
  inconsistent key/kind projections fail inverse admission.
- `prefixes` comes from `sh:declare`, since DatasetCore has no Turtle prefix map.
  Build/formToShapes stores retain prefixes for serialize in memory.
- This package is security-critical and browser-safe. Preserve graph, scalar,
  value-count and depth budgets. Add adversarial tests for any admission change.

Run the package gate and `pnpm run lint:root`; do not publish without review.
