<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MCP-03 questions

1. MCP-01 is described as merged, but base `917d3be9` has no PodPort or tool
   registry (DESIGN §3). Options: import MCP-01, recreate its scaffolding, or
   implement MCP-03 against the existing guarded-fetch configuration. Selected
   the last option to keep this lane scoped; no dependency branch was imported.
2. DESIGN §4 leaves fetch metadata keys, titles, and oversized RDF unspecified.
   Options: guess semantic titles and return partial RDF, or use decoded URL
   filenames and metadata `{contentType, truncated, etag?}`, returning empty text
   for oversized RDF. Selected the latter: text is always Turtle when RDF is
   returned; binary text is empty, and binary omission is not truncation. The
   1 MiB cap applies to input bytes and rendered text (UTF-8).
3. DESIGN §4 does not give numerical search budgets. Options: retain existing
   depth/resource defaults or introduce new limits. Retained depth 4 and 500
   resources, applied across discovery and scanning, with a 5-second deadline.
   No extra keys are added to the exact `{results}` response. Memory notes and
   RDF chat titles are found through the same scan, without new store seams.
