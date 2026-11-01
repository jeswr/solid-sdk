---
name: federation-codegen
description: Use when generating a typed domain model from a sector ontology plus SHACL profile, writing a codegen.config.json, running admission or the fidelity assertion, migrating a hand-written model package to generated code, or changing @jeswr/federation-codegen.
---
<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Domain-model code generation

`@jeswr/federation-codegen` lives in `packages/federation-codegen`. It compiles an OWL/RDFS
ontology, its SHACL profile and a per-domain `codegen.config.json` into:

| Artifact | Contents |
|---|---|
| `model.d.ts` | Types only. |
| `model.json` | The shape-manifest, fidelity-asserted against `shapes.ttl`. |
| `model.js` | Fixed-template shim over `@jeswr/model-runtime`; bytes vary only in inlined JSON. |
| `shapes.ttl` | Skolemized, byte-reproducible SHACL. |
| `codegen.lock.json` | Input/output hashes; regeneration fails closed on input drift. |

```ts
import { emitLockfile, generateModel } from "@jeswr/federation-codegen";

const result = generateModel({ ontologyTtl, shapesTtl, config });
// result.artifacts: { "model.d.ts", "model.json", "model.js", "shapes.ttl", "codegen-manifest.json" }
```

CLI: `federation-codegen gen --ontology <ttl> --shapes <ttl> --config <json> --out <dir>`
(`--update-lock` accepts a reviewed input change).

## Rules

- Admission (tier a) must pass: every class/property labelled and defined, domain/range or a
  waiver, every literal datatyped, every class covered by a NodeShape. Do not pass
  `--allow-unadmitted` in committed generation scripts.
- Requiredness comes from SHACL severity (G1): only `sh:Violation` `minCount >= 1` is
  fail-closed. SHOULD constraints are `sh:Warning`. Config cannot disable a MUST.
- `iriScheme: "https"` is the HTTPS-only guard compiled from `sh:pattern "^https://"`;
  `"http-https"` permits both schemes. Fidelity rejects widening an HTTPS-only shape.
- SHACL admission is closed: unsupported property/node constraint components and unknown
  patterns are errors. Supported patterns are exactly `^https?://`, `^https://`, and `\S`
  for string-valued nonblank fields. Advisory flat class/node hints may only be omitted with
  a warning, because they cannot weaken a Violation MUST. Composite link targets must satisfy
  their class (explicit ontology subclass ancestry allowed) and referenced node shape.
- Config may add guards (defaults, trims, sort, http(s) scheme) but never contradict the
  shape; the fidelity assertion fails if a guard value disagrees with SHACL or a MUST is dropped.
- `skos:closeMatch`/`exactMatch` are not substitutions. Generate the exact IRIs in the profile.
- Consumers keep a hand-written facade (target 150 lines or fewer) that maps the generated
  entity onto their public API. The parity bar is the package's existing tests run verbatim
  against the facade (the oracle method).
- Commit generated output and test that a fresh generation is byte-identical.
- RDF discipline holds: parse with n3/fetch-rdf, serialise with n3.Writer, no LDO.

The design of record is `decisions/0003-domain-model-codegen.md`.
