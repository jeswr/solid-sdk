<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Mail addresses (MAI-L6)

Pure, synchronous, browser-compatible TypeScript. Import the public API from `index.ts`.
No I/O, clock, provider lookups, framework imports, or new dependencies.

- `parseAddressList(text)` returns discriminated `mailbox` / `group` entries. Mailboxes use
  `{kind: "mailbox", email, name?}`; groups use `{kind: "group", name, members}`. Comments
  (including nested/escaped comments) are discarded, never promoted to names. Empty input and
  comment-only input return an empty list; empty groups are retained. Parsing preserves duplicates.
- `formatAddressList(entries, unicodeDomains = false)` quotes/escapes display names as needed,
  preserves groups, and emits ASCII domains by default. `true` renders Unicode domains. Unicode
  names are plain display text: this is not an RFC 2047 MIME-header encoder or a line-folding API.
- `normaliseAddress(addrSpec)` accepts a bare address, canonicalises equivalent local quoting,
  and converts the domain to lowercase ASCII. Local case, plus tags and dots remain significant;
  local parts can be case sensitive. `deduplicateAddresses(entries)` keeps the first occurrence
  across all groups and standalone mailboxes, with fresh objects and arrays.
- `domainToASCII` / `domainToUnicode` convert DNS/IDN domains using the platform's nontransitional
  WHATWG/UTS 46 processing and a bounded RFC 3492 decoder. Standard IDNA case/NFC/compatibility
  mappings apply. Unicode labels containing only letters, marks, numbers and hyphens are supported;
  ASCII labels obey DNS label and total-domain length limits. Unicode-dot aliases are rejected.
- `rankRecipients(query, contacts, recent, limit = 10)` matches prefixes of the full display name
  or full address (both ASCII/Unicode domain forms) using Unicode 17 default full case folding
  followed by NFC normalization for query and candidate keys. Empty query matches
  all. Results sort by descending frequency, descending epoch-millisecond `lastUsed`, then canonical
  email in code-unit order. Recent records supply positive integer `frequency` and nonnegative safe
  integer `lastUsed`; duplicate usage records sum frequency and retain the latest time. First
  contact name wins, falling back to the first supplied name; all names remain searchable. Results
  identify `contact`, `recent`, or `both` sources; contacts without usage have `0` / `null`.

The parser implements modern [RFC 5322 §3.2/§3.4](https://www.rfc-editor.org/rfc/rfc5322.html#section-3.4)
mailbox/group lists: dot-atoms, quoted local parts/display names, quoted pairs, CFWS around
grammar tokens, and CRLF folding followed by space/tab. Unfolding preserves whitespace inside
quoted local parts. Unicode display names and IDN domains are accepted for UI use; international
local parts, domain literals, obsolete routes/grammar, RFC 2047 encoded words, nested groups,
unquoted display-name punctuation, unpaired surrogates, controls and malformed lists are rejected
with `AddressError` (typed `code`, no recipient data in messages). A list is rejected as a whole;
valid fragments are never salvaged. Input is bounded to 65,536 UTF-16 code units and comments to
32 levels. Mailbox local parts are bounded to 64 characters and canonical addresses to 254.

Structured inputs receive the same validation. Validation occurs before filtering/limiting, so
an invalid unmatched recipient still fails. No fuzzy/substring matching, accent removal,
provider-specific equivalence or implicit removal of selected recipients is performed.
