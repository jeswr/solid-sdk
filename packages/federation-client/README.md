<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

# @jeswr/federation-client

> **Experimental — AI-agent-generated.** Authored by an AI coding agent (Claude
> Opus 4.8). Under active development; **not production-hardened**. Validate
> against your own data before relying on it.

A typed TypeScript client for the Solid **app-registration / federation
vocabulary** (`fedapp:`) published at
[`https://w3id.org/jeswr/fed#`](https://w3id.org/jeswr/fed) (source:
[`jeswr/solid-federation-vocab`](https://github.com/jeswr/solid-federation-vocab)).

The `fedapp:` vocabulary is the OpenID-Federation-style metadata a Solid app
publishes **in its Client Identifier Document** — describing the data **sectors**
it operates in, the WAC/ACP **access modes** it requests, and the shared **shapes**
it consumes / produces / declares. This SDK reads, validates and builds those
registration documents.

> **Membership is the registry's job, not this SDK's.** `verify()` checks that a
> registration is *well-formed* against the vocabulary. It does **not** assert that
> an app *is a member* of any federation — that requires a signed challenge handled
> by the registry. Never treat a self-asserted registration as a membership claim.

## Install

Not yet on npm — install directly from the GitHub branch (npm publish deferred):

```sh
npm install github:jeswr/federation-client#main
```

This works with **no build step**, even under `ignore-scripts=true`: the
committed `dist/` is self-contained. The package's two off-npm `@jeswr/*`
dependencies, [`@jeswr/fetch-rdf`](https://github.com/jeswr/fetch-rdf) and
[`@jeswr/federation-registry`](https://github.com/jeswr/federation-registry), are
**bundled (inlined)** into `dist/index.js`; every other runtime dependency (`n3`,
`@solid/object`, `@rdfjs/wrapper`, `@rdfjs/types`, and the inlined deps' own runtime
deps `jsonld-streaming-parser` + `content-type`) is npm-published and resolves
normally. So a consumer never needs to clone or build either off-npm package. (The
runtime is fully inlined; `@jeswr/federation-registry` is also declared as a pinned
git dependency so its TypeScript declarations resolve for `RegistryDiscovery` /
`ResolvedStorageSpec` / `Membership` type imports.)

Peer runtime: Node ≥ 24 (a transitive requirement of `@solid/object`), ESM only.

> **Maintainers — the committed `dist/` is the install artifact.** Because
> consumers install from this branch without running the build, you MUST rebuild
> and commit `dist/` whenever `src/` changes: `npm run build` then commit `dist/`.
> The `npm run check:dist` gate fails CI/pre-merge if the committed `dist/` has
> drifted from `src/`.

## Surface

Five functions plus a serialiser, an SSRF-guarded fetch, and the vocabulary
constants. `verify` / `list` / `selfDescribe` operate on the self-asserted `fedapp:`
layer; `discoverFromRegistry` / `resolveStorageSpecVersion` consume the
registry-asserted `fedreg:` layer (via
[`@jeswr/federation-registry`](https://github.com/jeswr/federation-registry)).

### `verify(input, options?)` — validate a registration

Fetches (Turtle / JSON-LD content-negotiated, via `@jeswr/fetch-rdf`) and
validates an app's registration document against the `fedapp` vocabulary:
exactly one `fedapp:App`, every `fedapp:access` value is a valid `acl:` mode,
every `fedapp:SectorUse` carries a sector and at least one access mode, and the
registration is non-empty.

```ts
import { verify } from "@jeswr/federation-client";

const result = await verify("https://app.example/clientid.jsonld", {
  fetch: authFetch, // optional; defaults to globalThis.fetch
});

if (result.valid) {
  console.log(result.registration?.sectors, result.registration?.access);
} else {
  for (const issue of result.issues) {
    console.warn(issue.code, issue.message, issue.subject);
  }
}
```

Verify an in-hand body without a network round-trip:

```ts
const result = await verify("https://app.example/clientid", {
  body: turtleString,
  bodyContentType: "text/turtle",
});
```

### `list(source, options?)` — discover registrations

Discovers `fedapp:App` registrations from either a **registry resource** (one
document enumerating many apps) or an **LDP app-registry container** (each
`ldp:contains` member fetched + parsed). Each entry is verified.

```ts
import { list } from "@jeswr/federation-client";

// Auto: parse inline Apps; if none, follow ldp:contains members.
const entries = await list("https://registry.example/apps/", { fetch: authFetch });

for (const e of entries) {
  console.log(e.id, e.valid ? "OK" : e.issues.map((i) => i.code));
}
```

`followContainer` is `"auto"` by default (follow members only when the source
declares no inline `fedapp:App`); pass `true` to always follow, `false` to never.

### `selfDescribe(app)` — build a self-description

Builds an app's own `fedapp:App` graph (the
`declaresShape` / `consumes` / `produces` / `sectorUse` graph) for publication in
its Client Identifier Document. Returns the quads and a Turtle serialiser
(`n3.Writer`).

```ts
import { selfDescribe } from "@jeswr/federation-client";

const desc = selfDescribe({
  id: "https://app.example/clientid",
  sectors: ["https://w3id.org/jeswr/sectors/identity"],
  access: ["Read", "Write"],
  declaresShape: ["https://app.example/shapes/Profile#shape"],
  sectorUse: [
    {
      sector: "https://w3id.org/jeswr/sectors/health",
      access: ["Read"],
      consumes: ["https://w3id.org/jeswr/sectors/health#Observation"],
    },
  ],
});

const turtle = await desc.toString(); // text/turtle by default
```

### `discoverFromRegistry(registryUrl, options?)` — registry-asserted memberships

Consume a federation **Catalogue / Registry** (the `fedreg:` layer). Where `list`
discovers **self-asserted** `fedapp:App` registrations (which an app must NOT treat
as a membership claim), `discoverFromRegistry` reads the **registry's own**
`fedreg:Membership` assertions — each carrying a lifecycle `status` (`Proposed` /
`Active` / `Suspended` / `Revoked`) and an `assertedBy` authority. Parsing is
delegated to `@jeswr/federation-registry`'s typed `fedreg:` accessors; the registry
URL is fetched through the **SSRF guard** below.

```ts
import { discoverFromRegistry } from "@jeswr/federation-client";

const { members, valid, issues } = await discoverFromRegistry(
  "https://registry.example/federation",
  { fetch: authFetch }, // optional auth fetch; composed UNDER the SSRF guard
);

// `valid` / `issues` are DOCUMENT-level (fetch / parse / no-registry) — so a
// fetch-refused or 404'd registry is observable, not a silently-empty list.
for (const m of members) {
  if (m.trusted) {
    // `trusted` ⇔ status === "Active": a currently-live membership.
    console.log("active member:", m.id, "asserted by", m.membership.assertedBy);
  }
}
```

> Still check `assertedBy` against your own trust anchors. The registry SDK verifies
> a membership is *well-formed*; it does **not** verify the signature binding the
> assertion to that authority (that layers above this — see
> `@jeswr/federation-registry`).

### `resolveStorageSpecVersion(storageUrl, options?)` — storage spec-versions

Read a resource server's advertised client-client **spec-versions**
(`fedreg:acceptsSpec`) for schema-migration coordination: before writing data
validated against a spec version, an app asks the storage's
`fedreg:StorageDescription` whether it accepts that version, so the app and the
storage migrate on independent clocks. Exact-IRI matching (spec versions are
immutable persistent IRIs — never a prefix match). Fetched through the SSRF guard.

```ts
import { resolveStorageSpecVersion } from "@jeswr/federation-client";

const storage = await resolveStorageSpecVersion("https://alice.pod.example/", {
  fetch: authFetch,
});

if (storage.valid && storage.accepts("https://w3id.org/jeswr/sectors/scheduling#1.1.0")) {
  // safe to write 1.1.0-shaped data
}
// Which of my wanted versions does this storage NOT accept yet?
const gap = storage.unsupported([
  "https://w3id.org/jeswr/sectors/scheduling#1.1.0",
  "https://w3id.org/jeswr/sectors/scheduling#2.0.0",
]);
```

`resolveStorageSpecVersion` **fails closed**: when the description cannot be
fetched/parsed/verified, `valid` is `false`, the version list is empty, and
`accepts(...)` returns `false` for every version — an app must not write against an
unverifiable storage.

### SSRF guard — `createGuardedFetch` / `guardedFetch`

A registry / storage URL is a **user/config-supplied remote origin**, so
`discoverFromRegistry` and `resolveStorageSpecVersion` fetch it through an SSRF
guard. The guard has **two branches, selected automatically by capability detection**
(is `node:dns` importable) — never a caller flag, so a Node consumer is unaffected and a
browser / static-export consumer needs no build shim:

- **Node branch** (DNS available): an IP literal is checked directly; a hostname is
  DNS-resolved and **every** resolved A/AAAA record must be public (a DNS-rebinding
  mitigation).
- **DNS-less branch** (no `node:dns` — a browser, or an edge/worker runtime): a
  **DNS-less** guard — https-only, no userinfo, every private/loopback/link-local/metadata
  **IP literal** in the host refused, `localhost` / `*.local` / `*.localhost` **names**
  refused, and `http:` bound to loopback names only. For a public-looking hostname (which
  has no resolver to verify it) the posture depends on the runtime: in a
  **positively-identified browser** it is **allowed** (the documented residual below); in
  any **non-browser DNS-less runtime** (edge / Cloudflare Workers / Deno without node
  compat) it **fails closed** unless the caller sets `allowUnresolvedHosts` — there an
  unresolved hostname reaching private infra is a real SSRF escalation, not the benign
  browser residual.

On the initial request **and every redirect hop**, in both branches the guard:

- allows only `https:` (no `http:`, `file:`, `data:`, …) — `http:` to loopback only
  under the dev `allowLoopback` flag;
- rejects userinfo (`https://user:pass@…`) so credentials never leak to the host;
- refuses every private IP **literal** in the host — Loopback / RFC-1918 / CGNAT /
  link-local / cloud-metadata (`169.254.169.254`) / multicast / reserved /
  IPv4-mapped-IPv6 / IPv6-ULA / 6to4- and NAT64-embedded private v4 — and, on the Node
  branch, refuses a hostname any of whose resolved records is private;
- does **not** auto-follow redirects — it sets `redirect: "manual"` and re-runs the
  full guard (the **same branch**) against each `Location` (bounded hops + loop
  detection), so a `302` to an internal address is refused in both branches;
- applies standard redirect method/body rewrite: a `303` (and a `301`/`302` on a
  non-`GET`/`HEAD` method) switches to `GET` and drops the body + `Content-*` headers,
  while `307`/`308` preserve them on a same-origin hop;
- on a **cross-origin** redirect, strips credential-bearing headers (`Authorization`,
  `Cookie`, `DPoP`, …) AND drops the request body + `Content-*` headers — for any
  status, including `307`/`308` — so a hostile redirect to a different (even
  allowed-public) origin never receives the caller's credentials or a replayed POST
  body;
- preserves the final (post-redirect) URL on the returned response, so relative IRIs
  in a redirected registry/storage document resolve against the correct base;
- caps the response body (`maxBytes`, default 1 MiB) and bounds the whole operation
  (fetch + redirects + body) with a single `timeoutMs` deadline.

**Browser-safe — no `node:net` shim needed (#92).** This module imports **no `node:`
builtin at the top level**: IP-literal detection is a pure-JS classifier (matching
`node:net#isIP`, fuzzed against it), and the only `node:dns` use is a runtime-only,
bundler-opaque dynamic import reached **solely** on the Node branch. So a browser
bundler (Next.js webpack / turbopack, Vite, esbuild `platform:"browser"`) resolves and
tree-shakes the package with **no `NormalModuleReplacementPlugin` / `resolve.fallback`
shim**. (A previous top-level `import { isIP } from "node:net"` forced exactly such a
shim in the Pod Manager `/federations` build — that is no longer required.)

**DNS-less residual + the edge/worker distinction (documented honestly).** On the
DNS-less branch there is no DNS resolver and `fetch` exposes no socket, so the guard
**cannot** verify where a hostname resolves at connect time. A hostname that looks public
in the URL but resolves to a private IP (`10.x`, `169.254.169.254`, …) at connect time is
**not** caught by hostname inspection alone. How that residual is handled depends on the
runtime:

- in a **positively-identified browser** (a DOM `window` + `document`) a public-looking
  https hostname is **allowed** — the **same residual every browser app already has** (the
  page can `fetch` any origin regardless), and accepting it is the cost of needing no Node
  builtins / no shim;
- in **any other DNS-less runtime** (edge / Cloudflare Workers / Deno without node compat)
  a public-looking hostname **fails closed** unless the caller sets `allowUnresolvedHosts`
  — there, reaching private infra via an unresolved hostname is a real SSRF escalation.

In both cases the DNS-less branch still blocks the obvious vectors (non-https, userinfo,
private/loopback/metadata **literals**, `localhost`/`*.local` **names**, `http:` to a
non-loopback name) and re-validates each redirect hop. On the **Node branch** you
additionally get the full DNS-resolve + every-record-public check.

**DNS-rebinding posture (Node branch).** With plain `fetch` the default `.` guard
validates a hostname's resolved addresses but cannot pin the socket to them, so a
residual lookup→connect rebinding window remains in that default *best-effort* posture
(DNS validation + redirect re-validation + absolute literal-IP blocking still apply). A
hardened deployment sets `requireDnsPinning: true`, which **refuses a hostname target
unless a distinct `pinningFetch` is supplied** — a separate, branded option the caller
uses to attest "this fetch pins DNS". Crucially, a plain auth/custom `fetch` (the generic
`fetch` option) does **not** satisfy the strict posture — only `pinningFetch` does — so
an ordinary fetch can never silently re-open the window. IP-literal targets (no
resolution, no rebinding window) are always allowed. On the browser branch,
`requireDnsPinning` cannot be honoured (no resolver to pin), so it fails closed for a
hostname unless the caller opts into the residual via `allowUnresolvedHosts`.

**Full rebinding closure on Node — `@jeswr/federation-client/node` (#86).** The default
`.` entry deliberately ships no `undici` dependency (it would re-introduce a Node-only
dep into the browser bundle and re-break #92). Node consumers needing the rebinding
window **fully closed** import the separate **`./node`** entry, which provides a real
`undici`-backed `pinningFetch` — see [SSRF-safe Node entry](#ssrf-safe-node-entry----jeswrfederation-clientnode)
below. It pins the validated IP through to the socket `connect`, so a concurrent DNS
change cannot redirect the connection.

The guard composes **under** any `fetch` you pass (an authenticated Solid fetch is
threaded through unchanged). It is also exported directly for reuse:

```ts
import { createGuardedFetch, SsrfError } from "@jeswr/federation-client";

const guarded = createGuardedFetch({ fetch: authFetch, timeoutMs: 8000 });
// `guarded` has the standard `fetch` signature; pass it anywhere a fetch is wanted.
```

> The IP-range classification (`isPublicAddress` / `isLoopbackAddress`) is ported from
> the suite's vetted `@pss/guarded-fetch` package; the only deliberate divergence is the
> browser-safe `node:net#isIP` replacement (#92). The default `.` entry targets plain
> `fetch` (browser + Node) and does **not** pin the resolved IP into the socket (no
> `undici` dependency on the browser path), so on its Node branch a microsecond-scale
> lookup→connect DNS-rebinding window remains (the redirect re-validation and literal-IP
> blocking are absolute). **Node consumers close that window fully with the `./node`
> entry** (below); on the browser branch the residual above is inherent.

### SSRF-safe Node entry — `@jeswr/federation-client/node`

The default `.` entry stays browser-safe by shipping **no `undici` dependency**, which
leaves a residual DNS-rebinding (TOCTOU) window on its Node branch: it validates a
hostname's resolved IPs up front, but plain `fetch` **re-resolves** the name at connect
time, so a hostile DNS server can return a public IP during validation and a private one
(`169.254.169.254`, `10.x`, `127.x`, `::1`, `fc00::/7`, …) microseconds later at connect.

The **`./node`** entry closes that window completely. It is the **recommended fetch for
Node** consumers of a registry / storage / verify endpoint:

```ts
import { discoverFromRegistry } from "@jeswr/federation-client";
import { nodeGuardedFetch } from "@jeswr/federation-client/node";

const result = await discoverFromRegistry(registryUrl, { fetch: nodeGuardedFetch });
```

`createNodeGuardedFetch(options)` returns the same thing with tunable
`maxBytes` / `timeoutMs` / `maxRedirects` / `allowLoopback` (and an optional private-CA
`ca`). How it closes the window — **resolve-once → validate-all → pin the IP to
`connect`**:

- it builds an `undici.Agent` whose `connect.lookup` resolves the hostname **once**
  (`dns.lookup(host, { all: true })`) and validates **every** A/AAAA record against the
  **same blocklist** the rest of the library uses (`isPublicAddress` — RFC1918, loopback,
  link-local incl. cloud-metadata `169.254.169.254`, CGNAT, ULA `fc00::/7`, `::1`,
  `0.0.0.0`, multicast, reserved, IPv4-mapped / 6to4 / NAT64-embedded private v4). **One**
  private record fails the whole connection (a rebinding set is refused);
- it then hands undici back **only** the pre-validated address(es); `net.connect` dials
  exactly those IPs and **never re-resolves** the name — the socket is **pinned** to the
  validated IP, so a concurrent DNS change cannot redirect it;
- **TLS SNI + certificate validation stay against the original hostname** (undici's
  connector sets `servername` to the request host; the cert is verified against that name,
  not the pinned IP). Validation is never disabled — a private-CA `ca` may be supplied, but
  there is no `rejectUnauthorized: false` escape hatch;
- it composes **under** the shared guard with `requireDnsPinning: true` and supplies the
  undici fetch as the branded `pinningFetch`, so the scheme/userinfo/IP-literal checks,
  redirect re-validation (no auto-follow to a private host), and body + time caps all
  apply — and **each redirect hop independently re-resolves, re-validates and re-pins** (a
  30x to a private IP, literal or rebinding hostname, is blocked at the next hop).

`./node` is the **only** artifact that imports `undici` / `node:*` builtins, so the
browser bundle (#92) is unaffected — a browser consumer never imports it.
`createPinningDispatcher(options)` is also exported for callers composing their own undici
pipeline (use it only if you already apply the URL/redirect/body checks yourself).

### Vocabulary helpers

```ts
import {
  FEDAPP,                 // "https://w3id.org/jeswr/fed#"
  ACL_MODES,              // { Read, Write, Append, Control } → acl: IRIs
  accessModeName,         // acl: IRI → "Read" | … | undefined
  sectorIri,              // slug → "https://w3id.org/jeswr/sectors/<slug>"
  KNOWN_SECTOR_SLUGS,
  VALID_ACCESS_MODE_IRIS,
} from "@jeswr/federation-client";
```

## RDF discipline

This SDK follows the suite's non-negotiable RDF rules: **parse** with
[`@jeswr/fetch-rdf`](https://github.com/jeswr/fetch-rdf), **extract** with
[`@rdfjs/wrapper`](https://www.npmjs.com/package/@rdfjs/wrapper) /
[`@solid/object`](https://www.npmjs.com/package/@solid/object) typed accessors,
**serialise** with `n3.Writer`. There is no bespoke RDF parser, and no
hand-built / hand-concatenated triples — all reads and writes go through the
typed wrappers in [`src/wrappers.ts`](./src/wrappers.ts).

## Linked-Data-API conventions

`verify` and `list` negotiate `text/turtle, application/ld+json;q=0.9` on every
fetch (the `@jeswr/fetch-rdf` default — the two RDF media types the Solid
Protocol requires). `list` follows `ldp:contains` to enumerate an LDP container.

## Development

```sh
npm install
npm run lint        # biome
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # esbuild: bundle src/ (+ inline @jeswr/fetch-rdf) → dist/index.js; tsc → dist/*.d.ts
npm run check:dist  # fail if committed dist/ has drifted from src/
npm run check:lockfile-transport  # fail if package-lock.json uses an SSH git transport
```

`npm run build` produces the **committed, self-contained `dist/`** (esbuild inlines
the off-npm `@jeswr/fetch-rdf`, keeps every npm-published dep external; tsc emits the
`.d.ts`). After any change to `src/`, run `npm run build` and commit the regenerated
`dist/` — `npm run check:dist` enforces that the artifact matches the source.

`npm run check:lockfile-transport` is a recurrence guard for the `#78` bug class:
`npm install` silently rewrites the `@jeswr` `github:` dependency `resolved` URLs in
`package-lock.json` back to the SSH transport (`git+ssh://git@github.com/…`), which
needs an SSH key and so breaks `npm ci` in CI / Vercel / any fresh checkout. The
github pins are kept on the HTTPS transport (`git+https://github.com/…#<sha>`); this
gate fails if a stray `npm install` re-introduces an SSH transport. Run it (and
re-pin to HTTPS, preserving `#<sha>`) before committing any lockfile change — never
hand-run `npm install` to "fix" it.

## License

MIT — Jesse Wright.
