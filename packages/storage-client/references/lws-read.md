<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->

# LWS read side

Read with [storage-client guidance](../SKILL.md) for shared contracts and Solid read behavior.


- `root` is a scoped HTTP(S) StorageRoot container URL ending `/`, without query/fragment
  (including empty delimiters); malformed container roots throw TypeError, unsafe roots `scope`,
  like Solid. `storage` is StorageDescription.id; default `root`: sparq's `LwsConfig::storage()`
  returns the root and its lws#storage link names that URL (`src/lws/mod.rs:421-425`,
  `src/lws/resources.rs:684-704`). Normalise `storage` once with `new URL(storage).href`; non-absolute
  or non-HTTP(S) ids throw TypeError. Link comparisons use that normalised id, so equivalent URL
  spellings match. `features` defaults to `deriveFeatures` for an undescribed LWS
  storage (empty services/capabilities, probe source), or retains the supplied Features object.
- Design call: `isWithinStorage` calls `scoped(root, …)` synchronously on both backends, returning
  true only when it succeeds. It applies the same standalone-destination and resolution-equivalence
  checks as requests, including rejection of ambiguous same-scheme references.
  Every request must pass `scoped(root, …)` before fetch; storage-id equality never authorises an
  authenticated request outside the root, narrowing ADR-003's non-path-aligned identifier rule.
  On every response (HEAD, read, readRdf, list, metadata), ANY lws#storage link in the response URL's
  context that differs from `storage` gives `scope` and discards the body. Matching/absent links
  are accepted; links with a different anchor context are ignored. Errors never echo the foreign id.
- `list` and `listAll` accept scoped opaque container identifiers, including those without a trailing
  slash, preserving their URLs. Query/fragment (even empty `?`/`#`) gives `bad-request`, except a
  query matching the advertised version-history template for a scoped resource. Fragments remain
  refused. The response must be a valid Container or ContainerPage. GET Accept:
  `application/lws+json, application/ld+json;q=0.5`. Cursors are scoped first, then fetched as canonical
  URLs with opaque queries preserved. Only 200 succeeds; other 2xx/3xx are
  `invalid-response`, HTTP errors use the shared mapping, redirects are never followed.
- Listing media type must be lws+json or ld+json. JSON is capped at **16 MiB of streamed bytes**
  for listings and linksets, independently of Content-Length; overflow/bad JSON → `invalid-response`.
  Top level must be an object, type (string/array) includes Container or ContainerPage (compact or
  full https://www.w3.org/ns/lws# IRI), and items must be an array. sparq's ordinary pages all use
  Container; type-search pages use ContainerPage (`src/lws/index.rs:625-675`). Each item must be an
  object with string id; malformed structure → `invalid-response`. Resolve ids against response
  URL; drop invalid, non-HTTP(S), unsafe or foreign ids; duplicate resolved ids keep the first.
  Each page accepts at most **10,000 raw items** and **4 MiB of cumulative resolved id lengths**,
  measured in UTF-16 code units before retaining entries. Every successfully resolved id occurrence
  counts, including duplicates and ids later dropped by scope checks. Exceeding either budget gives
  `invalid-response`; exact limits are accepted. These budgets apply independently of the streamed
  JSON byte cap and prevent short ids from amplifying a long cursor URL.
- Entry order follows the server. Kind depends only on Container type, never a trailing slash.
  Content type is valid RFC 6838 `format` (shared MEDIA_TYPE with Solid), null for containers;
  size is a non-negative safe integer; modified is a parseable date string; else null. Types retain
  only absolute IRIs, excluding compact/full Container and DataResource; malformed optional fields
  drop only that field. `total` is non-negative safe-integer totalItems or null; etag is verbatim.
  `next` uses the first response-context next Link, resolved against that URL; foreign/unsafe or
  self links → `invalid-response`. Compare next links with the current page after scoping and
  canonicalisation (including the slashless root alias), and return canonical cursor URLs with
  opaque queries preserved. A canonical `next` cursor exceeding **8,192 UTF-16 code units** gives
  `invalid-response`; the exact limit is accepted. This also stops page-by-page cursor growth before
  short Link targets can amplify an oversized response URL. `listAll` uses shared paginate: loop guard,
  10,000 pages maximum, abort between entries. No client sorting or cursor reconstruction.
- HEAD/read/readRdf share status, GET/HEAD headers, range validation, conditional 304, body buffering,
  transport/abort mapping and RDF parsing with Solid (`src/read.ts`, `src/http.ts`). Accept defaults
  to */*, readRdf to `text/turtle, application/ld+json;q=0.9`; 304 gives an empty dataset and
  notModified, non-RDF/unparsable RDF → `not-rdf`. Only requested 206 and conditional 304 succeed.
  Parent is the first `up` link only if scoped, metadataUrl the first scoped `linkset` link, else
  null; do not fall through to a later safe link. Root parent is always null, root kind container;
  other kinds use ONLY the exact https://www.w3.org/ns/lws#Container type link. allow is always null.
- `metadata` does one HEAD, then GET metadataUrl with Accept application/linkset+json; absent/suppressed
  linkset → `unsupported`. Accept application/linkset+json or application/json only. RFC 9264 §4.2:
  object with linkset array of context objects, each with string anchor, all other keys relation
  arrays of target objects with string href; malformed structure/reference → `invalid-response`.
  Resolve anchors/hrefs against the linkset URL. Anchors must be HTTP(S), foreign anchors are kept
  as data and never fetched; hrefs may name other absolute schemes. Duplicate anchors/relations
  merge in order. Normalisation accepts at most **10,000 targets** across all contexts and relations
  and **4 MiB of cumulative resolved anchor + href URL lengths**, measured in UTF-16 code units.
  Every anchor occurrence counts, including duplicates and contexts without targets, and every
  target href counts. Exceeding either budget gives `invalid-response` during expansion, before
  retaining further entries or allocating their params; exact limits are accepted. These limits
  apply independently of the streamed JSON byte cap and prevent short references amplifying a long
  linkset base URL. Params keep only string-valued attributes except href; array attributes including
  hreflang/title* are skipped (preserved in raw). raw is parsed JSON, url is the fetched linkset URL,
  etag is its ETag. Maps and own-property params preserve hostile property names as data.
- `parentOf` scopes first; root → null without a request, otherwise one HEAD returning parent.
  Fixtures in src/fixtures/lws.ts are synthetic, shaped exactly after the cited sparq lines; the
  1,500-member listing overrides sparq's default page_size=100 to 500 for three pages.
