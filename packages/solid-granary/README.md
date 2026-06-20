<!-- AUTHORED-BY Claude Opus 4.8 -->
# @jeswr/solid-granary

Import social posts and feeds into a [Solid](https://solidproject.org) pod, by
mapping [**granary**](https://github.com/snarfed/granary)'s ActivityStreams 2.0
output to the suite's canonical chat-message model and writing each post as an
**owner-private** pod resource.

[granary](https://github.com/snarfed/granary) (snarfed/granary, CC0) converts
posts/feeds from **Facebook, Instagram, Twitter, Mastodon, Bluesky, Nostr,
Farcaster, GitHub, Flickr** + **RSS / Atom / JSON-Feed / mf2** into
ActivityStreams 2.0 when asked for `format=as2`. Because granary already emits
AS2 — exactly the vocabulary [`@jeswr/solid-chat-interop`](https://github.com/jeswr/solid-chat-interop)
reconciles — this package is a **thin adapter**: it does **not** re-implement AS2
parsing, it does **not** hand-build RDF, and it ships **no** bespoke RDF parser.
The map is near-free.

```
granary format=as2  ─▶  CanonicalMessage  ─▶  serializeAs2 / serializeLongChat  ─▶  PUT  ─▶  pod
(silo/feed → AS2)        (@jeswr/solid-chat-interop)   (typed accessors, n3.Writer)      (owner-private)
```

## Install

GitHub-installable now (committed, drift-guarded `dist/`; `ignore-scripts=true`-safe):

```sh
npm install github:jeswr/solid-granary#main
```

npm publish is a deferred suite migration, not a blocker.

## Quick start

```ts
import { ingestGranary } from "@jeswr/solid-granary";

// `as2` is whatever granary returned for ?format=as2 — a single AS2 object
// OR an AS2 Collection of items (a feed / a timeline). Already parsed JSON.
const report = await ingestGranary(as2, {
  writeFetch: session.fetch,                          // your DPoP/WebID-authed fetch
  container: "https://alice.pod.example/imports/granary/", // MUST be owner-private
});

console.log(`${report.written}/${report.total} imported`);
```

Each item becomes one Turtle resource under the container, typed `as:Note`, with
its body, author, timestamp, reply edge, and **PROV-O provenance** (`prov:wasDerivedFrom`
= the source permalink, `prov:wasAttributedTo` = the source author) so an imported
post lands as the same shape native chat uses, with honest attribution — never
masquerading as pod-native content.

### Fetch directly from a granary endpoint (optional, SSRF-guarded)

```ts
import { fetchGranary, ingestGranary } from "@jeswr/solid-granary";

// Dereferenced ONLY through @jeswr/guarded-fetch: https-only, blocks private /
// loopback / link-local / cloud-metadata, DNS-pins, caps body + time, no auto-redirect.
const as2 = await fetchGranary(
  "https://granary.io/url?input=html&output=as2&url=https://example.com/",
);
await ingestGranary(as2, { writeFetch: session.fetch, container });
```

## API

| Export | What it does |
|---|---|
| `ingestGranary(payload, options)` | Map a granary AS2 payload (object or Collection) → canonical messages → write each under `options.container`. Returns a per-item report. |
| `granaryToCanonical(payload, maxItems?)` | The pure transform half — map to `CanonicalMessage[]` without writing. |
| `granaryObjectToCanonical(obj)` | Map one granary AS2 object to a `CanonicalMessage`. |
| `fetchGranary(url, options?)` | Optional: GET a granary endpoint through the SSRF guard and return the parsed AS2 payload. |
| `iterateObjects(payload, maxItems?)` | Flatten a single object / Collection / Activity envelope into message objects. |
| `isCollection` / `isActivity` / `typeSet` | granary-shape predicates. |
| `defaultSlug(msg, index)` | The stable resource-name function (override via `options.slug`). |
| `safeIri` / `isHttpIri` | The http(s)-only IRI filter (re-exported from solid-chat-interop). |
| `GranaryFetchError` | Thrown by `fetchGranary` on a non-2xx / unparseable / over-cap response. |

### `ingestGranary` options

| Option | Default | Meaning |
|---|---|---|
| `writeFetch` | `globalThis.fetch` | The authed fetch used to PUT each resource. **Pass your DPoP/WebID fetch.** |
| `container` | *(required)* | The owner-private container each message is written under. |
| `format` | `"as2"` | On-pod RDF shape — `"as2"` (canonical) or `"longchat"` (SolidOS `meeting:LongChat`). |
| `slug` | `defaultSlug` | Resource-name function; the default is **stable per source post** (idempotent re-sync). |
| `maxItems` | unbounded | Cap items imported from a Collection (bound a hostile/huge feed). |
| `continueOnError` | `false` | `false` = fail-closed (stop on first error); `true` = record + continue. |
| `conditional` | `"overwrite"` | PUT condition — `"overwrite"` (re-sync reflects source edits), `"if-none-match"` (create-only), `"none"`. |

## Security & privacy

This package writes **third-party data into the user's pod**, so its security
posture is load-bearing:

- **Owner-only by default — never auto-shares.** `ingestGranary` **never writes an
  ACL/ACR** and never broadens access. The effective access of each written resource
  is whatever the **target container** grants, so you **must** pass a container that
  is already **owner-private** (a freshly-provisioned private container inherits
  owner-only access). This package will not, and cannot, make imported data public.
- **Untrusted-input hardened.** Imported data is untrusted: every IRI-valued field
  (author, room, reply, source permalink) is filtered **http(s)-only** (`safeIri`);
  a `javascript:` / `mailto:` / `urn:` / bare-string value is **dropped**, never
  coerced. Every date is parse-validated; a garbage timestamp is dropped. A
  wrong-typed or malformed object **drops the bad field and still imports** — it
  never aborts the whole feed. (The RDF read/write hardening is inherited from
  `@jeswr/solid-chat-interop`.)
- **SSRF-safe remote fetch.** A user-configured granary URL is attacker-influenceable;
  `fetchGranary` dereferences it **only** through
  [`@jeswr/guarded-fetch`](https://github.com/jeswr/guarded-fetch) — https-only, no
  userinfo, blocks private / loopback / link-local / cloud-metadata addresses,
  DNS-pins (closing the lookup→connect rebinding window via the `./node` entry),
  caps response size + time, and re-validates every redirect hop.
- **No hand-built RDF.** All RDF is read/written through `@jeswr/solid-chat-interop`'s
  typed `@rdfjs/wrapper` accessors + `n3.Writer`. This package builds no triples and
  ships no bespoke RDF parser (the suite house rule).

## Re-sync, edits, and deletes

The default slug is **stable per source post** (derived from the source permalink),
so re-importing the same feed **overwrites the same resource** rather than
duplicating — and with `conditional: "overwrite"` (the default) a source **edit** is
reflected on re-sync. The canonical model also carries `dct:isReplacedBy` (edit
pointer) and `schema:dateDeleted` (soft-delete tombstone) from
`@jeswr/solid-chat-interop`, so a future sync layer can honour source deletes
(right-to-be-forgotten) on the same shape.

## How it fits the suite

This is OSS-integration capture-multiplier #4 — granary maps one CC0 library to 10+
social silos + the whole feed web, and it already speaks AS2, so a single
near-free map reaches all of them. It composes the suite keystones:
[`@jeswr/solid-chat-interop`](https://github.com/jeswr/solid-chat-interop) (the
canonical chat model + serialisers),
[`@jeswr/fetch-rdf`](https://github.com/jeswr/fetch-rdf) (parse), and
[`@jeswr/guarded-fetch`](https://github.com/jeswr/guarded-fetch) (SSRF). An actionable
imported post carries the same `wf:Task` overlay solid-issues / the Pod Manager read.

## License

MIT
