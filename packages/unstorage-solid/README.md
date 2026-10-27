<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/unstorage-solid

An unstorage driver that maps key-value operations to LDP resources in a Solid pod.

Values remain opaque text, JSON, or binary data; only container listings are parsed as RDF.

> Experimental. The caller must inject an authenticated fetch for private pod data.

## Install

```sh
npm install github:jeswr/unstorage-solid#main unstorage
```

`unstorage` is a peer dependency. Requires Node.js 20 or newer, or a modern browser.

## Minimal usage

```ts
import solidDriver from "@jeswr/unstorage-solid";
import { createStorage } from "unstorage";

const storage = createStorage({
  driver: solidDriver({
    base: "https://alice.example/kv/",
    fetch: authenticatedFetch,
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
- Options: `base`, `fetch`, headers, default content type, and optional notification-backed watch.
- Concurrency: `getMeta` returns an ETag; pass it to a write to use `If-Match`.
- Errors: `SolidHttpError`, `SolidPreconditionFailedError`, and the deprecated
  `SolidRedirectError` alias of `@jeswr/guarded-fetch`’s `RedirectRefusedError`.

Container listings use `@jeswr/ldp-container` for RDF parsing and per-entry scope filtering.
The local `listContainer(containerUrl, base, fetchImpl)` wrapper keeps its signature and
returns `null` for 404/410. Invalid or unsafe member URLs are skipped individually; request
headers, recursion, key mapping, and the existing stricter scope/redirect checks stay local.

Request inputs use `@jeswr/guarded-fetch`'s `snapshotFetchInput` before scope validation,
preserving bodies and request policies across supported implementations. Mutable URL objects
are captured once before fetching.
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
