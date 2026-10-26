<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-8xm.18.1 implementation questions

1. **Legacy-bridge shared-only acceptances** (brief, Task: “If rdf-serialize ACCEPTS
   something the old copy rejected, do not loosen”). The old final check rejects raw
   quotes/braces surviving URL parsing in hostnames, and braces/backslashes in queries
   or fragments. The shared helper escapes and accepts them. Options: accept the shared
   behavior, or retain the legacy rejection. Chosen: retain a narrow pre-check of the
   parsed href for `"`, `{`, `}`, and `\` before delegation. Percent-encoded inputs
   remain accepted as before. Corpus examples include `https://exa"mple.org/a`,
   `https://example.org/a?x={b`, and `https://example.org/a#x\b`.

2. **Drawing subject guard** (brief, Acceptance criteria: “No private copy of the
   guard logic remains ... delegates only”). `safeSubjectBaseIri` also implements HTTP
   guard logic in the targeted drawing file, but rejects every embedded C0 control,
   whereas the shared helper accepts escaped path controls. Options: leave this guard
   duplicated, or delegate with its stricter control pre-check. Chosen: delegate and
   retain the C0 pre-check; preserve the public export. This additionally adopts the
   shared helper's stricter lexical-authority requirement.

3. **Missing referenced skill** (brief, Read first: `packages/rdf-serialize/SKILL.md`).
   That file is absent at the base commit; the repository skill catalog has no replacement
   rdf-serialize skill. Options: stop, or use the canonical source and existing repository
   RDF guidance. Chosen: read the source, package exports, local legacy-bridge skill, and
   shared RDF/testing guidance and proceed without inventing a skill. No API design
   choice is required.

These choices follow the conservative reading of the brief; no maintainer answer is
required to review this lane.
