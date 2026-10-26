<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CON-L3 conservative interpretations

1. **Name projection and missing names** (07, Contacts; 11, CON-L3): should display names
   be parsed, or should callers supply structured names? Use explicit `givenName` and
   `familyName`, in the requested order, falling back to `displayName`. Never infer name
   parts. An unnamed contact has an empty list name, `#` section and `?` initials.
2. **Alphabet and ties** (11, CON-L3): Latin-only sections or native-script initials?
   Use native letter initials, combine accent variants only when the requested collator
   considers them equivalent, and put nonletters in `#` last. Default to explicit `en`
   and given-first; ties use exact ID order. Reject unavailable locales.
3. **Fuzzy policy and multiple terms** (11, CON-L3): unspecified edit distance and scoring.
   Use case/accent-insensitive token prefixes, then email substrings, phone digit
   substrings, organization substrings, then name substrings and whole name-token
   Levenshtein distance one (query at least three characters). Require every whitespace
   term; sort by weakest match tier, then total tier score, then list name and ID.
   A query consisting of supported phone formatting is one digit query. Highlights are
   half-open UTF-16 offsets in original fields; fuzzy hits mark the whole name token.
4. **Avatar identity** (01 §2.2; 11, CON-L3): hash name or identifier? Hash the exact stable
   contact ID with unsigned FNV-1a over UTF-16 code units, modulo 15, indexing the spec's
   hue table in its listed order. Use first/last word initials when only a display name
   exists; structured names contribute their first graphemes in the requested order.

These choices keep the library independent of RDF, UI and storage. The dispatcher can
resolve the questions without changing any persisted data.
