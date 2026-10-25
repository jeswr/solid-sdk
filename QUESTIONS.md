<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-yrjy — conservative interpretations

1. 05-docs §2.3 names `diff-match-patch`; DOC-L2 and 09-pure-libraries request a
   bounded Myers library over ProseMirror JSON. Options: add the older dependency,
   or implement Myers locally. Applied the later, task-specific requirement: no dependency.
2. DOC-L2 does not define block pairing, range coordinates, schema extensions, or numerical
   bounds. Options: infer stable block IDs/schema, or use deterministic top-level JSON
   alignment and positional pairing of unmatched runs. Applied the latter; moves are
   delete/insert, nested edits belong to their outer block, and inline ranges use half-open
   UTF-16 ProseMirror positions relative to the block start. The standard image, hardBreak,
   and horizontalRule nodes are atoms; other non-text nodes are containers. JSON, node,
   text, depth and shared work bounds throw instead of silently truncating a diff.
   These choices are documented in the exported API; custom atom schemas would need
   a later explicit extension. No decision blocks this lane.
