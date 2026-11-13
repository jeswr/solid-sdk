<!-- AUTHORED-BY Codex GPT-6 -->

`v1.jsonld` is the Answerable 1.1 context, identified by
`https://w3id.org/jeswr/awp/context/v1`. Its exact bytes are SHA-256 pinned in
`src/wire/contexts.ts`; changing a definition requires a new context version.

The complete credentials-v2 and data-integrity-v2 context documents are copied from
`@jeswr/solid-vc`'s bundled W3C contexts (retrieved 2026-10-25). They retain the W3C
Software and Document License: https://www.w3.org/copyright/software-license/.

`odrl-v1.jsonld` is the **supported SDK ODRL subset**, copied from
`@jeswr/solid-odrl`'s exported `ODRL_INLINE_CONTEXT`. Its identifier is
`https://w3id.org/jeswr/awp/context/odrl/v1`. It is not presented as the full W3C
ODRL context. A full W3C context artifact was not available offline. All four
documents have independent, literal SHA-256 pins; the loader never fetches.

The standard Data Integrity context puts proof options in a named graph.
Lossless RDF transport of a signed document therefore uses TriG or N-Quads.
`toTurtle` refuses datasets with named graphs instead of discarding those graphs.
