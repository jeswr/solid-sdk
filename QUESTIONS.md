<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MAI-L6 conservative interpretations

1. `13-pure-libraries-5.md` / tasks.json MAI-L6 says “normalised address” without defining
   local-case equivalence. Options: lowercase the entire mailbox, or preserve local case and
   canonicalise quoting/domain only. Implemented the latter to avoid merging distinct recipients,
   consistent with the existing mail composer. Plus tags and dots stay significant.
2. MAI-L6 names prefix/frequency/recency without weights or an API contract. Options: weighted
   scores or deterministic ordering. Implemented full name/address prefix eligibility, frequency
   descending, latest usage descending, canonical email ascending. Inputs and merge semantics
   are documented in the library README; no clock or product-specific weights are introduced.
3. MAI-L6 requires RFC 5322 parsing and fail-closed handling. Options: support obsolete syntax,
   encoded words and domain literals, or explicitly reject unsupported forms. Implemented modern
   mailbox/group syntax plus Unicode display names/IDN domains; excluded forms produce typed
   errors rather than guessed addresses. Full exclusions and bounds are in the library README.
