---
name: ldp-container
description: Use when reading LDP container memberships, sharing listing parsing across Solid clients, filtering untrusted ldp:contains entries, or maintaining @jeswr/ldp-container.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Shared LDP container listings

Use `readContainerMembers(fetch, containerUrl, { scope, package? })` for ordinary GETs;
404/410 returns null. Inject the caller's scoped, redirect-refusing fetch. This helper
checks the initial URL and delegates transport policy to that fetch.

Use `parseContainerMembers(dataset, containerUrl, { scope, allowRoot? })` after custom reads
such as y-solid's capped streaming read. Membership must come from `ContainerDataset`;
never match triples by hand. Resolve and guard every entry inside its own try/catch, use
the canonical value returned by `assertWithinPodScope`, skip self by origin/pathname,
and preserve listing order while deduplicating by URL. `allowRoot: false` excludes the
scope root; self is always skipped. Encoded `%2F`/`%5C` paths are refused by guarded-fetch.

Keep scope guards in `@jeswr/guarded-fetch`; do not re-export them here. Keep stricter
compatibility filters, sorting, non-container filters, and read caps in callers. Never
weaken those policies while consolidating listings. The runtime must remain browser-safe.
