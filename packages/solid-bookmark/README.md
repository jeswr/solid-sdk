# @jeswr/solid-bookmark

The RDF vocabulary + typed model for **bookmarks / read-it-later** — the data
model for a [Linkding](https://github.com/sissbruecker/linkding)→Solid fork.

It mints only the terms standard vocabularies lack and reuses dereferenceable
schema.org + Dublin Core for the rest, ships the ontology + a SHACL shape that
pin the contract, and gives you typed read/write accessors that **never hand-build
a triple** (parse via [`@jeswr/fetch-rdf`](https://github.com/jeswr/fetch-rdf),
serialise via `n3.Writer`).

## Install

GitHub-installable now (no build step — the built `dist/` is committed and the
package sets `ignore-scripts=true`):

```bash
npm install github:jeswr/solid-bookmark#main
```

## Vocabulary (`book:` = `https://w3id.org/jeswr/bookmark#`)

Minted here — exactly the three terms schema.org / Dublin Core / SKOS do not
provide:

| Term | Kind | Meaning |
|---|---|---|
| `book:Bookmark` | class | A saved bookmark / read-it-later entry. Rooted `rdfs:subClassOf core:InformationResource` (the gUFO-rebased [Solid Core](https://github.com/jeswr/solid-federation-vocab), `https://w3id.org/jeswr/core#`). |
| `book:archived` | `xsd:boolean` | Whether the bookmark is archived (Linkding `is_archived`). Absent reads as `false`. |
| `book:notes` | `xsd:string` | The user's free-text **markdown** notes (Linkding `notes`). |

Reused (nothing minted):

| Predicate | Used for | Linkding field |
|---|---|---|
| `schema:url` | the bookmarked URL (an IRI) | `url` |
| `schema:keywords` | tags (one string literal per tag) | `tag_names` |
| `dct:title` | title | `title` |
| `dct:description` | short summary / blurb | `description` |
| `dct:created` | when added | `date_added` |
| `dct:modified` | when last changed | `date_modified` |

### Two design choices (documented)

- **Rooting — `core:InformationResource`, not `schema:BookmarkAction`.** A
  `book:Bookmark` is the saved *thing* (an information resource), whereas a
  `schema:BookmarkAction` is the *act* of bookmarking. Making the saved thing a
  subclass of the action is a category error, so the package roots in the suite
  core and carries only a thin `skos:closeMatch schema:BookmarkAction`
  annotation (discovery, no entailment). See `bookmark.ttl`.
- **Tags — `schema:keywords` literals, not `skos:Concept`.** Linkding tags are a
  flat, free-text list with no hierarchy or stable concept IRIs — exactly what
  `schema:keywords` is for. A SKOS taxonomy can be layered on additively later
  without changing this wire format.

`schema.org` uses the canonical `http://schema.org/` scheme, matching the
existing suite producers (`@jeswr/solid-task-model`).

## Usage

```ts
import {
  buildBookmark,
  serializeBookmark,
  parseBookmark,
  parseBookmarkTtl,
  bookmarkShapeTtl,
  Bookmark,
} from "@jeswr/solid-bookmark";

// Build + serialise to Turtle (n3.Writer under the hood)
const ttl = await serializeBookmark("https://alice.example/bookmarks/1", {
  url: "https://example.org/article",
  title: "Great article",
  notes: "## why I saved this",
  archived: false,
  tags: ["solid", "rdf"],
});

// Parse a fetched RDF document back (dispatches via @jeswr/fetch-rdf — any
// content-type it supports: Turtle, N-Triples, N-Quads, TriG, JSON-LD)
const data = await parseBookmarkTtl("https://alice.example/bookmarks/1", ttl, "text/turtle");
//   → { url, title, notes, archived, tags, created, ... }

// Or work on an in-memory dataset directly with the typed accessor
import { Store } from "n3";
const store = new Store();
const doc = new Bookmark("https://alice.example/bookmarks/1#it", store).mark();
doc.url = "https://example.org/x";
doc.archived = true;
doc.tags.add("later");
```

### Validate with SHACL

```ts
import { bookmarkShapeTtl } from "@jeswr/solid-bookmark";
import { Parser } from "n3";
import env from "@zazuko/env-node";
import SHACLValidator from "rdf-validate-shacl";
// feed bookmarkShapeTtl() as the shapes graph and your data as the data graph
```

The shape lives at `bookmark.shacl.ttl` (also a subpath export:
`@jeswr/solid-bookmark/bookmark.shacl.ttl`), the ontology at `bookmark.ttl`.

## Public API

`./` (main — **browser-safe, no `node:*`**): `Bookmark`, `BookmarkData`,
`bookmarkSubject`, `buildBookmark`, `serializeBookmark`, `storeToTurtle`,
`parseBookmark`, `parseBookmarkTtl`, `isHttpIri`; and the vocab
constants/builders (`BOOK`, `BOOKMARK_CLASS`, `BOOK_ARCHIVED`, `BOOK_NOTES`,
`SCHEMA_URL`, `SCHEMA_KEYWORDS`, `DCT_*`, `PREFIXES`, …).

`./shape` (**Node-only** — `readFileSync`s the shipped `.ttl`s):
`bookmarkOntologyTtl`, `bookmarkShapeTtl`, `BOOKMARK_ONTOLOGY_PATH`,
`BOOKMARK_SHAPE_PATH`. Kept off the root so a browser bundle importing
`buildBookmark` never pulls in `node:fs`.

Subpath exports: `@jeswr/solid-bookmark/vocab`, `/shape`, `/bookmark.ttl`,
`/bookmark.shacl.ttl`.

## Develop

```bash
npm run gate   # lint + typecheck + test + build + check:dist + check:lockfile-transport
```

`dist/` is committed and a `check:dist` gate fails if it drifts from a fresh
build — rebuild + commit `dist/` alongside any `src/` change.

## License

[MIT](./LICENSE) © Jesse Wright
