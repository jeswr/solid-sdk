<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# DRV-L3 conservative interpretations

1. **Sort defaults and missing metadata** — 04-drive §2.2/§4.11 lists keys and direction but
   does not specify ties, locale defaults or absent values. Options: guess missing values or
   preserve their absence. Implemented: stable ties, default English numeric/base collation
   (caller can supply a supported locale), ascending name, folders first; unknown metadata
   sorts last in both directions. Modified inputs are valid `Date` instances, following the
   façade shape in 00-sdk-assumptions §4; the caller adapts other SDK representations explicitly.
2. **MIME families** — 04-drive §2.2 names chips without an exhaustive mapping. Options:
   infer from file extensions/RDF types or classify declared MIME only. Implemented: declared
   MIME only, case-insensitive with validated parameters; text/office documents, PDF, media,
   JSON/XML/RDF/CSV data, and other. Missing MIME is Other; invalid MIME raises a typed error.
   The source table documents exact supported document/data types; no extension guessing.
3. **Range anchors** — 04-drive §4.4 and 01-design-system §6 do not define modifier combinations,
   focus-only movement or anchors hidden by filtering. Implemented: range replaces selection,
   optional additive range unions it; keyboard focus movement preserves selection and establishes
   the next anchor; extending preserves that anchor. IDs survive sort/view changes. Select-all
   selects exactly visible IDs. A range with an anchor absent from the visible order raises a
   typed error; callers can establish a fresh anchor or clear on navigation.
4. **Move ancestry** — 04-drive §2.9/§4.2 does not define ancestry for opaque LWS identifiers,
   aliases or ambiguous URL paths. Options: guess ancestry or reject unsupported addresses.
   Implemented: hierarchical HTTP(S) paths only, containers ending in `/`; compare decoded path
   segments on the same origin. Reject credentials, queries, fragments, dot/empty segments,
   encoded separators/percent and malformed escapes. Opaque/non-hierarchical container IDs
   require a future caller-supplied ancestry model; this library never claims they are safe.
