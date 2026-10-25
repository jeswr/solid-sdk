<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CHT-L1 spec clarifications

1. **Markdown dialect and mention syntax** (`09-pure-libraries.md`, CHT-L1;
   `07-parity-backlog.md`, Chat): full CommonMark or a small literal-preserving subset;
   resolved contacts or arbitrary inferred identities? Conservative implementation:
   star/underscore emphasis, backtick code, fenced blocks, flat ordered/unordered lists,
   line-prefixed quotes, backslash escapes; unsupported or unmatched syntax remains text.
   Mentions are `@handle` (optionally resolved through caller-supplied contacts) or
   `@[Display name](https://example.org/profile#me)`. No network identity inference.
2. **URL/WebID display** (same sections): decode international hostnames or show their
   ASCII punycode form? Use the native URL parser's ASCII hostname in both the destination
   and visible label, including WebID fragments. Only explicit HTTP(S), without credentials
   or backslashes, becomes a link. An arbitrary URL is never asserted to be a verified WebID.
3. **Grouping interval/day boundary** (same sections): fixed or caller-configurable gap;
   local or UTC day? Default to a configurable five-minute inclusive gap between consecutive
   same-author messages, splitting at UTC midnight. Preserve input order; never sort or merge
   across another author, invalid timestamps, or backwards time. Timestamps are epoch
   milliseconds. The eventual timeline can supply its own interval.

These choices unblock the pure library; product confirmation can happen with CHT-02.
