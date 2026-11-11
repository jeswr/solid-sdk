<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-bookmark

A browser-safe RDF vocabulary and typed model for bookmarks and read-it-later data on Solid pods.

Writers and the shipped ontology use `https://jeswr.org/ns/bookmark#`
(source: `@jeswr/suite-vocab` NS.BOOKMARK), with core references under NS.CORE,
`https://jeswr.org/ns/core#`. Readers also accept the read-only legacy bookmark
namespace exported as `LEGACY_BOOK_NS`; `LEGACY_CORE_NS` exposes the legacy core base.
Canonical notes and archived values take precedence when both aliases are present.
Setting either property removes its legacy alias and writes the canonical predicate.
The shipped SHACL shape targets both bookmark classes and checks both property aliases.
Notes and archived each permit at most one distinct value across their aliases: identical
duplicates conform, while conflicting or malformed values fail validation on either class.

## Install

```sh
npm install github:jeswr/solid-bookmark#main
```

The package tooling requires Node.js 20 or newer; the root and `/vocab` runtime entries are
browser-safe.

## Minimal usage

```ts
import {
  parseBookmarkTtl,
  serializeBookmark,
  type BookmarkData,
} from "@jeswr/solid-bookmark";

const resourceUrl = "https://alice.example/bookmarks/1";
const turtle = await serializeBookmark(resourceUrl, {
  url: "https://example.org/article",
  title: "An article worth revisiting",
  tags: ["solid", "rdf"],
});

const bookmark: BookmarkData | undefined = await parseBookmarkTtl(
  resourceUrl,
  turtle,
  "text/turtle",
);
```

## Key API

- Model: `Bookmark`, `BookmarkData`, `buildBookmark`, `parseBookmark`, `parseBookmarkTtl`,
  `serializeBookmark`, `bookmarkSubject`.
- Input URLs: `httpIriOrUndefined(value)` returns a canonical HTTP(S) href or `undefined`;
  `isHttpIri(value)` tests whether a value is already canonical. Use the former for typed
  or imported URLs (including missing trailing slashes, uppercase hosts/schemes and Unicode).
- Vocabulary: `BOOK`, `BOOKMARK_CLASS`, `BOOK_ARCHIVED`, `BOOK_NOTES`, reused schema.org and
  Dublin Core constants, and `PREFIXES`; the focused entry is `@jeswr/solid-bookmark/vocab`.
- Node-only artifacts: `bookmarkOntologyTtl`, `bookmarkShapeTtl`, and path constants from
  `@jeswr/solid-bookmark/shape`.
- Raw artifacts: `@jeswr/solid-bookmark/bookmark.ttl` and
  `@jeswr/solid-bookmark/bookmark.shacl.ttl`.

The root entry is browser-safe. Import the `shape` entry only in Node.js because it reads the
shipped Turtle files with `node:fs`.

## Generated model core

[`bookmark.ttl`](./bookmark.ttl) and [`bookmark.shacl.ttl`](./bookmark.shacl.ttl) are the
hand-written source of truth. [`codegen.config.json`](./codegen.config.json) supplies the
subject convention and compatible defaults/tag handling. `@jeswr/federation-codegen`
generates the committed `src/generated/` manifest, typed runtime shim, normalized SHACL,
and input/output hashes. The public `src/bookmark.ts` facade delegates to
`@jeswr/model-runtime`; `vocab.ts` and the public Turtle artifacts remain hand-written.

From the workspace root (Node 24, installed workspace dependencies):

```sh
pnpm --filter @jeswr/federation-codegen... run build
pnpm --filter @jeswr/solid-bookmark run codegen
# After an intentional ontology, shape, or config change, review the diff and use:
pnpm --filter @jeswr/solid-bookmark run codegen --update-lock
pnpm exec turbo run lint build typecheck test --filter=...@jeswr/solid-bookmark
```

Do not edit `src/generated/` by hand. A test runs the package's codegen command into a
temporary directory and compares every artifact, including `codegen.lock.json`, byte for
byte. The original 78 tests remain the compatibility oracle. Builds copy the generated
shim and declarations into `dist/generated/`; `dist/` is never committed here.

The facade preserves the original Store/property order and generic Store serialization
through `@jeswr/rdf-serialize`, including arbitrary legacy triples. Supplemental tests
pin the original Turtle/JSON bytes and compile a strict consumer of the built declarations,
including clearing setters under `exactOptionalPropertyTypes`. The shared runtime applies stricter guards outside
the oracle: ambiguous required URLs reject the record, malformed optional values drop,
and text writes strip control characters. These shared SHACL/IRI and text guards cannot
be bypassed by the facade, so those formerly permissive edge behaviors are not retained.

Exact divergences from the hand-written package, pinned in `test/compatibility.test.ts`:

- The `Bookmark` wrapper getters follow the SHACL profile exactly, so they return
  `undefined` for literals outside the profile's datatypes: a language-tagged `dct:title`,
  `dct:description` or `schema:keywords`, a typed title such as `"5"^^xsd:integer`, or an
  `xsd:date` `dct:created`. `parseBookmark` and `parseBookmarkTtl` still return those
  values exactly as the old package did (first literal's text, dates parsed, every
  keyword), so a plain-data parse → edit → serialize round-trip does not delete them or
  re-stamp `created`. As before, `serializeBookmark` writes them back as plain strings and
  `xsd:dateTime`; to keep the original language tags and datatypes, edit the Store through
  the `Bookmark` wrapper, which leaves unrelated triples in place. Whether the profile
  should widen is an open normative decision.
- `bookmarkSubject` and `buildBookmark` throw `TypeError` for a relative or unsafe
  resource URL rather than minting a relative subject.
- An uppercase-scheme `schema:url` (`HTTPS://…`) rejects the record (the SHACL pattern is
  case-sensitive). The wrapper drops a field with several values (for example two
  `dct:title`s); the plain-data parsers return the first, as before.
- Data-graph subclasses count as bookmarks: a subject typed with a class that the same
  dataset declares `rdfs:subClassOf book:Bookmark` is recognised (SHACL target semantics,
  bounded at 10,000 reads). Field values are still read only from `${resourceUrl}#it`.

Mirror publishing keeps `@jeswr/model-runtime` as a runtime dependency: this package uses
`tsc` and its declarations reference the generated wrapper/runtime types. Publish the
`jeswr/model-runtime` mirror first, then supply
`--dep-sha @jeswr/model-runtime=<mirror-sha>` to `scripts/mirror-publish.mjs solid-bookmark`
alongside pins for the package's other workspace runtime dependencies. No runtime is
declared inlined; the generator is a devDependency and is stripped from mirrors.

<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
## Browser bookmark interchange and pod storage

`@jeswr/solid-bookmark/netscape` exports pure `parseNetscapeBookmarks(html)` and
`serializeNetscapeBookmarks(bookmarks)`. The parser returns `{ bookmarks, skipped }`;
folders become tags, `TAGS` is merged and deduplicated, and `ADD_DATE` is read as epoch
seconds. Only HTTP(S) targets survive. Markup is never executed or rendered: a tolerant
tokenizer retains an inert subset before the platform DOMParser handles it. Without a DOM,
the tokenizer decodes numeric, core, Latin-1 and common punctuation entities; unknown names
remain literal. Input is bounded to 10 MB, 100,000 tokens and 128 nesting levels.
Byte/token overflow returns `{ bookmarks: [], skipped: 0, error: "file-too-large" }`,
never a partial import or an exception. Excessive folder depth still throws `RangeError`.
The optional `NetscapeImport.error` field distinguishes overflow from an empty export.
URLs are stored as canonical hrefs after entity decoding; unsafe schemes are skipped.
Missing closing tags and malformed optional dates are tolerated. Export escapes all text
and attributes. `DESCRIPTION`, `NOTES` and `ARCHIVED` are optional extension attributes;
the standard `DD` description and `TAGS` remain usable in other bookmark managers.
Tags containing commas cannot round-trip through the Netscape comma-separated `TAGS` field.

`@jeswr/solid-bookmark/pod` exports `createBookmarkRepository({ storage, profile, fetch? })`
for an injected SDK storage client. Obtain it with `createPodClient` from
`@jeswr/storage-client`, which owns backend discovery and selection. The former
`createSolidBookmarkRepository` factory has been removed.
Initialisation creates/reuses `bookmarks/` and attempts to register its canonical bookmark
class in the private Type Index. Registration is best effort: a failure logs only a fixed
message and error code, leaves CRUD usable, and retries once on a later initialise in the
repository's lifetime. Concurrent initialisers share an attempt. Read the live
`repository.registration` status (`pending`, `registered`, `failed`) to show a dismissible hint.
Private registration means unlisted; it does not change access permissions.
Records contain `{ url, etag, data }`. Edits use generated accessors on the original dataset,
preserve unrelated RDF and require the observed ETag. Missing or follow-up-only write validators
require refreshing before another edit or delete. Collections over 5,000 entries fail explicitly.
`list()` returns a `BookmarkListing`: `{ items: StoredBookmark[], skipped: { url, reason }[] }`.
All child read failures are isolated; `reason` is a storage error code or `unknown`.
Untyped resources are ignored. Container listing and initialisation errors still propagate.
The current storage-client `readRdf` API has no per-resource byte limit; listings use a
4 MB per-page limit. Failed creates attempt to delete an orphan only after a fresh read
confirms it is empty, using that read's ETag or the creation response's own validator;
cleanup cannot delete a committed bookmark or
overwrite the original error. If no safe validator is available, the empty resource remains.
Import `BookmarkPatch`, `BookmarkRepository`, `BookmarkListing`,
`BookmarkRegistrationStatus` and `StoredBookmark` types from this subpath.

The existing aliases cover `https://w3id.org/jeswr/bookmark#`, not Pod Manager's
`http://www.w3.org/2002/01/bookmark#` type, `recalls` or `hasTopic` predicates. Those
W3C resources are skipped rather than rewritten. No ontology, profile, facade or generated
model change was needed for the Bookmarks app.

## Links

- [Source](https://github.com/jeswr/solid-bookmark)
- [Issues](https://github.com/jeswr/solid-bookmark/issues)
- [SHACL specification](https://www.w3.org/TR/shacl/)

## License

[MIT](./LICENSE) © Jesse Wright
