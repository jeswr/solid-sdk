<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Contact duplicate detection and merge proposals

Pure TypeScript: no React, hooks, RDF, storage, clock or network. Import from `./index`.

```ts
import { clusterContacts, planMerges, normaliseName } from "./index";

const contacts = [
  {
    id: "https://example.org/contacts/a.ttl#this",
    fields: { name: "Mira Quill", organization: "Fictional Observatory" },
    emails: ["Mira+Club@EXAMPLE.ORG"],
    phones: ["202-555-0101"],
    multiFields: { labels: ["Friends"] },
  },
  {
    id: "https://example.org/contacts/b.ttl#this",
    fields: { name: "Mira Q.", note: "A fictional contact" },
    emails: ["mira+club@example.org"],
    webIds: ["https://example.org/people/mira#me"],
    multiFields: { labels: ["Books"] },
  },
];
const options = { defaultCountryCallingCode: "1" };
const clusters = clusterContacts(contacts, options); // one cluster, both IDs
const plans = planMerges(contacts, options); // name conflict; note from b; union of labels
const key = normaliseName("ＭＩＲＡ Quill"); // "mira quill"
```

`DedupeContact` is an explicit projection, not a substitute for the contact data model.
Adapters supply the complete set of fields they want to merge: `fields` holds nonblank scalar
strings, `multiFields` holds string sets (for example labels or address references), and the
three identity arrays hold bare emails, bare phone numbers and exact WebIDs. Structured contact
points, addresses, dates, RDF nodes and other metadata require an adapter; passing these or
unknown top-level properties directly throws rather than silently dropping them. Names belong
in `fields.name`. Missing fields/identity arrays default to empty; explicit null is rejected.
The same field key cannot be scalar in one record and multi-valued in another. Inputs must be
plain records (including null-prototype records), with enumerable string data properties.

- `normaliseEmail` trims surrounding whitespace and lowercases ASCII dot-atom addresses with
  DNS domains. It preserves dots, plus-tags and their content. Quoted local parts, international
  email, domain literals, display-name syntax and `mailto:` IRIs are unsupported. No provider
  alias rules or DNS/mailbox validation are applied.
- `normalisePhone` removes ASCII spaces, dots, hyphens and balanced digit-only parentheses,
  leaving 1–15 digits and an optional leading `+`. A leading `+` must precede a nonzero digit.
  With no default code, national digits remain national and never match an international key.
  The optional default calling code is 1–3 digits without `+`; callers supply a vetted code and
  **national significant numbers**, without trunk or IDD prefixes. Prefixed results must fit
  15 digits. National leading zero with a default code, optional `(0)` notation, extensions,
  URI parameters, vanity letters, Unicode digits and other dialling syntax are rejected.
  This is a syntactic matching key, not a numbering-plan validator or a dialler.
- `normaliseName` applies Unicode NFKC, trims surrounding whitespace, then applies Unicode 17.0.0
  default full case folding. It handles sharp S, final sigma, Cherokee and supplementary-plane
  letters; it does not strip accents or collapse internal spacing. Controls, blank names and
  malformed UTF-16 are rejected. Folding is locale-independent, excluding Turkic T mappings.
  The generated C + F mapping table comes from Unicode's
  [CaseFolding.txt](https://www.unicode.org/Public/17.0.0/ucd/CaseFolding.txt), under the included
  `UNICODE-LICENSE.txt`. Native `String.normalize` supplies NFKC. No package was added.
- Union-find with path compression and union by size joins contacts sharing **any** WebID,
  normalised email or normalised phone, including transitive links and cycles. Names never join
  contacts. WebIDs must be absolute HTTP(S) identifiers without userinfo, forbidden characters
  or malformed percent escapes. They compare exactly, including fragment, path/host case and
  percent spelling; no URL serialisation or dereferencing occurs.
- Both APIs return the complete partition, including singletons. Clusters and their members
  sort by contact ID in UTF-16 order. `MergePlan.targetId` is the lowest ID; each scalar winner
  comes from the lowest ID **that supplies that field**. Equal scalar values share `sourceIds`.
  Every distinct losing value is listed in `conflicts`, preserving raw spelling and provenance,
  even if two names normalise to the same key. Scalar values are never concatenated or trimmed.
- Identity unions emit normalised keys; other multi-valued unions use exact string equality.
  Values, field keys and source IDs have deterministic order; repeated values within a contact
  contribute its ID once. Conflict fields sort by key, with alternatives in source ID order.
  Missing values are omitted, not conflicts. A cluster can contain several different WebIDs;
  the plan preserves all of them. Sharing an identity is only a duplicate hint for UI review.
- No input containers are mutated, and returned arrays/records are fresh. These are proposals;
  the caller reviews conflicts and applies writes/deletions through its typed data layer.
  No automatic merge is performed. Unusable shapes, duplicate IDs or unsupported values throw
  `DedupeError` with a typed `code`; error messages never echo contact data.

The conservative interpretations are recorded in root `QUESTIONS.md` (CON-L2). The app's
Vitest configuration enforces 100% statements, branches, functions and lines per source file
in this directory, including the public barrel. Contact fixtures use fictional people and
`example.org`; generated network tests compare union-find with graph reachability.
