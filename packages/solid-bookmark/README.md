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

- Literals outside the profile's datatypes are dropped on read: a language-tagged
  `dct:title`, `dct:description` or `schema:keywords` (`rdf:langString` rather than
  `xsd:string`), a typed title such as `"5"^^xsd:integer`, and an `xsd:date` `dct:created`.
  The old package returned them. **A read-modify-write through `parseBookmark` and
  `serializeBookmark` therefore loses those values, and a dropped `created` is re-stamped
  with the current time.** Callers that must round-trip third-party data should edit the
  Store through the `Bookmark` wrapper, which leaves unrelated triples in place.
- `bookmarkSubject` and `buildBookmark` throw `TypeError` for a relative or unsafe
  resource URL rather than minting a relative subject.
- An uppercase-scheme `schema:url` (`HTTPS://…`) rejects the record (the SHACL pattern is
  case-sensitive), and several `dct:title` values (or duplicate legacy notes) drop that field
  rather than returning the first.

Mirror publishing keeps `@jeswr/model-runtime` as a runtime dependency: this package uses
`tsc` and its declarations reference the generated wrapper/runtime types. Publish the
`jeswr/model-runtime` mirror first, then supply
`--dep-sha @jeswr/model-runtime=<mirror-sha>` to `scripts/mirror-publish.mjs solid-bookmark`
alongside pins for the package's other workspace runtime dependencies. No runtime is
declared inlined; the generator is a devDependency and is stripped from mirrors.

## Links

- [Source](https://github.com/jeswr/solid-bookmark)
- [Issues](https://github.com/jeswr/solid-bookmark/issues)
- [SHACL specification](https://www.w3.org/TR/shacl/)

## License

[MIT](./LICENSE) © Jesse Wright
