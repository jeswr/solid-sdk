<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-gxon scope interpretations

1. Does “write canonical terms only” (VOC-06 description; DECISIONS V1) include
   rewriting caller-supplied resource and spec-version IRIs, or only vocabulary
   terms owned by the federation builders? Options: rewrite all matching IRI
   objects, or preserve supplied identifiers and emit canonical federation
   classes, predicates and status values. Conservative choice: preserve supplied
   identifiers. `acceptsSpec` explicitly promises exact immutable-version IRI
   comparisons; changing those identifiers would change the existing contract.
   Sector/shape identifiers supplied by callers are likewise retained. The
   built-in sector IRI helper now returns the canonical namespace.
