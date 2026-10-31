<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/unstorage-solid

An unstorage driver that maps key-value operations to a pod through `StorageClient`.

Values remain opaque text, JSON, or binary data; only container listings are parsed as RDF.

> Experimental. The caller must inject an authenticated fetch for private pod data.

## Install

```sh
npm install github:jeswr/unstorage-solid#main unstorage
```

`unstorage` is a peer dependency. Requires Node.js 24 or newer, or a modern browser.

## Minimal usage

```ts
import solidDriver from "@jeswr/unstorage-solid";
import { createPodClient } from "@jeswr/storage-client";
import { createStorage } from "unstorage";

const { storage: pod } = await createPodClient({ storage: "https://alice.example/kv/", fetch: authenticatedFetch });
const storage = createStorage({
  driver: solidDriver({
    base: "https://alice.example/kv/",
    storage: pod,
  }),
});

await storage.setItem("settings:theme", { mode: "dark" });
const settings = await storage.getItem("settings:theme");
const keys = await storage.getKeys("settings");
```

Keys are colon-delimited: `settings:theme` maps to `<base>settings/theme`. Traversal, cross-origin
targets, hostile listing members, and redirects are rejected. Encoded path delimiters
(`%2F` / `%5C`, case-insensitive) are refused, including pre-encoded key segments, because
Solid servers disagree about decoding them, which can change path boundaries. The key mapper
throws for these segments, and listings skip these member URLs. Encoded colons (`%3A`) and
percent signs (`%25`) remain supported.

## Key API

- Default export: `solidDriver(options)`, ready for `createStorage` or a Nitro mount.
- Options: `base`, `storage` (or legacy `fetch`), headers, default content type, and optional `notifications`/`watch`.
- Concurrency: `getMeta` returns an ETag; pass it to a write to use `If-Match`.
- Errors: `SolidHttpError`, `SolidPreconditionFailedError`, and the deprecated
  `SolidRedirectError` alias of `@jeswr/guarded-fetch`’s `RedirectRefusedError`.

Container listings use `storage.listAll`, with local per-entry scope filtering. The local
`listContainer(containerUrl, base, fetchImpl)` compatibility wrapper keeps accepting fetch
and returns `null` for 404/410. Invalid or unsafe member URLs are skipped individually.
Headers, recursion, key mapping and scope/redirect checks stay local. The fetch option creates
clients through the public `createPodClient` factory; discovery errors propagate. Driver and
transaction headers apply to this transport; an injected client owns its own transport headers.
`getMeta` reads resource headers, using listing metadata for optional size on injected clients;
it does not fetch the separate RDF/linkset metadata document. Deletes read an ETag first and
fail closed when a validator is unavailable. Clear still removes leaves before containers.

The persisted key layout requires stable path-based child names. Both memory protocols support
this layout. If an LWS create replaces a name hint with another identifier, the call fails;
it can leave an unindexed resource, which this driver never deletes implicitly. A persistent
key-to-identifier index is outside this mechanical migration.

Watch is opt-in (`watch: true`) and maps normalized `pod-notifications` changes to unstorage
`update`/`remove` callbacks. Pass `notifications` to reuse an existing client. The stacked T-040
implementation uses polling every 30 seconds, even when push is advertised. Containers observe
membership; individual edits require hot-resource subscriptions supplied by the notification client.
Unwatch/dispose detach listeners and close subscriptions, including subscriptions still opening.
The legacy internal `wsFactory` option remains accepted but no longer controls transport.

Request inputs use `@jeswr/guarded-fetch`'s `snapshotFetchInput` before scope validation.
Both wrappers forward the captured URL string and explicit init, preserving init bodies,
signals, and policies across Request implementations. Fields supplied only on the Request
are not inherited. Mutable URL objects are captured once before fetching.
With a non-null init body, metadata capture leaves the discarded Request body untouched,
so the same input can be reused and consumed or locked inputs accept replacement bodies.
`new SolidRedirectError(url, status)` remains supported with its original name, message,
`url`, and `status` fields. The alias also accepts the shared `(message, detail)` form and
recognizes errors thrown by `refuseRedirects` through `instanceof`.

## Links

- [Source](https://github.com/jeswr/unstorage-solid)
- [Issues](https://github.com/jeswr/unstorage-solid/issues)
- [unstorage](https://unstorage.unjs.io/)
- [Solid Protocol](https://solidproject.org/TR/protocol)

## License

[MIT](./LICENSE) © Jesse Wright
