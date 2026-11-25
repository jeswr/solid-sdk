# Pod Photos

> ⚠️ Experimental — AI-agent-generated (Claude Opus 4.8, @jeswr PSS agent); under active development, not production-hardened.

A [Solid](https://solidproject.org) photo & album app. Your photos and their
metadata live in **your** pod, modelled on standard, widely-recognised
vocabularies so any other Solid app can read them — and re-discoverable through
the Solid Type Index.

This package is the **data layer** — the typed RDF model + pod read/write/list +
Type-Index registration that the rest of the app is built on. The Next.js UI is
a deliberate, separately-tracked follow-up (see [Roadmap](#roadmap)); the value
that survives is this layer.

## Data model

| Domain | RDF |
|---|---|
| A photo | [`schema:Photograph`](https://schema.org/Photograph) — `schema:name`, `schema:description`, `schema:contentUrl` (the image binary), `schema:keywords`, `schema:width`/`schema:height`, `schema:dateCreated` |
| Technical capture metadata | **EXIF → RDF** via the W3C [`exif:`](http://www.w3.org/2003/12/exif/ns#) vocabulary — `exif:make`, `exif:model`, `exif:lensModel`, `exif:focalLength`, `exif:fNumber`, `exif:exposureTime`, `exif:isoSpeedRatings`, `exif:orientation`. EXIF is extracted **out of the binary into queryable triples**. |
| Capture location | A nested `schema:geo` → [`geo:Point`](http://www.w3.org/2003/01/geo/wgs84_pos#) (W3C Basic Geo) with `geo:lat`/`geo:long` as signed decimal degrees (EXIF sexagesimal GPS + N/S/E/W ref is converted). |
| An album / gallery | [`schema:ImageGallery`](https://schema.org/ImageGallery) — members linked with `schema:hasPart` to each photo's subject IRI. |

Storage is **pod-shaped**: one RDF resource per photo under `photos/`, one per
album under `albums/`, with each container registered in the user's Type Index
(`schema:Photograph` → `photos/`, `schema:ImageGallery` → `albums/`) so the data
surfaces in any Type-Index-aware Solid app.

**Images from other apps.** Documents typed [`schema:ImageObject`](https://schema.org/ImageObject)
(e.g. `@jeswr/solid-creative-assets`, `@jeswr/pod-media-store`) are shown as photos too. The web app
reads the Type Index once per index and shows every container registered for `schema:Photograph` or
`schema:ImageObject` inside your storage (de-duplicated, one gallery each). For an ImageObject
container the listing follows `ldp:contains` into the `<yyyy>/<mm>/` shard containers (two levels, at
most 120 containers and 1000 documents) and shows their photos in one grid. Only the `<doc#it>` node is
a photo, so `#thumbnail`, `#run`, `#prompt`, `#model` and `#setting-n` are ignored, and a thumbnail kept
in its own document that another document names with `schema:thumbnail` is dropped from the same
listing. A document that does not parse as an image (a literal `contentUrl`, a video) is skipped.
The legacy `http://schema.org/` scheme is not read.

**Read-only for other apps' documents.** Pod Photos still writes and registers only `schema:Photograph`.
`PodStore.update` and `remove` first read the existing document and throw `ForeignDocumentError`, before
any write, unless its `#it` is typed `schema:Photograph` (a missing document is not guarded). The gallery
has no edit or delete control.

**Known limitation: private images.** The grid loads each image with a plain `<img src>`, which carries
no DPoP token. A binary in a private container (the usual place `@jeswr/pod-media-store` writes) is
refused by the pod, so its tile shows a placeholder instead of the picture, while its title and caption
load. Loading binaries through the authenticated fetch needs the suite's media loader primitive, which
is being built separately.


## How the RDF is handled (house rules)

- **Read** with [`@jeswr/fetch-rdf`](https://www.npmjs.com/package/@jeswr/fetch-rdf)
  (one GET + content-type-dispatched parse, ETag kept for conditional writes).
- **Extract / navigate** with [`@solid/object`](https://www.npmjs.com/package/@solid/object)
  (`ContainerDataset` for listings) and typed [`@rdfjs/wrapper`](https://www.npmjs.com/package/@rdfjs/wrapper)
  accessors.
- **Serialise** with `n3.Writer`.
- **Never** a bespoke RDF parser, **never** hand-built / hand-concatenated quads
  or inline Turtle — every triple goes through a typed accessor.

## Usage

```ts
import { photosStore, albumsStore } from '@jeswr/pod-photos';

// In production, omit fetchImpl — @solid/reactive-authentication patches the
// global fetch, so authentication (DPoP) is automatic. Tests inject a fetch.
const photos = photosStore({ podRoot: 'https://alice.example/', webId });

// Create a photo (registers schema:Photograph → photos/ in the Type Index).
const { url } = await photos.create({
  name: 'Sunset over the bay',
  contentUrl: 'https://alice.example/photos/sunset.jpg',
  keywords: ['sunset', 'bay'],
  exif: {
    make: 'FUJIFILM', model: 'X-T5', fNumber: 1.4, iso: 200,
    pixelWidth: 6240, pixelHeight: 4160,
    dateTimeOriginal: '2026-06-15T18:41:07.000Z',
    location: { lat: 51.5, long: -0.12 },
  },
}, 'Sunset');

const all = await photos.list();              // every Photograph in photos/
const one = await photos.read(url);           // a single photo + its ETag

// Albums (schema:ImageGallery, members via schema:hasPart).
const albums = albumsStore({ podRoot: 'https://alice.example/', webId });
await albums.create({ name: 'Iceland 2026', members: [`${url}#it`] }, 'Iceland');
```

EXIF values are validated/normalised on the way in (a negative ISO, an
out-of-range GPS point, a malformed EXIF date are dropped, not written) and
re-normalised on the way out, so a tampered pod document never yields junk.

## Federation

`public/clientid.jsonld` is the app's Solid OIDC Client Identifier Document. It
also publishes the federation-registry block from
[`https://w3id.org/jeswr/fed`](https://github.com/jeswr/solid-federation-vocab)
(`fedapp:`): this app's sector (`media`), the WAC access modes it requests
(`acl:Read`/`Write`/`Append`), and the shapes it `fedapp:produces` /
`fedapp:consumes` (`schema:Photograph`, `schema:ImageGallery`) — so the app is
ready to register with the ecosystem data-federation registry once the `fedapp:`
namespace is frozen (ADR-0013).

## Development

```bash
npm install            # ignore-scripts=true (supply-chain hardening)
npm run gate           # lint + typecheck + test (100% coverage) + build
```

- **Lint/format:** Biome. **Types:** strict TypeScript (ESM / Node ≥ 22).
- **Tests:** Vitest, with a **100% coverage threshold** on the data layer
  (round-trip RDF, EXIF edge cases, the Type-Index bootstrap, WAC-aware reads,
  and the confused-deputy scope guard). The pod is exercised against an
  in-memory mock that honours `If-Match`/`If-None-Match`/ETag semantics.

## Roadmap

These are the tracked follow-ups (this run delivered the non-throwaway core):

- **UI:** a Next.js app scaffolded with `create-solid-app` once it lands — not
  hand-rolled here.
- **Cross-server E2E matrix:** Playwright against the well-known Solid servers,
  including **prod-solid-server** with both **passkey** and **username/password**
  login (plus CSS WAC/ACP), driven from the `suite.json` `e2eMatrix` block.
- **Coverage-ratchet gate:** wire the 100% data-layer coverage into the CI gate
  so it can never regress, ratcheting it across all well-known servers.
- **Sector-vocab ADR:** the `media` sector IRI
  (`https://w3id.org/jeswr/sectors/media#sector`) is interim — pin it once the
  `fedapp:` sector vocabulary is frozen (ADR-0013 / the federation registry O1).

## License

MIT © Jesse Wright. See [`LICENSE`](./LICENSE).
