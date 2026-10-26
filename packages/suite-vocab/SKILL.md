---
name: suite-vocab
description: Use when importing canonical suite namespace constants or comparing legacy vocabulary IRIs.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Suite vocabulary constants

Import `NS`, `LEGACY_NAMESPACES`, `canonicalize`, `isLegacy`, and `termsEqual` from
`@jeswr/suite-vocab`. Writers use `NS` canonical bases. Readers compare classes with
`termsEqual` or canonicalize vocabulary predicates before typed access. Preserve resource
identifiers and literal contents. Type Index discovery must accept canonical and legacy
class IRIs; registration writes canonical classes. Do not put RDF builders, parsers or
migration I/O in this package. The federation ontology re-base is a separate task.
