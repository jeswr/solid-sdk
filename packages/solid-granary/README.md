<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-granary

Import granary ActivityStreams 2.0 posts and feeds into owner-private Solid resources.

The adapter maps granary output to the suite's canonical chat model and preserves source
provenance; it does not reimplement ActivityStreams or hand-build RDF.

> Experimental. Use an existing owner-private container and an authenticated pod fetch.

## Install

```sh
npm install github:jeswr/solid-granary#main @rdfjs/types
```

Requires Node.js 24 or newer.

## Minimal usage

```ts
import { ingestGranary } from "@jeswr/solid-granary";

const report = await ingestGranary(activityStreamsPayload, {
  writeFetch: authenticatedFetch,
  container: "https://alice.example/imports/granary/",
});

console.log(`${report.written}/${report.total} imported`);
```

Pass either one AS2 object or an AS2 Collection. Use `fetchGranary` when the package should retrieve
the remote payload through its SSRF guard.

## Key API

- `ingestGranary`: transform and write a payload, returning a per-item report.
- `granaryToCanonical`, `granaryObjectToCanonical`: pure transforms without pod I/O.
- `fetchGranary`: bounded, SSRF-guarded remote fetch.
- `iterateObjects`: flatten objects, collections, and activity envelopes.
- `defaultSlug`: stable resource naming for idempotent re-imports.
- `GranaryFetchError`: structured remote-fetch failure.

## Links

- [Source](https://github.com/jeswr/solid-granary)
- [Issues](https://github.com/jeswr/solid-granary/issues)
- [granary](https://github.com/snarfed/granary)
- [ActivityStreams 2.0](https://www.w3.org/TR/activitystreams-core/)

## License

[MIT](./LICENSE) © Jesse Wright
