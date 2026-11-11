---
name: ldp-container
description: Use when reading LDP container memberships, building typed listing metadata, sharing listing parsing across Solid clients, filtering untrusted ldp:contains entries, or maintaining @jeswr/ldp-container.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Shared LDP container listings

Use `readContainerMembers(fetch, containerUrl, { scope, package?, signal?, maxBytes?, maxQuads? })`
for ordinary GETs; 404/410 returns null. Inject the caller's scoped, redirect-refusing fetch. This helper
checks the initial URL and delegates transport policy to that fetch.
Pass the body stream directly to `parseRdf` (null body becomes `""`), with `maxBytes` defaulting
to 16 MiB, optional `maxQuads` (parser default 1,000,000), and the same `signal` passed to fetch.
The fetch-rdf hardening change supplies limit/abort enforcement and stream cancellation;
limits reject with `code: "PARSE_LIMIT"`, and abort rejects with `AbortError` even for stalled
bodies. Cancel missing/non-ok response bodies best effort, without awaiting cancellation.

Use `parseContainerMembers(dataset, containerUrl, { scope, allowRoot? })` after custom reads
such as y-solid's capped streaming read. Membership must come from `ContainerDataset`;
never match triples by hand. Resolve and guard every entry inside its own try/catch, use
the canonical value returned by `assertWithinPodScope`, and preserve listing order while
deduplicating by URL. Accept only NamedNodes. Guard members against both `scope` and
`containerUrl` with `{ allowRoot: false }` for the latter: ancestors, siblings, and all
self aliases must be skipped, even when they are inside the broader scope. `allowRoot`
only controls the overall scope check. Encoded `%2F`/`%5C` paths are refused by guarded-fetch.
Supply a single-container dataset: the first `ldp:contains` subject selected by
`ContainerDataset` supplies membership, independently of `containerUrl`. Mixed-container
datasets are unsupported; `containerUrl` is the resolution base and containment boundary.

Keep scope guards in `@jeswr/guarded-fetch`; do not re-export them here. Keep stricter
compatibility filters, sorting, non-container filters, and read caps in callers. Never
weaken those policies while consolidating listings. The runtime must remain browser-safe.

`buildListingDataset(containerUrl, entries: Iterable<ListingMetadata>)` constructs synthetic
default-graph membership and metadata through `@solid/object` accessors and the shared
`rdf-serialize/wrapper` literal helpers. Supply `url`, `title`, nullable `modified` (Date),
`size` and `contentType`, plus `types`. Null fields are omitted; zero, epoch dates and empty
strings survive. Only supplied types are emitted. Vocabulary constants come from suite-vocab.
This builder does no I/O, scope checks or URL validation; callers enforce identifier policy
and collect a complete successful listing before replacing a cached graph.
