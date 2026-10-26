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

## Links

- [Source](https://github.com/jeswr/solid-bookmark)
- [Issues](https://github.com/jeswr/solid-bookmark/issues)
- [SHACL specification](https://www.w3.org/TR/shacl/)

## License

[MIT](./LICENSE) © Jesse Wright
