<!-- AUTHORED-BY Claude Sonnet 5.5 -->

# @jeswr/pod-media-loader

Show authenticated pod media safely in a browser or webview. Experimental, AI-agent-generated,
`securityCritical`.

Private pod media cannot be loaded by URL: `<img src>` carries no credentials. The bytes are read
with the caller's authenticated transport and shown through a `blob:` object URL. A `blob:` URL is
**same-origin with the app**, so a wrongly typed blob (SVG, HTML) that reaches a frame, `<object>`
or a new tab runs with the user's pod session. This package is the one place that decides what such
a blob may be.

> **One loader per signed-in session.** The cache is keyed by URL, not by user. Give the loader a
> `getSessionKey` (the WebID) so a changed session purges it before anything is served, and call
> `purge()` on sign-out.

> **GLB / glTF warning.** glTF JSON can reference **external URIs** (`buffers[].uri`,
> `images[].uri`), and glTF loaders will fetch them with no credentials and no scope: an
> attacker-shared model can beacon to any host or pull remote content. This package validates the
> GLB header (magic, version 2, declared length equals the real length, first chunk is JSON) but does
> **not** parse the JSON. The consumer must configure its glTF loader to refuse every non-embedded URI
> (for three.js, a `LoadingManager.setURLModifier` that throws for anything but `blob:` and `data:`),
> or resolve them through this loader's `scope`.

- Every read goes through the public `StorageClient` from `createPodClient` (scoped,
  redirect-refusing). There is no raw `fetch`.
- A URL outside the caller's scope, or outside the storage, is refused **before any request**.
- The body is read as a bounded stream. `Content-Length` is never trusted; the read is aborted and
  refused the moment the counted bytes pass `maxBytes`.
- The bytes are sniffed against an allowlist and the `Blob` is built with the **sniffed type
  only**. The server's `Content-Type`, and any type the caller or the description declares, are
  never read. SVG, HTML, XML and any text or markup are never produced.
- Object URLs are reference counted, shared between concurrent callers, evicted only at zero
  references, and revoked on `purge()` (sign-out, account switch).
- Memory is hard-bounded (see "Memory").

## Use

```ts
import { createPodClient } from "@jeswr/storage-client";
import { createMediaLoader } from "@jeswr/pod-media-loader";

const { storage } = await createPodClient({ fetch: auth.fetch, storage: storageRoot });
const loader = createMediaLoader({
  storage,
  scope: [`${storageRoot}media/`], // container URLs, or (url) => boolean
  getSessionKey: () => auth.webId, // purge everything when the account changes
  maxBytes: 25 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024, // hard: cached + held + in flight
  maxEntries: 200,
  // maxPixels defaults to 64_000_000; raise it explicitly if you need more.
});

const result = await loader.acquire(imageUrl, { signal });
if (result.ok) {
  img.src = result.value.url; // blob:...
  // later, when the element goes away:
  result.value.release();
} else {
  result.error.code; // out-of-scope | not-found | forbidden | too-large | over-budget
}                   // | unsupported-type | offline | aborted | purged | failed

// Sign-out: revoke everything, abort reads, refuse until resume().
loader.purge();
```

React (optional peer, tested with React 18; the core imports nothing from it):

```tsx
import { useMedia } from "@jeswr/pod-media-loader/react";

function Thumb({ loader, url }: { loader: MediaLoader; url: string }) {
  const { status, url: src, error } = useMedia(loader, url);
  return status === "ready" ? <img src={src} alt="" /> : <span>{status}</span>;
}
```

`useMedia` acquires on mount, releases on unmount or when the loader, URL or `inert` option changes,
and is correct under StrictMode's mount, cleanup, mount. It reports `idle` for a missing URL and
drops its stored result in the same cleanup that releases its hold, so a released URL is never shown
again. It subscribes to the loader: `purge()` (or a session change) moves a mounted hook to
`status: "error"` with `error.code === "purged"` synchronously, and a revoked URL is never rendered.
In development StrictMode requests each image twice (the first read is aborted); with a very tight
`maxEntries` that can show up as a transient `over-budget`.

## API

| Export | Meaning |
| --- | --- |
| `createMediaLoader(options)` | `{ storage, scope, maxBytes, maxTotalBytes, maxEntries, maxPixels?, maxConcurrent?, readTimeoutMs?, getSessionKey?, sniff?, allow?, objectUrls? }`. Invalid limits throw `RangeError`; invalid `allow` entries or container URLs throw a fixed-message `TypeError`, at creation only. |
| `loader.acquire(url, { signal?, inert? })` | `Promise<Result<{ url, contentType, bytes, release() }>>`. Never throws. |
| `loader.revalidate(url, { signal? })` | Conditional re-read (`If-None-Match` with the remembered ETag, cache bypassed). `{ changed }`. |
| `loader.invalidate(url)` | Notification hook: drop the entry, stop sharing any read in flight, and make the next read bypass the HTTP cache. |
| `loader.purge()` / `loader.resume()` | Revoke everything and abort reads; refuse (`purged`) until resumed. |
| `loader.subscribe(listener)` | Called synchronously when everything has been revoked. Returns an unsubscribe. |
| `loader.stats()` | `{ entries, bytes, inFlight, purged }`. |
| `DEFAULT_ALLOWED_TYPES`, `DEFAULT_MAX_PIXELS`, `INERT_TYPE`, `defaultSniff`, `imageDimensions` | Policy constants and pure helpers. |
| `useMedia(loader, url, { inert? })` (`/react`) | `{ status: idle \| loading \| ready \| error, url, error }`. |

Errors are a closed set (`out-of-scope`, `not-found`, `forbidden`, `too-large`, `over-budget`,
`unsupported-type`, `offline`, `aborted`, `purged`, `failed`) with a fixed message per code. No message
contains a URL, header or server text, so nothing with a query string or credentials can leak.

**URL rules.** A media URL must be absolute http(s) and is canonicalised (dot segments collapsed,
host lower-cased, default port dropped) before scope, cache key and request. These are `out-of-scope`
with no request: any query or fragment (so version or memento URLs addressed by query are not
supported), credentials, whitespace (including raw U+00A0 and U+3000), control characters, a
backslash, a length over 2048, and any percent-encoded control character, `.`, `/`, `\`, `?` or `#`
(`%2e`, `%2f`, `%5c`, `%3f`, `%23`, `%00`..`%1f`, `%7f`; a file name containing `%2e` is therefore
refused). Double-encoded forms such as `%252f` pass: they are literal text, not delimiters, to a
server that decodes once.

## Type rules

The default allowlist is PNG, JPEG, GIF, WebP, AVIF, MP4, WebM, MP3, WAV, Ogg (Vorbis or Opus),
FLAC and GLB. `allow` replaces it, but only with passive `image/`, `audio/`, `video/` or `model/`
types and never anything naming svg, xml, html or script: such a list throws at creation.

- **Safety rests on the output type, not on inspecting the bytes.** The sniffer decides the type
  purely from magic bytes. Content that carries markup after a valid magic (a PNG with `<html>` in a
  text chunk, a GIF with an archive appended) is typed by its magic and served as that passive type,
  where it cannot execute. There is no text-polyglot scan. Content with no recognised magic (SVG,
  HTML, XML, text, UTF-16 markup) is `unsupported-type`.
- MP3 needs a valid ID3v2 header followed by a plausible MPEG frame, or two consecutive frame
  headers, so plain text does not sniff as audio.
- Anything the sniffer does not recognise, or recognises but `allow` omits (HEIC, M4A and QuickTime
  are sniffed but not on the default list), is `unsupported-type`.
- A custom `sniff` receives the first 64 KiB and the full size `(bytes, size)`.
- `inert: true` is for download-only use. It **never fails for type or pixel reasons**: anything not
  on the allowlist, over `maxPixels`, or with unreadable dimensions comes back as an
  `application/octet-stream` blob. Byte, budget and scope limits still apply. An inert entry is never
  handed to a non-inert caller, cached or shared in flight.
- **Pixel guard.** `maxPixels` defaults to 64,000,000 and applies to every `image/*` type: PNG
  (IHDR), JPEG (SOF), WebP (VP8, VP8L, VP8X), GIF (the largest of the logical screen and every
  image descriptor's extent, all blocks walked, bounded) and AVIF/HEIC (a box walk of
  `meta/iprp/ipco/ispe`, plus `moov/trak/tkhd` for `avis` image sequences; the largest extent wins).
  Unreadable, truncated or zero dimensions are `unsupported-type`: the guard fails closed. Because
  of that, **an `allow`ed `image/*` type with no dimension reader (BMP, ICO, anything added with a
  custom sniffer) is always refused while `maxPixels` is set**; pass a very large `maxPixels` to
  accept such types knowingly, or use them via `inert`.
- `allow` can admit playlist-like audio types (`audio/x-mpegurl`) for a custom sniffer: do not.

**Sniffer convergence (follow-up).** `src/sniff.ts` started as a port of the sniffer in
`packages/pod-media-store/src/sniff.ts` (branch `feat/pod-media-store`, not on main). It has already
diverged on purpose (no text-polyglot guard, ID3 frame check, GLB validation, `size` argument), and
the store copy has PLY/SPZ and a `hints` parameter. The two must converge into one shared module
once both packages are on main. Extracting it now was declined because the store is an unmerged
branch; a tracker bead for the shared module is a follow-up for the maintainer.

## Memory

- `maxTotalBytes` and `maxEntries` are **hard**: they bound cached + held + in-flight. Every read
  reserves `maxBytes` and one entry before it starts, evicting unreferenced entries (LRU) to make
  room. A read that cannot fit is refused with `over-budget`; a held entry is never revoked to make
  space. Size `maxTotalBytes` as a multiple of `maxBytes` (at least `maxConcurrent` times).
- At most `maxConcurrent` (default 6) reads run at once; the rest wait in a FIFO queue. An aborted
  or purged waiter leaves the queue without ever starting.
- A read that takes longer than `readTimeoutMs` (default 120 000) is abandoned as `offline`.
- **True peak (reasoned, not measured).** The body is kept as the received chunks and never joined;
  only the first 64 KiB is copied for sniffing, and dimension readers read through a chunk view. The
  one full-size copy is the `Blob` the browser builds from the chunks. So a finishing read briefly
  holds about 2 x its size (chunks plus Blob), after which the chunks are freed. Retained memory is
  at most `maxTotalBytes`; the transient extra is at most `maxConcurrent x maxBytes`. The worst case is
  therefore about `maxTotalBytes + maxConcurrent x maxBytes`. The browser may keep a Blob's bytes
  off the JS heap; that is not observable from here.

## Lifetime

- Concurrent `acquire`s of one URL share one read and one object URL. A waiter that aborts does not
  cancel a read the others still want; when the last waiter aborts, the read is cancelled, and a
  read abandoned as its last bytes arrive creates nothing.
- The object URL is revoked only when its last holder has released **and** it is evicted or the loader
  is purged. Double `release()` is harmless; a release after `purge()` is harmless.
- Entries remember their ETag. `revalidate` re-reads conditionally (an entry without an ETag is
  dropped without a request); a changed resource yields a new object URL for new acquirers while
  existing holders keep theirs until release. A resource that has become `not-found`, `forbidden`,
  `too-large` or `unsupported-type` is dropped. Transient failures keep the entry. After `invalidate`
  the next read, and every `revalidate`, sends `Cache-Control: no-cache` (the storage client's `read`
  has no cache option; a request header makes `fetch` bypass its HTTP cache).
- `purge()` revokes every URL, held or not, aborts reads (queued ones included), refuses until
  `resume()`, and notifies subscribers. A read that completes after a purge never creates an object URL.

## Verified vs assumed

Tests (vitest, 100% statements, branches, functions and lines enforced) run against the storage
client's memory pod and a real Solid backend over a scripted `fetch` (lying `Content-Length`, 4xx/5xx,
network failure, redirect). **Not exercised in a real browser:** real `URL.createObjectURL`, decoders,
and fetch HTTP-cache behaviour for the `Cache-Control` request header are assumed from the spec. The
sniffer and dimension readers decide from bytes, not from a decode, so a file that sniffs as PNG but
fails to decode is shown as a broken image, not refused. Pixel limits assume decoders size the canvas
from the headers read here (including the GIF largest-frame rule); not reproduced in a browser. The
React hook is tested on React 18 only, so the peer range stays `>=18` without a React 19 claim.

## Not migrated yet: the three private copies

This change adds the package only. A later migration of each copy would involve:

1. `apps/pod-manager/src/components/use-pod-media.ts` plus `inertBlob` in
   `apps/pod-manager/src/lib/viewers.ts`: replace the `podFetch` and `inertBlob` pair with one loader
   per signed-in session (scope: the user's storages, via `isInOwnPods`; `getSessionKey` the WebID),
   `useMedia` for the hook, and `loader.purge()` on logout. Today it types a blob by its **declared**
   type and allows `image/bmp`, `x-icon`, any `audio/*`, `video/*` and `application/pdf`; BMP and ICO
   would become `unsupported-type` or `inert`, and PDF needs its own decision.
2. `apps/suite/src/apps/drive/lib/preview/image-resolver.ts`: `createPreviewImageResolver` becomes a
   thin adapter, `(url, signal) => acquire(url, { signal })` returning `value.url` and releasing on
   the signal's abort. It currently revokes on abort and takes the blob's type from the response.
3. `packages/suite-ui/src/components/preview-pane.tsx` (`useBlobUrl`): it builds object URLs from a
   caller-supplied `Blob` and forces `application/pdf` by slicing. It would take a loader (or
   handles) instead of a blob for image, audio and video, keep text and Markdown on `blob.text()`,
   and keep PDF out of the loader or add it to `allow` deliberately.

None of these apps may depend on `@jeswr/storage-client/solid` or `/lws`; the loader takes the
`StorageClient` they already hold.
