<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# DS-12 conservative interpretations

1. **Component integration contracts** (01 §5; 00 §5): the specs define content and
   SDK methods but no component props. Options: couple components to future façade
   hooks, or accept read-only data/state props. This lane uses props: TypedView accepts
   a typed-accessor projection; DetailsPane accepts the structural `share.get` result.
   Fetching, profile resolution, preferences, responsive sheet hosting and mutations
   remain the consuming screen's responsibility. No façade dependency is introduced.
2. **Unknown properties and identifiers** (01 §1, §5; DS-12 acceptance): options are
   expose URI fragments or use a neutral label. Unmapped predicates use “Other detail”;
   unlabeled linked values use “Linked item”. Raw serialization is supplied by the
   adapter and mounted only inside an Advanced-enabled disclosure. URLs remain valid
   link destinations but never visible labels. Both schema.org schemes are accepted.
3. **Unknown quota** (01 §5; 04 §5.6): options are invent a percentage, show an
   indeterminate bar, or show used-only copy. This lane shows “used (no limit reported)”
   with an unfilled bar and accessible value text; it never implies a quota.
