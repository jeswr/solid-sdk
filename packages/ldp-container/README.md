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

`readContainerMembers(fetch, containerUrl, { scope, package?, signal?, maxBytes?, maxQuads? })`
checks the request target, GETs Turtle or JSON-LD, and returns `null` on 404/410. Other HTTP failures throw with the
selected package prefix (default `[ldp-container]`). Supply a fetch that enforces your
redirect and credential policy; this helper does not wrap or replace that policy.
Missing and non-ok response bodies are cancelled best effort without awaiting cancellation.
The response body stream goes directly to `fetch-rdf`'s `parseRdf`, with a default `maxBytes`
of 16 MiB and optional `maxQuads` (fetch-rdf defaults to 1,000,000). Limits reject with
`RdfFetchError.code === "PARSE_LIMIT"` and cancel the stream. `signal` covers both fetch and
parsing, including a stalled body; abort rejects with `AbortError`. An empty null body is
parsed as an empty listing. Requires a fetch-rdf build with
`ParseRdfOptions.maxBytes`, `maxQuads`, and `signal` support.

`parseContainerMembers(dataset, containerUrl, { scope, allowRoot? })` works on an RDF/JS
`DatasetCore` without fetching. It reads membership through `@solid/object` and returns
`ContainerMember[]` (`{ url, container }`) in listing order, deduplicated by canonical URL.
Only NamedNode members are accepted; literals and blank nodes are skipped. Malformed,
foreign, escaping, credential-bearing, non-HTTP(S), and encoded-path-delimiter members are
skipped individually. Every member must pass both the overall scope guard and a strict
descendant guard rooted at `containerUrl`. Ancestors, siblings, and the listed container
itself (including query/fragment and slashless aliases) are always omitted. `allowRoot`
controls the overall scope check and cannot relax strict container containment. Container
classification uses the URL pathname's trailing slash.

Supply a single-container dataset: `ContainerDataset` selects its first container subject
(the first `ldp:contains` subject), independently of `containerUrl`. Mixed-container datasets
are unsupported. `containerUrl` supplies relative-IRI resolution and the containment boundary;
it does not select a subject from the dataset.

Import scope guards directly from `@jeswr/guarded-fetch`. Callers retain application-specific
filters, compatibility guards, any stricter read limits, and sorting.
