<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# VOC-04 interpretations

1. DECISIONS V9 / VOC-04 asks to replace the category parent link, but the imported
   money model has no parent accessor. Options: introduce a `parent` accessor using
   `skos:broader`, accepting old `pm:parent`, or defer hierarchy support. Conservative
   implementation: add that accessor and read alias; preserve category identifiers.
2. DECISIONS V9 makes the old pod-money namespace read-only, while existing account,
   category, ofAccount and asOf predicates have no replacements specified. Options:
   retain their local names under `NS.POD_MONEY` already supplied by VOC-03, or invent
   sector replacements. Conservative implementation: use `NS.POD_MONEY` for those
   existing glue terms; only Category and parent receive the specified replacements.
3. VOC-04 includes solid-chat-interop, whose readers model messages, not room
   descriptors (pc: only appears in exported constants and serializer prefixes).
   Options: add room APIs, or retain the API and accept legacy pc: vocabulary when
   serializing existing datasets. Conservative implementation: retain the API,
   canonicalize pc: predicates/class objects on dataset serialization, and verify
   message fixtures containing canonical and legacy room descriptors both parse.

These interpretations do not block implementation; no additional decision is required
for this lane.
