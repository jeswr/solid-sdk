<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# SKL-03 specification questions

1. **Offline skill name collision (skills DESIGN §2 D1, D2, D4).** D2 retains both a shared
   offline pattern guide and the package API skill, while D4 forbids duplicate names and D1
   requires names to equal directory names. Options: exempt this duplicate, merge the guides,
   or rename the shared guide. Conservative implementation: retain all content and package
   API guidance, rename only the shared directory/name to `solid-offline-patterns`, and update
   its incoming link. This preserves strict validation without changing either guide's advice.
   Open for maintainer confirmation of the shared guide's preferred name.

2. **Existing package metadata (skills DESIGN §2 D1, D4).** The imported package skill
   `packages/fetch-rdf/SKILL.md` uses `solid-fetch-rdf`; nine package descriptions do not start
   with “Use when”. Options: grandfather these values or align their metadata with D1.
   Conservative implementation: apply D1 to both source locations, change the fetch skill's
   frontmatter name to `fetch-rdf`, and add trigger prefixes without changing package code.
   Historical prose referring to `solid-fetch-rdf` remains readable; the package path is unchanged.

3. **Secret patterns and companion scope (skills DESIGN §2 D4; MCP DESIGN §6).** W9 names
   redaction categories but does not specify exact regexes, and its capture package is a scaffold
   in this base. Options: inspect only SKILL.md, or include companion material; flag all config
   assignments, or flag credential-bearing assignments with explicit template exceptions.
   Conservative implementation: scan all shared skill files, package SKILL.md and package
   `references/`; reject private-key headers, sk-/ghp_-style keys, AWS access-key IDs, JWTs,
   Authorization values, and environment assignments whose names contain TOKEN, SECRET,
   PASSWORD, or KEY. Explicit placeholders are allowed; diagnostics omit matched values.
   Non-secret configuration such as PORT and ISSUER remains valid. No package implementation
   directories or external link destinations are scanned.
