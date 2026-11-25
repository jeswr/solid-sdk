---
name: pod-media-loader
description: Use when showing authenticated pod images, audio, video or GLB models in a browser or webview through blob object URLs, or when changing @jeswr/pod-media-loader's scope, sniffing, reference counting, ETag freshness, purge-on-logout or React hook.
---
<!-- AUTHORED-BY Claude Sonnet 5.5 -->

# Work with `@jeswr/pod-media-loader`

Private pod media cannot be loaded by URL. This package fetches the bytes with the caller's
`StorageClient` and returns `blob:` object URLs. Those are same-origin with the app, so the type
of the `Blob` is a security decision. Never bypass the loader with `new Blob([...], { type })` built
from a response's or a description's declared type.

## Quick use

```ts
import { createMediaLoader } from "@jeswr/pod-media-loader";

const loader = createMediaLoader({
  storage, // the StorageClient from createPodClient; the only transport
  getSessionKey: () => webId, // a changed key purges everything before anything is served
  scope: [`${storageRoot}media/`], // container URLs or (canonicalUrl) => boolean
  maxBytes: 25 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxEntries: 200,
  // maxPixels defaults to 64_000_000 (raise it deliberately)
});
const result = await loader.acquire(url, { signal });
if (result.ok) { img.src = result.value.url; /* ... */ result.value.release(); }
```

React: `useMedia(loader, url)` from `@jeswr/pod-media-loader/react` returns
`{ status, url, error }`; it acquires on mount and releases on unmount or change.

## GLB / glTF: external URIs

glTF JSON can reference external URIs that loaders fetch without credentials or scope, so a shared
model can beacon to any host. The loader validates the GLB header but never parses the JSON.
Whoever feeds a `model/gltf-binary` blob to a loader (three.js and the like) must make that loader
refuse every non-embedded URI (for example a `LoadingManager` URL modifier that only allows `blob:`
and `data:`). Do not skip this because "the blob is safe".

## Rules to keep

- One loader per signed-in session, with `getSessionKey` set to the WebID.
- Memory is a hard budget: a read that does not fit is `over-budget`; size `maxTotalBytes` as a
  multiple of `maxBytes` and release handles promptly. Reads run `maxConcurrent` at a time.
- `useMedia` follows `purge()` on its own (status `error`, code `purged`); other holders of handles
  must not use a URL after purge.

- Every acquire must be matched by `release()`. Eviction only revokes entries at zero references; a
  leaked handle pins its entry and its bytes.
- Call `loader.purge()` on sign-out and account switch, and unmount the components that used it.
  After a purge the loader refuses with `purged` until `loader.resume()`.
- Call `loader.invalidate(url)` from a notification or change handler, or `loader.revalidate(url)` to
  re-read conditionally. Existing holders keep their URL until they release it.
- Add a type to `allow` only if it is passive media. The loader throws at creation for anything
  naming svg, xml, html or script, and for `application/*` and `text/*`. Never add a sniffed type
  to show it in an `<iframe>`, `<object>`, `<embed>` or a new tab.
- Errors are a closed set; branch on `error.code` and never build UI text from a URL.
- A media URL with a query, fragment, credentials or an encoded delimiter is `out-of-scope`, with no request.
- With `maxPixels` set (it defaults to 64 MP) an allowed `image/*` type without a dimension reader is refused; use `inert` for such files.
- `inert: true` is download-only and never fails for type or pixels: show it as a file, never as media.

## Maintaining the package

- 100% statements, branches, functions and lines are enforced by `vitest.config.ts`; run
  `pnpm --filter @jeswr/pod-media-loader test`.
- `src/sniff.ts` is a port of the pod-media-store sniffer: change both copies together until one
  shared module exists. The type decision is magic bytes only (no text scan): safety is the passive output type, so
  never add an active type to the sniffer or `allow`. Pin every sniffing change with a test.
- Keep the purge guard (`purged || epoch !== flight.epoch`) synchronous with `createObjectURL`: no
  `await` may sit between them. The tests that pin it queue a purge in a microtask for that reason.
- No new dependencies without `pnpm run check:packages <name>`. The core must not import React.
