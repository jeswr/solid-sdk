<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# T-070 / sst-8xm.58 — architect question

1. **What behavior must the WASM-free n3-backed fake implement for SHACL,
   canonicalization, and JSON-LD, and which supporting dependencies are authorized?**

   ADR-007 D2 specifies `parse`, `serialize`, `validate`, and RDFC-1.0
   `canonicalize`; its `./testing` entry is a "tiny n3-backed fake RdfEngine so
   dependents' unit tests never load wasm." ADR-007 Tests and ADR-009 D1 require
   the same contract against fake and real engines. Neither specifies exceptions
   or configurable results for the fake. n3 supplies RDF parsing, dataset storage,
   and Turtle/TriG writing, but no SHACL validator, RDFC-1.0 canonicalizer, or
   JSON-LD parser/writer. ADR-001 D4's permitted new dependencies do not include
   the JS implementations for these operations; the lane also forbids adding
   dependencies outside the task or ADR authorization.

   Options:

   - Authorize specific JS dependencies for these operations (for example,
     `rdf-validate-shacl` and `rdf-canonize`, plus an approved JSON-LD path),
     subject to `check:packages`, so the shared contract can exercise their
     semantics on both engines without WASM.
   - Define an intentionally smaller fake contract, including which operations
     reject or accept injected results, and distinguish those cases from the
     real engine's SHACL, blank-node canonicalization, and JSON-LD tests.

   Please specify the intended option and the authorized dependencies or exact
   fake limitations. I have not selected dependencies, implemented a bespoke
   validator/canonicalizer, or weakened the shared contract.

The size question is already resolved: retain `@sparq-org/sparq@0.1.5` and
enforce raw ≤ 4,194,304 B and gzip level 9 ≤ 1,572,864 B, per the architect's
2026-10-25 answer in the lane brief.
