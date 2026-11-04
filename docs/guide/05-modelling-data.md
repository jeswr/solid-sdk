<!-- AUTHORED-BY Claude Opus 5.5 -->

# 5. Modelling data as RDF

Structured data in a pod is RDF, so other apps can understand it. You do not have to write RDF by
hand, and you should not: the suite has one rule for it.

> **Read and write RDF only through typed accessors and the shared parser and serialiser.**
> Parse with `@jeswr/fetch-rdf` (or `storage.readRdf`), access with `@solid/object` and
> `@rdfjs/wrapper`, serialise with `@jeswr/rdf-serialize` (or `storage.writeRdf`). Never build
> Turtle with string templates or push raw triples together.

Hand-built RDF breaks on the first title that contains a quote mark, and a crafted value can
inject statements into the user's data.

## Use a domain package when one exists

Domain packages turn RDF into plain objects and back. Each has `parse…`, `serialize…` and a typed
class:

| Data | Package |
| --- | --- |
| Bookmarks, read-it-later | `@jeswr/solid-bookmark` |
| Tasks and trackers | `@jeswr/solid-task-model` |
| Health diary entries | `@jeswr/solid-health-diary` |
| Drawings | `@jeswr/solid-drawing` |
| Chat messages | `@jeswr/solid-chat-interop` |

```ts
import { parseBookmark, serializeBookmark } from '@jeswr/solid-bookmark';
import type { StorageClient } from '@jeswr/storage-client';

declare const storage: StorageClient;
declare const url: string;

// Read: the storage client parses the RDF, the domain package reads it.
const { dataset, etag } = await storage.readRdf(url);
const bookmark = parseBookmark(url, dataset);

// Write: the domain package writes the Turtle.
if (bookmark !== undefined && etag !== null) {
  const turtle = await serializeBookmark(url, { ...bookmark, archived: true });
  await storage.write(url, turtle, { contentType: 'text/turtle', ifMatch: etag });
}
```

`parseBookmark` returns `undefined` when the document is not a bookmark. Treat that as "skip it",
not as an error: pods hold data from many apps.

## Write your own model

When no package fits, write a small class over `@rdfjs/wrapper`. Each property maps one RDF
predicate to a TypeScript type:

```ts
import { LiteralAs, LiteralFrom, OptionalAs, OptionalFrom, TermWrapper } from '@rdfjs/wrapper';
import type { StorageClient } from '@jeswr/storage-client';
import { DataFactory, Store } from 'n3';

const SCHEMA = 'https://schema.org/';

export class Recipe extends TermWrapper {
  get name(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}name`, LiteralAs.string);
  }
  set name(value: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}name`, value, LiteralFrom.string);
  }
}

// Writing a new recipe document:
declare const storage: StorageClient;
declare const url: string;
declare const etag: string;

const store = new Store();
const recipe = new Recipe(`${url}#it`, store, DataFactory);
recipe.name = 'Lemon cake';
await storage.writeRdf(url, store, { ifMatch: etag });
```

For profiles, containers and access-control documents, `@solid/object` already has typed classes;
see the [solid-object skill](../../skills/solid-object/SKILL.md).

## Choose vocabularies

- Reuse widely known vocabularies first: schema.org, Dublin Core (`dct:`), FOAF, vCard,
  iCalendar. Other apps already understand them.
- For suite-specific terms, import the namespace from `@jeswr/suite-vocab` (`NS.TASK`,
  `NS.BOOKMARK`, …). Write the canonical IRIs it gives you. When reading, also accept the legacy
  IRIs it lists (`canonicalize`, `termsEqual`), because older data uses them.
- Give each record a stable subject inside its own document, such as `<document-url>#it`. That is
  why chapter 2 creates the document before writing the data: the subject needs the URL.
- Publish a SHACL shape for any new data type, so other apps can check what they read. The domain
  packages ship theirs.

## Lay out the data

- One document per record (a bookmark, a task, a note) is simplest and keeps edits small.
- Put each collection in its own container. Store the container's URL; do not rely on its name.
- Very large collections need splitting, by date or by a hash of the ID; see
  [solid-scale-and-sharding](../../skills/solid-scale-and-sharding/SKILL.md).
- Binary files (images, PDFs) are ordinary resources. Store their description as RDF beside them
  or in the resource's metadata.

## Query locally

`@jeswr/rdf-engine` loads a WebAssembly RDF engine on demand for SPARQL queries and SHACL
validation over data you have already fetched. Load it only when a feature needs it; it is large.
See the [rdf-engine skill](../../packages/rdf-engine/SKILL.md).

Next: [live updates, offline and collaboration](06-live-updates-and-offline.md).
