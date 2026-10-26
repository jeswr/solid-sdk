<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Contact list helpers

Pure TypeScript with no UI, RDF, storage or network. Import from `./index`:

```ts
import { sectionContacts, contactAvatar, searchContacts, CONTACT_HUES } from "./index";

const contacts = [{
  id: "https://example.org/contacts/mira#this",
  givenName: "Mira", familyName: "Quill",
  emails: ["mira@example.org"], phones: ["+1 (202) 555-0101"],
  organization: "Fictional Observatory",
}];
const options = { locale: "en", nameOrder: "family-given" } as const;
const sections = sectionContacts(contacts, options); // Q
const avatar = contactAvatar(contacts[0]!, options); // QM
const hue = CONTACT_HUES[avatar.colourIndex];
const hits = searchContacts(contacts, "mir", options);
// hits[0].highlights: [{ field: 'givenName', index: 0, start: 0, end: 3 }]
```

`ListContact` is an explicit projection, not a contact model. IDs are stable opaque,
nonblank strings, compared exactly. The adapter supplies structured name parts and
bare email/phone strings. Unknown properties, nonplain records, accessors, hidden or
symbol properties, sparse/subclassed arrays, null, blank fields, control/format
characters and malformed UTF-16 are rejected with `ContactListError.code`. Optional
contact properties must be omitted, rather than set to undefined. Options may omit
or set undefined for their defaults. Errors never echo contact data or queries.

- `sectionContacts` constructs a name from the available given/family parts in the
  requested order, otherwise uses `displayName`, otherwise the empty string. It never
  parses display names, infers a surname or substitutes an email. Whitespace around
  name parts is trimmed for sorting. `Intl.Collator` uses base sensitivity; ties sort
  by exact UTF-16 ID order. The first grapheme supplies a native-script letter label.
  Decomposable accents fold only when equivalent in that locale (É → E in English;
  Å/Ä stay distinct in Swedish). Leading punctuation, digits, symbols and absent
  names use `#`, placed last. No transliteration or language-specific dictionary
  indexing is attempted. Defaults are explicit `en` and `given-family`; malformed
  or unavailable locales and unknown options throw, even with no contacts. Locale
  extensions are rejected rather than allowing unsupported extension requests to fall back.
- `contactAvatar` takes the first grapheme of each structured name part in the same
  order, uppercased with the selected locale. Display-only names use first/last
  word-like segments (one for a mononym); no name/words yields `?`. Graphemes are
  preserved, including combining marks and supplementary letters. FNV-1a over the
  exact ID's UTF-16 code units, unsigned 32-bit, modulo 15 selects `colourIndex`.
  `CONTACT_HUES` is frozen and follows design-system §2.2's table order. Renaming a
  contact, reordering a list or changing the locale does not change its colour.
- `searchContacts` lowercases by locale, applies the existing dedupe Unicode 17 full
  case-folding table (including sharp S and final sigma), and ignores Latin combining accents. Other
  scripts retain vowel marks. Each whitespace-separated term must match; duplicates
  are ignored. A query consisting of supported phone formatting is one digit term.
  Supported phone syntax is the existing dedupe helper's 1–15 ASCII digits with an
  optional leading `+`, spaces, dots, hyphens and balanced digit parentheses; no
  extensions, vanity letters, trunk inference or international prefix conversion.
  Emails use that helper's bare ASCII dot-atom/DNS-domain syntax. This is substring
  search, not identity normalization or email alias matching.
- Tiers, highest first: name-token prefix (500), email substring (400), phone digit
  substring (300), organization substring (200), name substring (100), whole name
  token within one Levenshtein insertion/deletion/substitution (50, normalized query ≥3 Unicode
  code points). Transpositions cost two edits; typo matching applies to names only.
  Every supplied name variant is searchable, including `displayName` alongside
  structured parts. Empty/space-only queries return all contacts with score zero and
  no highlights. Queries are limited to 256 UTF-16 units and 16 terms; controls,
  malformed text and malformed phone-only queries throw `invalid-query`.
- Results sort by the weakest term's tier (`score`), then sum of tiers, then list
  name/ID. For each term, highlights identify the first occurrence in the strongest
  field; ties prefer display/given/family names, then array order. Fuzzy hits cover
  the whole token. Ranges are half-open UTF-16 offsets in **original fields**, with
  `index` selecting the email/phone entry (zero for scalar fields). Normalized hits
  expand to whole source graphemes. Phone ranges include intervening formatting.
  Overlapping/adjacent ranges in the same field/entry merge. Render ranges as text;
  no HTML is produced.

Inputs are never mutated. Returned section/result containers are fresh and retain
readonly contact references; callers remain responsible for their own data ownership.
Duplicate IDs fail before processing. Every source file is included in the app's
100% per-file coverage gate. Policy choices are recorded in root `QUESTIONS.md`.
