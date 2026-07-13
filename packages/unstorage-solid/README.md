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
targets, hostile listing members, and redirects are rejected.

## Key API

- Default export: `solidDriver(options)`, ready for `createStorage` or a Nitro mount.
- Options: `base`, `fetch`, headers, default content type, and optional notification-backed watch.
- Concurrency: `getMeta` returns an ETag; pass it to a write to use `If-Match`.
- Errors: `SolidHttpError`, `SolidPreconditionFailedError`, `SolidRedirectError`.

## Links

- [Source](https://github.com/jeswr/unstorage-solid)
- [Issues](https://github.com/jeswr/unstorage-solid/issues)
- [unstorage](https://unstorage.unjs.io/)
- [Solid Protocol](https://solidproject.org/TR/protocol)

## License

[MIT](./LICENSE) © Jesse Wright
