<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MCP-05 questions and conservative readings

1. KG DESIGN §4.1 lists overlapping belief sets and leaves a Current explicit claim
   with unresolved contradiction/revision links unassigned. Options: overlapping
   results, or one consumer-facing level. Use one level: past standing or a later
   revision takes precedence; unresolved non-documentary conflicts are `might`.
   Current Documented claims retain the design's stronger standing. Corroboration
   counts distinct nanopubs sharing the assertion, independently of belief.
2. MCP DESIGN §4 names ServiceProvision and Personalisation but does not enumerate
   other accepted purposes or prescribe category hierarchy loading. Options: load
   remote vocabularies, or use explicit local categories. Accept only those two
   purposes, evaluate every declared category, and deny missing/unknown categories
   unless explicitly permitted by the policy. No remote vocabulary loading.
3. MCP DESIGN §3 PodPort has no ACL discovery or typed error contract; §4 requires
   the matrix-chat-to-pod ACL-first pattern. Options: extend PodPort, or retain its
   interface. Use the specified `.acl` WAC convention, fail on ACL errors, and
   recognize numeric `status` or the existing fetch adapter's `HTTP <status>` errors.
   Rewritten TriG may be replaced only with its read-back ETag; no blind overwrite.
4. KG DESIGN §4.2 acceptance references queries and the private pilot, neither of
   which is present in the supplied source snapshot. Options: import private data,
   or test synthetic data against §4.1. Use fictional fixtures and the existing
   independent Python builder oracle. Exact query/pilot parity remains unverified.
5. MCP DESIGN §4 says scheduling is allowed without naming its PD category. Options:
   invent a category, or permit scheduling's contact/preference data using existing
   categories. Use existing categories; DPV-PD 2.0 has no `pd:Schedule`. Unmatched
   scheduling categories deny until an owner policy explicitly permits them.
