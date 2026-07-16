<!-- AUTHORED-BY GPT-5.6 Sol via codex -->

# @jeswr/synthetic-rdf

Deterministic, browser-safe synthetic RDF generation driven by SHACL node shapes. The same package
supports stable CI fixtures, scripted demo personas, and in-browser pod seeding without a network,
ambient clock, or ambient entropy.

## Install

```sh
pnpm add @jeswr/synthetic-rdf n3
```

Install `shacl-engine` when using the provided independent-validator adapter:

```sh
pnpm add shacl-engine
```

## Generate checked data

```ts
import { generate } from "@jeswr/synthetic-rdf";
import { shaclEngineValidator } from "@jeswr/synthetic-rdf/validate";

const generated = await generate({
  shapes,
  seed: "mortgage-demo-v1",
  now: new Date("2026-07-15T12:00:00.000Z"),
  validator: shaclEngineValidator(),
});

generated.dataset; // RDF/JS DatasetCore
generated.instances;
generated.toTurtle(); // canonical, byte-stable Turtle
```

`generate()` always invokes an injected validator after overrides are merged. The deliberately
named `generateUnchecked()` escape hatch is reserved for browser paths whose exact fixed inputs
already passed checked golden tests in CI.

Independent validation uses temporary `sh:targetNode` declarations for every generated focus and
resolves applicable source class, node, and predicate targets against the generated dataset, so an
explicit target request cannot produce a vacuous pass. Custom target extensions fail loudly.

## Determinism and overrides

Every occurrence uses its own PRNG stream keyed by seed, shape IRI, instance index, property path,
and occurrence. Adding or pinning one coordinate cannot reshuffle sibling values. `now` is explicit
and is required only when a temporal default is actually used. Default focus IRIs include a stable
hash of the complete shape IRI, preventing equal local shape names from colliding.

An override replaces the complete value set for one property. Identity pins are distinct:

- `{ fragment: "applicant" }` remains destination-relative for later pod rebasing.
- `{ external: webId }` remains absolute, but is accepted only when its exact IRI appears in
  `allowedExternalIris`. Placeholder-base IRIs are always rejected as external identities.

Generation resolves values in this order: override, `sh:hasValue`, `sh:in`, `sh:node`/`sh:class`,
datatype facets, pattern, then plugins and type defaults. Other conjunctive constraints are checked
after the driving strategy. Documented out-of-scope SHACL features fail loudly.

## Pattern subset

Patterns support literals, character classes and ASCII ranges, `\\d`, `\\w`, grouping,
alternation, and bounded `?`, `+`, `*`, `{n}`, and `{n,m}` quantifiers. `^` and `$` anchors are
accepted. Lookarounds, backreferences, Unicode/property escapes, wildcard dots, and unbounded
explicit ranges are rejected.

## Browser safety

The source imports no Node built-ins and never reads `Math.random`, `Date.now`, or
`crypto.getRandomValues`. Shapes, ontology hints, clock, validator, and plugins are caller inputs.
