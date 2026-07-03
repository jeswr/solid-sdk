# @jeswr/solid-memory

> A typed **RDF agent-memory model** + **Solid-pod store** + **client-side search**
> — the user-owned, portable, cross-agent AI-memory **aggregator core**. A memory
> written by one agent is readable + searchable by another, because they share one
> model (`mem:MemoryItem`).

This is the memory keystone of the suite's [Solid → OSS integration
strategy](https://github.com/jeswr/prod-solid-server/blob/main/docs/research/solid-oss-integration-targets.md):
the small typed model that every agent-memory adapter (mem0 / OpenClaw / LangChain /
Letta) maps **TO** — exactly as ActivityStreams 2.0 is the keystone for chat. Map a
normalizer's memory schema → this RDF model **once**, and the memory is portable across
every agent and app, not siloed in one tool's database.

Standalone, dependency-light, and **non-server-touching** (a pure LDP client, like
[`@jeswr/solid-task-model`](https://github.com/jeswr/solid-task-model)): no
Components.js, no PSS-core dependency, no crypto — the caller injects an authenticated
`fetch`.

## Three layers

| Layer | Subpath | What it is |
|---|---|---|
| Model | `@jeswr/solid-memory/memory` | Typed read/write accessors over a `mem:MemoryItem` resource |
| Store | `@jeswr/solid-memory/store` | Pod CRUD under one container, conditional writes, scope guard |
| Search | `@jeswr/solid-memory/search` | Pure client-side filters (NO server FTS, NO vector search) |

The barrel (`.`) re-exports all three plus the vocabulary.

## The vocabulary (mint minimally, reuse everything)

Mirroring the task model, this package mints **exactly two** terms and reuses
established, dereferenceable vocabularies for every field:

| Field | Predicate / class | Vocabulary |
|---|---|---|
| **class** (MINTED) | `rdf:type mem:MemoryItem` | `mem:` — `https://w3id.org/jeswr/memory#` |
| **embedding ref** (MINTED) | `mem:embeddingRef` (optional → sidecar) | `mem:` — the M2 vector-search seam |
| body | `schema:text` | schema.org (`http://schema.org/`) |
| created / modified | `dct:created` / `dct:modified` | Dublin Core Terms |
| free-text tags | `schema:keywords` | schema.org |
| **categories** (set of IRIs) | `schema:about` | schema.org |
| **about** (single topic IRI) | `dct:subject` | Dublin Core Terms |
| producing agent | `prov:wasAttributedTo` (WebID / agent-card IRI) | W3C PROV-O |
| generating conversation | `prov:wasGeneratedBy` (→ `as:Note` / `pc:ChatRoom`) | W3C PROV-O |
| **soft-forget tombstone** | `prov:invalidatedAtTime` (set ⇒ forgotten) | W3C PROV-O |

> **`about` vs `categories` — two DISTINCT reused predicates (deliberate).** A memory
> may carry ONE subject/topic IRI **and** a SET of category IRIs. Using `schema:about`
> for both would COLLIDE (a reader couldn't tell the single topic from a category). So:
> `categories[]` → multi-valued **`schema:about`**, and the single `about` topic →
> **`dct:subject`**. Both are established + dereferenceable, neither is minted, and
> because they're different predicates they never collide. Free-text tags are a third,
> orthogonal field (`schema:keywords` string literals — NOT IRIs).
>
> **`mem:` w3id redirect is a `needs:user`.** The `https://w3id.org/jeswr/memory#`
> namespace (and `https://w3id.org/jeswr/pod-chat#` for `pc:`) need a w3id redirect PR —
> a maintainer action, tracked as a `needs:user` item.

## Model API (`./memory`)

```ts
import {
  buildMemory,
  parseMemory,
  parseMemoryTtl,
  serializeMemory,
  memorySubject,
  MemoryItem,
  type MemoryData,
} from "@jeswr/solid-memory/memory";

// Build + serialise (n3.Writer under the hood — never hand-concatenated RDF).
const ttl = await serializeMemory("https://alice.pod/memories/m1", {
  text: "Alice prefers dark mode and lives in Sydney.",
  keywords: ["preference", "ui"],
  categories: ["http://schema.org/Preference"],
  attributedTo: "https://agent.pod/profile/card#me",
  generatedBy: "https://alice.pod/chat/room1#it", // a pod-chat pc:ChatRoom
});

// Parse a fetched body (Turtle or JSON-LD, dispatched via @jeswr/fetch-rdf).
const memory: MemoryData | undefined = await parseMemoryTtl(url, body, contentType);
```

`MemoryData` fields: `text` (required), `created?`, `modified?`, `keywords?` (string[]),
`categories?` (IRI[]), `about?` (topic IRI), `attributedTo?` (agent WebID), `generatedBy?`
(conversation IRI), `embeddingRef?` (sidecar IRI), `invalidatedAt?` (the soft-forget
tombstone — see `forget` in the Store API). The `MemoryItem` accessor additionally exposes
`isForgotten` (true iff a `prov:invalidatedAtTime` is present).

The `MemoryItem` `@rdfjs/wrapper` accessor (for incremental edits) exposes typed
getters/setters for each field plus `types`, `mark()` (stamps `mem:MemoryItem`), and
`isMemory`. Object-property values that are not absolute `http(s)` IRIs (a `javascript:`
/ `mailto:` / bare-string `attributedTo` / `generatedBy` / `about` / category) are
**dropped on write**, never coerced into a malformed `NamedNode` (pod data is untrusted
input). Keywords are free text, so they're kept verbatim.

## Store API (`./store`)

```ts
import { MemoryStore } from "@jeswr/solid-memory/store";

const store = new MemoryStore({
  container: "https://alice.pod/memories/", // absolute container URL
  fetch: authedFetch,                        // an injected AUTHENTICATED fetch
});

const { url, etag } = await store.create({ text: "remember this" }); // PUT If-None-Match: *
const got = await store.get(url);                                     // null if missing / not a memory
await store.update(url, { text: "updated" }, { ifMatch: got!.etag }); // PUT If-Match (sets dct:modified)
await store.forget(url);                                              // SOFT-forget: write prov:invalidatedAtTime (keeps the resource)
await store.unforget(url);                                            // clear the tombstone (inverse of forget)
await store.delete(url, { ifMatch: etag });                           // HARD delete: DELETE If-Match
const members = await store.list();                                  // ldp:contains members
const all = await store.all();                                       // every mem:MemoryItem (incl. forgotten — audit)
const hits = await store.search({ text: "dark" });                   // all() + searchMemories (forgotten excluded by default)
```

- **Injectable authenticated fetch.** The store does **no** crypto / DPoP — the caller
  injects an already-authenticated `fetch`. This keeps it a pure LDP client.
- **Conditional writes.** `create` is a conditional create (`If-None-Match: *` — a 412
  collision surfaces as a thrown error). `update`/`delete` accept `{ ifMatch }` for
  optimistic concurrency (a stale ETag → a thrown 412).
- **`update` preserves `created` (best-effort).** A PUT replaces the whole resource, so
  when you omit `created`, `update` makes a *best-effort* read of the existing resource
  to carry its original `dct:created` forward rather than rewriting it to now. The read
  never blocks the write — a write-only caller or an unreadable resource still updates
  (then `created` defaults to now). Pass `created` explicitly to guarantee preservation
  in a read-restricted context; an explicit value always wins.
- **`forget` — soft-delete with an audit trail (right-to-be-forgotten).** `forget(url)`
  writes a `prov:invalidatedAtTime` TOMBSTONE onto the memory (keeping the resource + the rest
  of its data) instead of hard-deleting it, so a consumer can show *what* was forgotten and
  *when*. A forgotten memory is **excluded from `search` / `searchMemories` by default**
  (pass `includeForgotten: true` to surface it; `all()` always returns it for an audit
  view). `forget` is **idempotent** — re-forgetting keeps the original tombstone time unless
  you pass an explicit `{ at }`. It reads the existing memory first (so it can preserve the
  data), defaults `If-Match` to the just-read ETag for optimistic-concurrency safety, and
  throws on a missing / non-memory / unreadable resource (use `delete` for a hard erase).
- **`invalidatedAt` is OMITTED-IS-STICKY + FAIL-CLOSED in `update`.** A routine `update`
  that omits `invalidatedAt` carries the existing tombstone forward (same as `created`), so
  an ordinary edit can **never** silently resurrect a forgotten memory. The two sticky
  fields differ on read failure, deliberately: `created` preservation is **best-effort**
  (a failed pre-read just defaults it to now), but tombstone preservation is **fail-closed**
  — if `invalidatedAt` is omitted and the pre-read FAILS (read-denied / network error, *not*
  a clean 404/410), `update` **throws** rather than risk dropping a tombstone (a
  right-to-be-forgotten violation). A read-restricted caller that knows the memory is live
  passes `{ assumeNotForgotten: true }` (an explicit, audited escape hatch that writes no
  tombstone), or passes `invalidatedAt` as a `Date`. To deliberately clear a tombstone, call
  **`unforget(url)`** — the explicit inverse of `forget` (reads the memory, drops
  `prov:invalidatedAtTime`, rewrites it; idempotent on a live memory).
- **Scope guard on every op.** Every target URL (and every listed member) is asserted
  to lie under `container` *before* any request — a foreign-origin / escaping URL throws
  and issues **no** network request. Defence in depth against a hostile / buggy server.
- **Type-Index.** `typeIndexRegistration()` returns a `{ forClass: mem:MemoryItem,
  instanceContainer }` descriptor; `buildTypeRegistration()` / `serializeTypeRegistration()`
  emit the three `solid:TypeRegistration` triples (via the typed wrapper — never hand-built)
  so other apps/agents can discover where memories live. **Profile-/type-index *linking*
  is the consumer's concern (M2).**

## Search API (`./search`)

```ts
import { searchMemories, type MemorySearchQuery } from "@jeswr/solid-memory/search";

const hits = searchMemories(items, {
  text: "dark",                  // case-insensitive substring over the memory text
  keywords: ["preference", "ui"], // match-ALL the given tags
  categories: ["http://schema.org/Preference"], // match-ALL the given category IRIs
  attributedTo: "https://agent.pod/profile/card#me", // exact agent WebID
  generatedBy: "https://alice.pod/chat/room1#it",     // exact conversation IRI
  since: new Date("2026-06-01"),  // over created, falling back to modified
  until: new Date("2026-07-01"),
  includeForgotten: true,         // surface soft-forgotten (tombstoned) memories (default false)
});
```

`searchMemories` is **pure** (does not mutate input). Every filter is conjunctive (AND);
an absent filter is not applied; an empty query returns all. `keywords` and `categories`
are **match-ALL** (every given value must be present). `since`/`until` apply over
`created`, falling back to `modified`; a memory with no timestamp can't satisfy a
time-window filter. **Soft-forgotten memories (those carrying `prov:invalidatedAtTime`) are
EXCLUDED by default** — so an agent never recalls a memory the user asked to forget; pass
`includeForgotten: true` for an audit / "forgotten items" view (the other filters still
apply).

> **Vector / embedding search is M2 — NOT implemented here.** The model carries
> `embeddingRef` (a pointer to an opaque, WAC-scoped sidecar embedding resource) so an
> M2 semantic-similarity recall (embed-then-ANN) can be layered on **without a model
> change**. This package ships only the deterministic, client-side filters; there is no
> server full-text index (a CORE-PSS change, deliberately out of scope).

## Interop links — not siloed

- `prov:wasGeneratedBy` → an `as:Note` (ActivityStreams 2.0) or a pod-chat `pc:ChatRoom`
  (`https://w3id.org/jeswr/pod-chat#ChatRoom`, the **exact** IRI
  [`@jeswr/pod-chat`](https://github.com/jeswr/pod-chat) uses — verified, not a bespoke
  namespace). So a memory derived from a chat links back to the real, readable chat, and
  a `generatedBy` search finds every memory from a given conversation.
- `prov:wasAttributedTo` → the producing agent's WebID or
  [`@jeswr/solid-agent-card`](https://github.com/jeswr/solid-agent-card) IRI.

## Security posture

- **Memories are among the most sensitive data a user owns.** A default **owner-only**
  ACL is the **consumer's** job — this library carries data only (it does NOT set ACLs,
  hold credentials, or talk crypto). Consumers should default new memory containers to
  owner-only and expose a "see / delete / forget" view.
- **Untrusted-input IRI filtering — symmetric on read AND write.** Object-property
  values that aren't absolute `http(s)` IRIs are dropped both when building/serialising
  a memory **and** when parsing one read back from the pod, so a hostile resource that
  stores a `javascript:` / `mailto:` / `urn:` IRI as a NamedNode can never surface it to
  a consumer (which might render it as a link).
- **Scope guard.** The store can never touch a foreign origin or escape its container,
  even if a hostile/buggy server injects a foreign URL into a listing. Embedded
  credentials (`https://user:pass@…`) in a container or target URL are refused.
- **Redirect refusal.** Every request forces `redirect: "manual"` and **refuses** any
  redirect response (3xx / `opaqueredirect`), fail-closed: the injected fetch is
  credentialed (Authorization/DPoP), so a redirect planted by a poisoned in-pod
  resource must never be followed — it could forward the credential off-origin
  (token exfiltration). A relocated pod is the caller's concern (reconstruct the
  store on the new container URL).
- **Never hand-built triples.** All RDF goes through the model (typed `@rdfjs/wrapper`
  accessors), `@jeswr/fetch-rdf` (`parseRdf`), `@solid/object` (`ContainerDataset`), and
  `n3.Writer` — the suite house rule.

## Install (GitHub, no build step)

`dist/` is **committed**, so under the suite's `ignore-scripts=true` policy the package
installs and imports with no build step:

```sh
npm install github:jeswr/solid-memory#main
```

> Because `dist/` is committed it can drift from `src/`. The `check:dist` gate
> (`npm run check:dist`) rebuilds into a temp dir and diffs — so **any `src/` change must
> rebuild + commit `dist/` in the same change**. npm publish is a deferred migration, not
> a blocker (consume via the `github:` dep now).

## Develop

```sh
npm run gate   # lint (Biome) + typecheck (tsc) + test (vitest) + build + check:dist + check:lockfile-transport
```

The public API report is a separate command (not in the default gate, since it fetches
api-extractor via `npx`): `npm run api:report` regenerates `etc/solid-memory.api.md`,
`npm run api:check` fails on drift of `dist/index.d.ts` from it.

## M2 follow-ups

- **Vector search** via `mem:embeddingRef` (client-side embed-then-ANN over the
  WAC-scoped sidecars).
- **The memory adapters** — `@jeswr/openclaw-memory-solid` (an OpenClaw memory-slot
  plugin), a mem0 `SolidVectorStore`/`SolidGraphStore`, a LangChain/LangGraph
  `SolidStore(BaseStore)` — each maps its memory schema → this model.
- **A `solid-mcp` memory Tool surface** so an MCP client can read/store memories.
- **Type-Index *linking*** into the profile / preferences file (this lib only emits the
  registration triples).
- **A Pod Manager "Agent Memory" view** to see / forget / delete memories — both the
  hard `delete` (DELETE) and the soft `forget` (`prov:invalidatedAtTime` tombstone) are now in
  the Store API; the view consumes them (plus `search({ includeForgotten })` for the audit
  list of forgotten items).

Authored by Claude Opus 4.8 (Fable unavailable). See commit trailers / `AUTHORED-BY`
markers.
