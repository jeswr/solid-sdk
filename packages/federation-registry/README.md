<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

# @jeswr/federation-registry

> **Experimental — AI-agent-generated.** Authored by an AI coding agent (Claude
> Opus 4.8, @jeswr PSS agent). Under active development; **not
> production-hardened.** Validate against your own data before relying on it.

A typed TypeScript client for the Solid Federation **Catalogue / Registry**
vocabulary (`fedreg:`) published at
[`https://w3id.org/jeswr/fedreg#`](https://w3id.org/jeswr/fedreg) (source:
[`jeswr/solid-federation-vocab`](https://github.com/jeswr/solid-federation-vocab)).

This is the **discovery axis** of a Solid data federation — one of the five
federation services in the architecture (Scheme Authority, Conformance Assessor,
Vocabulary/Spec Hub, **Catalogue/Registry**, Receipt/Audit log; see
`full-solid-ecosystem` recommendation R9 / research brief 09). It answers two
questions the self-asserted [`fedapp:`](https://w3id.org/jeswr/fed) layer
([`@jeswr/federation-client`](https://github.com/jeswr/federation-client))
deliberately cannot:

1. **Who is actually a member?** A `fedreg:Registry` lists apps via
   `fedreg:Membership` records. A Membership is the **registry's own** assertion —
   it carries a lifecycle `status` (`Proposed` / `Active` / `Suspended` /
   `Revoked`) and the `assertedBy` authority — so a consumer can trust the listing
   as a membership claim. **Never trust a self-asserted `fedapp:App` as a
   membership claim** — that is exactly the gap a registry closes.
2. **Which storage accepts which spec-version?** A `fedreg:StorageDescription`
   advertises the client-client spec-**versions** a resource server accepts
   (`acceptsSpec`) and the sectors it supports. This realises the federation's
   **decoupling** principle and is the substrate for **asynchronous schema
   migration**: during a dual-read window a storage advertises both the old and
   the new version, so apps, pods and resource servers upgrade on independent
   clocks. An app discovers acceptable versions here, never by assumption.

> **Membership establishment is a signed challenge — not in this SDK.**
> `verifyMembership()` checks a membership record is *well-formed* and names an
> `assertedBy` authority; it does **not** verify the cryptographic signature
> binding the assertion to that authority (that layers above this vocabulary), and
> it does **not** establish membership (the registry does, after a signed
> challenge). Treat `assertedBy` as the authority to check against your trust
> anchors, not as proof on its own.

## Install

Not yet on npm — install directly from the GitHub branch (npm publish deferred):

```sh
npm install github:jeswr/federation-registry#main
```

This works with **no build step**, even under `ignore-scripts=true`: the committed
`dist/` is self-contained. The package's one off-npm dependency,
[`@jeswr/fetch-rdf`](https://github.com/jeswr/fetch-rdf), is **bundled (inlined)**
into `dist/index.js`; every other runtime dependency (`n3`, `@rdfjs/wrapper`, and
fetch-rdf's own runtime deps `jsonld-streaming-parser` + `content-type`) is
npm-published and resolves normally.

Peer runtime: Node ≥ 24 (a transitive requirement of the RDF stack), ESM only.

> **Maintainers — the committed `dist/` is the install artifact.** Because
> consumers install from this branch without running the build, you MUST rebuild
> and commit `dist/` whenever `src/` changes: `npm run build` then commit `dist/`.
> `npm run check:dist` fails if the committed `dist/` has drifted from `src/`.

## Surface

### Registry — who is a member

```ts
import {
  buildRegistry,
  parseRegistry,
  listMembers,
  verifyMembership,
} from "@jeswr/federation-registry";

// Author a registry document (the registry operator's path).
const reg = buildRegistry({
  id: "https://registry.example/federation",
  members: [
    {
      id: "https://registry.example/federation#pod-music",
      app: "https://music.example/clientid.jsonld",
      status: "Active",
      assertedBy: "https://registry.example/profile/card#me",
      // asserted defaults to new Date().toISOString()
    },
  ],
});
const turtle = await reg.toString(); // text/turtle by default

// Discover + verify members (the consumer's path).
const parsed = await parseRegistry("https://registry.example/federation", {
  fetch: authFetch, // optional; defaults to globalThis.fetch
});
for (const m of parsed.members) {
  if (m.valid && m.membership?.status === "Active") {
    console.log("active member:", m.membership.app, "asserted by", m.membership.assertedBy);
  }
}

// listMembers() is a convenience over parseRegistry returning just the members
// (and falling back to bare fedreg:Membership records when no Registry wraps them).
const members = await listMembers("https://registry.example/federation", { fetch: authFetch });

// Verify a single membership record / body in hand (no network):
const v = await verifyMembership("https://registry.example/m1", {
  body: turtle,
  bodyContentType: "text/turtle",
});
```

A membership is **valid** only when it names exactly one `app`, a recognised
`status`, and at least one `assertedBy` authority — the three things that make it
a *registry* assertion rather than a self-description.

### Storage — which spec-versions does a resource server accept

```ts
import {
  describeStorage,
  parseStorage,
  acceptsSpec,
  unsupportedSpecs,
} from "@jeswr/federation-registry";

// A resource server advertises what it accepts (the storage operator's path).
const desc = describeStorage({
  id: "https://alice.pod.example/",
  acceptsSpec: [
    "https://w3id.org/jeswr/sectors/scheduling#1.0.0",
    "https://w3id.org/jeswr/sectors/scheduling#1.1.0", // dual-read window
  ],
  supportsSector: ["https://w3id.org/jeswr/sectors/scheduling#sector"],
});
const turtle = await desc.toString();

// An app checks, BEFORE writing, that the storage accepts the spec-version it
// validates data against — the migration-coordination query.
const result = await parseStorage("https://alice.pod.example/", { fetch: authFetch });
if (result.valid && result.storage) {
  if (acceptsSpec(result.storage, "https://w3id.org/jeswr/sectors/scheduling#1.1.0")) {
    // safe to write 1.1.0-shaped data
  }
  // Or: which of my wanted versions does this storage NOT accept yet?
  const gap = unsupportedSpecs(result.storage, [
    "https://w3id.org/jeswr/sectors/scheduling#1.1.0",
    "https://w3id.org/jeswr/sectors/scheduling#2.0.0",
  ]);
}
```

Spec-version matching is **exact-IRI**: spec versions are immutable, persistent
IRIs, so an app must advertise and check the *exact* version it writes against —
never a loose/prefix match that could silently accept an incompatible version.

### Vocabulary helpers

```ts
import {
  FEDREG,             // "https://w3id.org/jeswr/fedreg#"
  MEMBERSHIP_STATUS,  // { Proposed, Active, Suspended, Revoked } → fedreg: IRIs
  statusName,         // fedreg: IRI → "Active" | … | undefined
  TRUSTED_STATUS,     // Set<"Active"> — statuses denoting a live membership
  VALID_STATUS_IRIS,
} from "@jeswr/federation-registry";
```

## How it fits the federation

| Federation service | Package |
|---|---|
| Vocabulary / Spec Hub | [`solid-federation-vocab`](https://github.com/jeswr/solid-federation-vocab) (`fedapp:`, `fedreg:`, `core:`, sectors) |
| App self-registration (`fedapp:`) | [`@jeswr/federation-client`](https://github.com/jeswr/federation-client) — `verify` / `list` / `selfDescribe` |
| **Catalogue / Registry (`fedreg:`)** | **`@jeswr/federation-registry`** (this package) |
| Shared task / issue model | [`@jeswr/solid-task-model`](https://github.com/jeswr) |

`fedreg:` reuses **DCAT** (`dcat:Catalog` / `dcat:CatalogRecord`,
`fedreg:member ⊑ dcat:record`) and Dublin Core Terms for the catalogue spine — the
LD/SW "reuse, don't reinvent" rule — adding only the federation-specific glue: the
registry-asserted membership and the spec-version-acceptance advertisement.

## RDF discipline

This SDK follows the suite's non-negotiable RDF rules: **parse** with
[`@jeswr/fetch-rdf`](https://github.com/jeswr/fetch-rdf), **extract** with
[`@rdfjs/wrapper`](https://www.npmjs.com/package/@rdfjs/wrapper) typed accessors,
**serialise** with `n3.Writer`. There is no bespoke RDF parser and no hand-built /
hand-concatenated triples — all reads and writes go through the typed wrappers in
[`src/wrappers.ts`](./src/wrappers.ts).

## Linked-Data-API conventions

`parseRegistry` / `verifyMembership` / `parseStorage` negotiate
`text/turtle, application/ld+json;q=0.9` on every fetch (the `@jeswr/fetch-rdf`
default — the two RDF media types the Solid Protocol requires). The registry
document is a `dcat:Catalog`; the storage description aligns with DCAT-style
self-description.

## Development

```sh
npm install
npm run lint        # biome
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # esbuild: bundle src/ (+ inline @jeswr/fetch-rdf) → dist/index.js; tsc → dist/*.d.ts
npm run check:dist  # fail if committed dist/ has drifted from src/
```

After any change to `src/`, run `npm run build` and commit the regenerated
`dist/` — `npm run check:dist` enforces that the artifact matches the source.

## License

MIT — Jesse Wright.
