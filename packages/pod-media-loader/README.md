<!-- AUTHORED-BY Claude Sonnet 5.5 -->

# @jeswr/pod-media-loader

Show authenticated pod media safely in a browser or webview. Experimental, AI-agent-generated,
`securityCritical`.

Private pod media cannot be loaded by URL: `<img src>` carries no credentials. The bytes are read
with the caller's authenticated transport and shown through a `blob:` object URL. A `blob:` URL is
**same-origin with the app**, so a wrongly typed blob (SVG, HTML) that reaches a frame, `<object>`
or a new tab runs with the user's pod session. This package is the one place that decides what such
a blob may be.

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

## Use

```ts
import { createPodClient } from "@jeswr/storage-client";
import { createMediaLoader } from "@jeswr/pod-media-loader";

const { storage } = await createPodClient({ fetch: auth.fetch, storage: storageRoot });
const loader = createMediaLoader({
  storage,
  scope: [`${storageRoot}media/`], // container URLs, or (url) => boolean
  maxBytes: 25 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxEntries: 200,
  maxPixels: 64_000_000, // optional decompression-bomb guard for images
});

const result = await loader.acquire(imageUrl, { signal });
if (result.ok) {
  img.src = result.value.url; // blob:...
  // later, when the element goes away:
  result.value.release();
} else {
  result.error.code; // out-of-scope | not-found | forbidden | too-large | unsupported-type
}                   // | offline | aborted | purged | failed

// Sign-out or account switch: revoke everything, abort reads, refuse until resume().
loader.purge();
```

React (optional peer; the core imports nothing from it):

```tsx
import { useMedia } from "@jeswr/pod-media-loader/react";

function Thumb({ loader, url }: { loader: MediaLoader; url: string }) {
  const { status, url: src, error } = useMedia(loader, url);
  return status === "ready" ? <img src={src} alt="" /> : <span>{status}</span>;
}
```

`useMedia` acquires on mount, releases on unmount or when the loader, URL or `inert` option
changes, and is correct under StrictMode's mount, cleanup, mount. It reports `idle` for a missing
URL, never shows the previous URL's blob under a new URL, and releases a result that arrives after
unmount. `purge()` revokes URLs that mounted components still hold: unmount the tree on sign-out.

## API

| Export | Meaning |
| --- | --- |
| `createMediaLoader(options)` | `{ storage, scope, maxBytes, maxTotalBytes, maxEntries, maxPixels?, sniff?, allow?, objectUrls? }`. Invalid limits throw `RangeError`, invalid `allow` entries or container URLs throw `TypeError`, at creation only. |
| `loader.acquire(url, { signal?, inert? })` | `Promise<Result<{ url, contentType, bytes, release() }>>`. Never throws. |
| `loader.revalidate(url, { signal? })` | Conditional re-read (`If-None-Match` with the remembered ETag). `{ changed }`. |
| `loader.invalidate(url)` | Notification hook: drop the entry and stop sharing any read in flight. |
| `loader.purge()` / `loader.resume()` | Revoke everything and abort reads; refuse (`purged`) until resumed. |
| `loader.stats()` | `{ entries, bytes, inFlight, purged }` for diagnostics and tests. |
| `DEFAULT_ALLOWED_TYPES`, `INERT_TYPE`, `defaultSniff`, `imageDimensions` | Policy constants and the pure helpers. |
| `useMedia(loader, url, { inert? })` (`/react`) | `{ status: idle \| loading \| ready \| error, url, error }`. |

Errors are a closed set (`out-of-scope`, `not-found`, `forbidden`, `too-large`, `unsupported-type`,
`offline`, `aborted`, `purged`, `failed`) with a fixed message per code. No message contains a URL,
header or server text, so nothing with a query string or credentials can leak through an error. A
media URL with a query, fragment, credentials, whitespace, control character, backslash or an
encoded delimiter (`%2f`, `%5c`, `%2e`, `%3f`, `%23`, control characters) is `out-of-scope`.

## Type rules

The default allowlist is PNG, JPEG, GIF, WebP, AVIF, MP4, WebM, MP3, WAV, Ogg (Vorbis or Opus),
FLAC and GLB. `allow` replaces it, but only with passive `image/`, `audio/`, `video/` or `model/`
types and never anything naming svg, xml, html or script: such a list throws at creation.

- Anything the sniffer does not recognise, or recognises but `allow` omits (for example HEIC, M4A and
  QuickTime are sniffed but not on the default list), is `unsupported-type`.
- A polyglot guard refuses bytes that carry `<svg`, `<html`, `<script` or `<!doctype` in the first
  512 bytes (an XML prolog in the first 64), ignoring NULs so UTF-16 markup is seen too. A GIF with an
  archive appended (GIFAR) is typed as the GIF and nothing else.
- `inert: true` returns anything off the allowlist as an `application/octet-stream` blob, for
  download-only use. It never produces a media type that sniffing did not allow. An inert entry is
  never handed to a non-inert caller, cached or shared in flight.
- `maxPixels` reads width and height from the PNG, JPEG, GIF, WebP (VP8, VP8L, VP8X) and
  AVIF/HEIC (`ispe`, largest box) headers and refuses larger images (`too-large`) before the caller
  decodes them. Unreadable or zero dimensions are `unsupported-type`; the guard fails closed.

**Sniffer convergence.** `src/sniff.ts` is a deliberate port of the magic-byte sniffer in
`packages/pod-media-store/src/sniff.ts` (branch `feat/pod-media-store`, not on main when this
package was written), with the same rules. The two copies must converge into one shared module once
both packages are on main; until then fix a sniffing bug in both.

## Lifetime

- Concurrent `acquire`s of one URL share one read and one object URL. A waiter that aborts does not
  cancel a read the others still want; when the last waiter aborts, the read is cancelled.
- The object URL is revoked only when its last holder has released **and** it is evicted or the loader
  is purged. Eviction is LRU over unreferenced entries, bounded by `maxEntries` and `maxTotalBytes`;
  a held entry is never revoked by eviction, so the bounds are soft while everything is held.
  Double `release()` is harmless; a release after `purge()` is harmless.
- Entries remember their ETag. `revalidate` re-reads conditionally; a changed resource yields a new
  object URL for new acquirers while existing holders keep theirs until release. A resource that has
  become `not-found`, `forbidden`, `too-large` or `unsupported-type` is dropped. Transient failures
  keep the entry. `invalidate` is for notification-driven updates; a read in flight at that moment
  serves only its own waiters.
- `purge()` revokes every URL, held or not, aborts reads, and refuses until `resume()`. A read that
  completes after a purge never creates an object URL.

## Verified vs assumed

Tests (vitest, 100% statements, branches, functions and lines enforced) run against the storage
client's memory pod and a real Solid backend over a scripted `fetch` (lying `Content-Length`, 4xx/5xx,
network failure, redirect). Real `URL.createObjectURL`, real decoding and real network timing are not
exercised: the object URL API is injected. The sniffer decides from bytes, not from a decode, so a
file that sniffs as PNG but fails to decode is shown as a broken image, not refused.

## Not migrated yet: the three private copies

This change adds the package only. A later migration of each copy would involve:

1. `apps/pod-manager/src/components/use-pod-media.ts` plus `inertBlob` in
   `apps/pod-manager/src/lib/viewers.ts`: replace the `podFetch` and `inertBlob` pair with one loader
   per signed-in session (scope: the user's storages, via `isInOwnPods`), `useMedia` for the hook, and
   `loader.purge()` on logout or WebID change. Today it types a blob by its **declared** type and
   allows `image/bmp`, `x-icon`, any `audio/*`, `video/*` and `application/pdf`; BMP and ICO would
   become `unsupported-type` or `inert`, and PDF needs its own decision.
2. `apps/suite/src/apps/drive/lib/preview/image-resolver.ts`: `createPreviewImageResolver` becomes a
   thin adapter, `(url, signal) => acquire(url, { signal })` returning `value.url` and releasing on
   the signal's abort. It currently revokes on abort and takes the blob's type from the response.
3. `packages/suite-ui/src/components/preview-pane.tsx` (`useBlobUrl`): it builds object URLs from a
   caller-supplied `Blob` and forces `application/pdf` by slicing. It would take a loader (or
   handles) instead of a blob for image, audio and video, keep text and Markdown on `blob.text()`,
   and keep PDF out of the loader or add it to `allow` deliberately.

None of these apps may depend on `@jeswr/storage-client/solid` or `/lws`; the loader takes the
`StorageClient` they already hold.
