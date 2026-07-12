# @jeswr/unstorage-solid

An [unstorage](https://unstorage.unjs.io) `defineDriver()` driver that backs
unstorage's key-value API with a [Solid](https://solidproject.org) pod over LDP.

unstorage keys map to LDP resource paths under a fixed `base` container. Stored
**values are opaque KV blobs** (text / JSON / binary) — they are never RDF-parsed.
The **only** RDF the driver touches is the LDP **container listing** used by
`getKeys` / `clear`, parsed via [`@jeswr/fetch-rdf`](https://github.com/jeswr/fetch-rdf)
+ [`@solid/object`](https://www.npmjs.com/package/@solid/object) (never hand-built
Turtle).

> Experimental, AI-agent-generated. Part of the `@jeswr` Solid app suite.

## Install

`unstorage` is a **peer dependency** — install it alongside the driver:

```sh
npm install github:jeswr/unstorage-solid#main unstorage
```

The package commits a self-contained `dist/` (with `@jeswr/fetch-rdf` inlined via
esbuild), so it installs and imports directly from a GitHub branch under
`ignore-scripts=true` with **no build step**. npm publish is a deferred migration
(see [Follow-ups](#follow-ups)).

## Usage

### unstorage (`createStorage`)

```ts
import { createStorage } from "unstorage";
import solidDriver from "@jeswr/unstorage-solid";

const storage = createStorage({
  driver: solidDriver({
    base: "https://alice.pod.example/kv/",
    fetch: session.fetch, // an authenticated Solid fetch (see "Auth" below)
  }),
});

await storage.setItem("foo:bar", "hello"); // PUT https://alice.pod.example/kv/foo/bar
const v = await storage.getItem("foo:bar"); // "hello"
await storage.setItem("config:flags", { dark: true }); // JSON round-trips
const keys = await storage.getKeys("foo"); // ["foo:bar"]
await storage.removeItem("foo:bar");
await storage.clear(); // delete everything under the driver base
```

### Clearing a sub-prefix

`storage.clear()` (no argument) deletes everything under the driver `base`.

`storage.clear("foo")` on a **root-mounted** driver does **not** clear `foo/` —
this is unstorage routing, not the driver: unstorage's `clear(prefix)` dispatches
to the mounts whose mountpoint is *under* `prefix` (`getMounts(prefix, false)`),
and the root mount (`""`) is a *parent* of `"foo:"`, so it is excluded and the
call is a no-op. To clear only a sub-tree, **mount the driver under that prefix**
and clear the mountpoint:

```ts
storage.mount("foo", solidDriver({ base: "https://alice.pod.example/kv/foo/", fetch }));
await storage.clear("foo"); // dispatches to the "foo" mount → deletes everything under foo/
```

(The driver's own `clear(relativeBase)` honours a sub-prefix — that is what
unstorage invokes for a mounted prefix — so prefix-clear works exactly when
unstorage actually routes the prefix to the driver.)

### Nitro / Nuxt `useStorage()`

Mount the driver as a Nitro storage mountpoint (`nitro.config.ts` /
`nuxt.config.ts`):

```ts
// nitro.config.ts
export default defineNitroConfig({
  storage: {
    pod: {
      driver: "@jeswr/unstorage-solid",
      base: "https://alice.pod.example/kv/",
      // `fetch` cannot be expressed in static config; for an authenticated pod
      // build the driver in a plugin (below) and `mountStorage` it at runtime.
    },
  },
});
```

For an **authenticated** pod, mount at runtime in a Nitro plugin where you have a
session/credentials `fetch`:

```ts
// server/plugins/solid-storage.ts
import solidDriver from "@jeswr/unstorage-solid";

export default defineNitroPlugin(() => {
  const storage = useStorage();
  storage.mount(
    "pod",
    solidDriver({ base: "https://alice.pod.example/kv/", fetch: authedFetch }),
  );
});
// then: await useStorage("pod").setItem("foo:bar", "hello")
```

## Injecting an authenticated `fetch`

The driver issues **all** pod requests through the `fetch` you provide; it adds no
auth of its own. This is the trust boundary — pass a `fetch` that is already
authenticated (and, for Solid, DPoP-bound) for the WebID whose pod you address.

- **Browser:** the session `fetch` from your Solid login (e.g.
  `@solid/reactive-authentication`, `@inrupt/solid-client-authn-browser`).
- **Node (client credentials):** a DPoP-bound fetch from
  [`@jeswr/solid-dpop`](https://github.com/jeswr/solid-dpop):

  ```ts
  import { createDpopFetch } from "@jeswr/solid-dpop"; // a client-credentials session fetch
  const fetch = await createDpopFetch({
    /* clientId, clientSecret, oidcIssuer, … */
  });
  const storage = createStorage({
    driver: solidDriver({ base: "https://service.pod.example/kv/", fetch }),
  });
  ```

If you omit `fetch`, the global `fetch` is used and only public resources work.

## Key ↔ LDP-path mapping

unstorage keys are `:`-delimited. The driver maps them to LDP resource paths
**under `base`**, with these exact rules (the security surface — fail-closed):

| Rule | Detail |
|---|---|
| **base** | normalised to exactly one trailing `/` (a container URL); query/fragment stripped; must be `http(s)`. |
| **separator** | `:` → `/`. So `foo:bar:baz` → `<base>foo/bar/baz`. |
| **encoding** | each segment is `encodeURIComponent`-encoded (spaces, `#`, `?`, reserved chars are safe), and decoded symmetrically when mapping a container member back to a key. The round-trip is exact. |
| **empty segments** | a leading / trailing / double `:` (an empty segment) is **rejected** — it would blur the resource/container line. |
| **traversal guard** | a segment equal to `.` or `..` (literally **or** after URI-decoding, e.g. `%2e%2e`) is **rejected**. A raw `/` or `\` in a key is rejected. |
| **containment** | the resolved URL is re-validated to be `base` itself or a strict descendant (same origin, path prefixed by base path). A key can never escape `base` or reach another origin. |

Resource keys map to non-container LDP resources. In `getKeys`, container members
(trailing slash / `ldp:Container`) are **recursed into** (respecting
`opts.maxDepth`); only non-container members become keys. `clear` deletes
resources before their containers.

**Key normalisation.** A key segment is URI-decoded then re-`encodeURIComponent`-ed,
so *equivalent* percent-spellings converge on one resource (e.g. `A`, `%41` and a
lowercase `%3a` vs `%3A` map to the same URL). This is intentional — it also lets you
pass a pre-encoded `%2F` to keep a literal `/` **inside** a single segment (a raw `/`
key is rejected). Ordinary keys (identifiers without `%`) are unaffected and map
**injectively** to distinct resources; only exotic keys differing solely in redundant
percent-encoding share a resource.

## Security model

The driver's trust boundary is the injected `fetch`; on top of it, the URL layer is
**fail-closed**:

- **Containment.** Every key is mapped to a URL that is re-validated to be `base` or a
  strict descendant (traversal / absolute / cross-origin segments are rejected — see
  the mapping table above). A key can never address another origin or escape `base`.
- **Hostile container listings.** `getKeys` / `clear` parse the `ldp:contains`
  listing through `@jeswr/fetch-rdf` + `@solid/object` (never hand-parsed). Any member
  IRI that is not within `base` is **dropped** — a malicious or buggy server cannot
  inject a foreign URL into the key space or trick `clear` into deleting a resource
  outside `base`.
- **Redirect refusal (SSRF / credential-leak guard).** Every pod request goes through a
  single scoped `fetch` that forces `redirect: "manual"` and **refuses** any redirect
  (throwing `SolidRedirectError`) rather than following it. `assertWithinBase` only
  vets the *initial* URL, so without this a poisoned in-pod resource (e.g. one planted
  by an app with append access in a shared pod) could answer a credentialed `GET`/`PUT`
  with a `302` to a foreign origin and the underlying `fetch` would forward your
  `Authorization` / DPoP headers off-origin. A Solid pod addressed by exact, normalised
  URLs never legitimately redirects a data request, so a redirect is treated as
  hostile and fails closed (a `304 Not Modified` is not a redirect and passes through).
- **Watch discovery (opt-in `watch: true`).** Notification discovery / subscription
  requests follow pod-controlled URLs (a `Link` header, then RDF in the storage
  description) that are legitimately same-origin but may lie *outside* `base`, so they
  use a same-origin, **redirect-refusing** fetch: a target that leaves the pod origin,
  or a description doc that redirects off-origin, is refused (the watch degrades to a
  no-op) so the injected `fetch`'s credentials are never forwarded off-origin.

### Container auto-creation (CSS vs ESS)

On `setItem` of a deep key (`a:b:c`) where intermediate containers do not exist,
servers differ: the
[Community Solid Server](https://github.com/CommunitySolidServer/CommunitySolidServer)
auto-creates intermediate containers on a deep `PUT`, while ESS historically did
not. The driver handles both: on a `404`/`409` from the resource `PUT` (and only
when no `If-Match` is set, so a concurrency rejection is never masked) it creates
the missing ancestors top-down with
`PUT … Link: <http://www.w3.org/ns/ldp#BasicContainer>; rel="type"`, then retries
the resource `PUT` once.

## Optimistic concurrency (ETags)

`getMeta(key)` returns `{ status, mtime, size, etag, mimeType }`. Pass that `etag`
back as `opts.etag` on a write and the driver sends `If-Match`; a stale write is
rejected by the server with `412`, surfaced as a `SolidPreconditionFailedError`:

```ts
const meta = await storage.getMeta("doc:1");
await storage.setItem("doc:1", "v2", { etag: meta?.etag }); // throws on conflict
```

## Watch / live updates (notifications)

`watch(callback)` subscribes via the
[Solid Notifications Protocol](https://solidproject.org/TR/notifications-protocol)
`WebSocketChannel2023`: it discovers the storage-description's subscription
service (`Link` rel `…#storageDescription` → description doc → WebSocketChannel2023
service), `POST`s a channel request for the `base` container topic, opens the
returned `receiveFrom` WebSocket, and maps each ActivityStreams notification to
`callback("update" | "remove", key)`.

Watch is **opt-in** (`watch: true`) and **degrades gracefully**: if the pod
advertises no notification channel, or discovery/subscribe/socket setup fails,
`watch()` returns a no-op `Unwatch` and **never throws**. The WebSocket
implementation is the global `WebSocket` (browser + Node ≥ 22); no static `ws`
dependency, so the core import stays browser-safe.

```ts
const storage = createStorage({
  driver: solidDriver({ base: "https://alice.pod.example/kv/", fetch, watch: true }),
});
const unwatch = await storage.watch((event, key) => console.log(event, key));
// ... later
await unwatch();
```

## Self-contained dist / GitHub-installable under `ignore-scripts`

The committed `dist/index.js` is an esbuild bundle that **inlines** the off-npm
`@jeswr/fetch-rdf` (which ships no usable `dist/`), while keeping the npm-published
deps (`n3`, `@solid/object`, `@rdfjs/wrapper`, `@rdfjs/types`,
`jsonld-streaming-parser`, `content-type`) and the `unstorage` peer **external**.
A `check:dist` gate fails if the committed `dist/` drifts from a fresh build of
`src/`.

## API

| Export | Description |
|---|---|
| `default` | `defineDriver`-wrapped `solidDriver(options)` factory. |
| `SolidDriverOptions` | driver configuration (`base`, `fetch`, `headers`, `defaultContentType`, `watch`). |
| `SolidHttpError` | thrown on an uninterpretable non-2xx response. |
| `SolidPreconditionFailedError` | thrown on a `412`/`428` optimistic-concurrency rejection. |
| `SolidRedirectError` | thrown when a pod request is redirected (refused, not followed — the SSRF / credential-leak guard). |

The full public API surface is snapshotted in
[`etc/unstorage-solid.api.md`](./etc/unstorage-solid.api.md) (api-extractor) and
the gate fails on drift.

## Development

```sh
npm install          # pulls @jeswr/fetch-rdf from GitHub
npm run lint         # biome + lockfile-transport guard
npm run typecheck    # build:deps then tsc --noEmit
npm test             # build:deps then vitest
npm run build        # esbuild bundle + tsc .d.ts -> dist/
npm run check:dist   # committed dist/ matches a fresh build of src/
npm run check:api    # public API matches etc/unstorage-solid.api.md
npm run publint      # package.json export sanity
npm run attw         # are-the-types-wrong
```

## License

MIT © Jesse Wright

---

<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->
Authored by Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
