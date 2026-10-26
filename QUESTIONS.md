<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-kgpc conservative interpretations

1. **Pin and archive** (NOT-L3 task; 07-parity-backlog.md, Notes): should archive reject a
   pinned note, or clear its pin? This implementation clears the pin. Unarchive returns an
   unpinned active note. Trash saves both location and pin, and restore recovers them.
2. **Label collisions** (NOT-L3 task; 07-parity-backlog.md, Notes): should rename implicitly
   merge into an existing label, or require explicit merge? Rename rejects an existing target;
   merge is explicit. Identity follows the existing exact, case-sensitive notes label contract.
   Missing source labels are idempotent no-ops; the library has no separate label registry.
3. **Search tiers** (NOT-L3 task; 13-pure-libraries-5.md): phrase/prefix/token boundaries and
   field weighting are unspecified. Reuse the suite's Unicode tokenizer. Phrase means a
   contiguous sequence of complete words within one title, body, or individual label. Prefix
   means that sequence with only its final word incomplete. Token matches require all query
   words, in any order across fields. All fields have equal weight; recency breaks tier ties,
   then original input order. Empty or wordless queries return no results. Search consumes
   projected plain text; callers choose which locations to search. No query language is added.
