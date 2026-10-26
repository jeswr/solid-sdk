<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# SH-L2 questions and conservative defaults

1. The SH-L2 task and specs/apps/10-pure-libraries-2.md require weights, BM25,
   prefix search and snippets without specifying constants, query combination, or
   offsets. Options: configurable ranking/query grammar or fixed plain-text rules.
   Applied fixed title/body weights 3/1, BM25 k1=1.2 and b=0.75 with positive IDF,
   AND across unique words, prefix expansion for the final unique word, stable id
   ties, UTF-16 half-open highlights of entire matched words, and a default
   160-grapheme snippet (soft cap to retain the complete first match).
2. Shell spec §5 and SDK assumptions §6/§10 describe the eventual useSearch façade,
   but SH-L2 explicitly asks for a pure library. Options: wire SDK/hooks now or expose
   a separate index for later integration. Applied the latter: opaque id/title/body
   records, explicit add/update/remove and versioned JSON restore. No SDK/UI wiring,
   permissions, type/scope filters, persistence side effects or account switching.
3. SH-L2 specifies Unicode case folding without a locale. Options: locale-dependent
   behavior or a fixed segmenter locale and Unicode default non-Turkic folding.
   Applied fixed English Intl.Segmenter word boundaries (including its multilingual
   segmentation) and default non-Turkic folding. NFKD precedes case folding and mark
   removal. Ill-formed UTF-16, invalid schemas, invalid lengths, unknown snapshot
   versions, duplicate adds and missing updates throw SearchIndexError. Punctuation
   is a word separator, not query syntax; empty/punctuation-only queries return [].
   Word boundaries are determined after folding. Each normalized UTF-16 unit maps
   to its original grapheme for highlighting, including compatibility expansions
   into multiple words; such words can share or overlap original source ranges.
