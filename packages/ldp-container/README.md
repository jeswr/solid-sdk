<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/ldp-container

Browser-safe LDP container listings shared by solid-memory, unstorage-solid, and y-solid.
This security-critical package filters attacker-controlled `ldp:contains` URLs. It has no
mirror repository configured.

```ts
import { readContainerMembers } from "@jeswr/ldp-container";

const members = await readContainerMembers(authenticatedScopedFetch, containerUrl, {
  scope: podBase,
  package: "my-app",
});
```

`readContainerMembers(fetch, containerUrl, { scope, package? })` checks the request target,
GETs Turtle or JSON-LD, and returns `null` on 404/410. Other HTTP failures throw with the
selected package prefix (default `[ldp-container]`). Supply a fetch that enforces your
redirect and credential policy; this helper does not wrap or replace that policy.

`parseContainerMembers(dataset, containerUrl, { scope, allowRoot? })` works on an RDF/JS
`DatasetCore` without fetching. It reads membership through `@solid/object` and returns
`ContainerMember[]` (`{ url, container }`) in listing order, deduplicated by canonical URL.
Malformed, foreign, escaping, credential-bearing, non-HTTP(S), and encoded-path-delimiter
members are skipped individually. The listed container itself is always omitted, including
query/fragment aliases. `allowRoot: false` additionally excludes the scope root; by default
that root is allowed when it differs from the listed container. Container classification
uses the URL pathname's trailing slash.

Import scope guards directly from `@jeswr/guarded-fetch`. Callers retain application-specific
filters, compatibility guards, read-size limits, and sorting.
