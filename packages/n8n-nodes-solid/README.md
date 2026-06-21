# n8n-nodes-solid

An [n8n](https://n8n.io) **community node** that reads and writes a
[Solid](https://solidproject.org) pod over LDP from inside your automation
workflows. Store n8n data in a user's pod, or drive a workflow off pod contents —
the user owns the data, you own the automation.

> Experimental, AI-agent-generated. Part of the `@jeswr` Solid suite. Under
> active development — not a supported production service.

## What it does

A single **Solid** node with two resources and five operations, all confined to a
configured pod base:

| Resource  | Operation | LDP verb | Notes |
|-----------|-----------|----------|-------|
| Resource  | Read      | `GET`    | Returns the resource body, `Content-Type`, and `ETag`. |
| Resource  | Create    | `PUT` + `If-None-Match: *` | Fails (412) if the resource already exists — never silently overwrites. |
| Resource  | Update    | `PUT`    | Creates or overwrites. Optional `If-Match` ETag for a lost-update-safe conditional write. |
| Resource  | Delete    | `DELETE` | A missing resource (404) is reported, not thrown. |
| Container | List      | `GET`    | Parses the container's `ldp:contains` membership and emits one item per member (`url`, `name`, `container`). |

The container listing is parsed with [`@jeswr/fetch-rdf`](https://github.com/jeswr/fetch-rdf)
(`parseRdf`) and [`@solid/object`](https://www.npmjs.com/package/@solid/object)
(`ContainerDataset`) — Turtle and JSON-LD are both understood. The node never
hand-parses RDF.

## Install

This is an n8n **community node**.

- **n8n UI:** Settings → Community Nodes → Install → enter `n8n-nodes-solid`
  *(npm publish is pending — see "Status" below; until then use the GitHub install).*
- **GitHub install (works today):** in your n8n custom-nodes directory,

  ```sh
  npm install github:jeswr/n8n-nodes-solid#main
  ```

  The package commits a **self-contained `dist/`** (the off-npm `@jeswr/fetch-rdf`
  dependency is bundled in by esbuild), so it loads under `ignore-scripts=true`
  with **no build step** — exactly what n8n's community-node loader needs.

## Credentials — `Solid Pod (OIDC / Bearer) API`

P1 stores:

- **Pod Base URL** — e.g. `https://alice.pod.example/` (or a sub-container). Every
  read and write is confined to URLs under this base.
- **Access Token** — a Solid-OIDC / bearer access token authorized for the pod. It
  is **masked** in the UI and injected by n8n as an `Authorization: Bearer …`
  header. The node's own code **never reads the token**, so it cannot be logged or
  leaked by node logic.

### Why a bearer access token in P1 (and the DPoP follow-up)

A plain bearer access token is the simplest credential n8n's model can hold and
inject, and it works against any Solid server that accepts a bearer access token
on the resource (RFC 6750). This is the right P1 scope.

**Full DPoP-bound Solid-OIDC is a documented follow-up, not a P1 gap.** DPoP
([RFC 9449](https://datatracker.ietf.org/doc/html/rfc9449)) requires a *fresh,
per-request* signed proof bound to the exact method + URL (+ access-token hash),
which n8n's declarative `authenticate` credential model (static header templating)
cannot express. The seam for it is a future **programmatic credential** composing
[`@jeswr/solid-dpop`](https://github.com/jeswr/solid-dpop) +
[`@jeswr/solid-openid-client`](https://github.com/jeswr/solid-openid-client) to
(a) exchange a stored refresh token for a short-lived access token and (b) compute
the DPoP proof per request inside the node. Tracked as an open design item.

## Usage

1. Add **Solid** credentials (pod base URL + access token).
2. Drop the **Solid** node into a workflow, pick a Resource + Operation, and set
   the **Target**.

**Target** is either an absolute `http(s)` URL under the pod base, or a path
**relative to the pod base** — e.g. with base `https://alice.pod.example/` a target
of `notes/today.ttl` writes/reads `https://alice.pod.example/notes/today.ttl`.

For **Create/Update** you also supply **Content** + **Content Type** (default
`text/turtle`). For **Update** an optional **If-Match ETag** (from a prior Read)
gives a conditional, lost-update-safe write.

## Safety / scope guard

The node is built so a buggy or hostile workflow input can never make it touch
data outside the configured pod:

- Every target is resolved and **re-validated to be the pod base itself or a
  strict descendant** (same origin, path-prefixed by the base) — fail-closed. A
  `..` traversal, an absolute URL on another origin, a same-origin-but-out-of-base
  path, or a scheme-relative `//host` reference is **refused before any request is
  issued**.
- **`http(s)` only** — any other scheme (`file:`, `data:`, …) is rejected (an
  SSRF / scheme-confusion guard).
- The **access token is never read by node code** (n8n injects it as a header), so
  it is never logged.
- The only RDF the node parses is the **container listing**; resource values are
  treated as opaque bytes/text.

## Design decisions

- **Programmatic node** (implements `execute`), not declarative: the Container →
  List operation must parse the RDF `ldp:contains` listing, and the write
  operations need conditional-request + scope-guard logic the declarative routing
  model can't express.
- **Transport via `httpRequestWithAuthentication`** (n8n's helper) — n8n owns the
  HTTP and the credential injection; the node does not run a bespoke fetch.
- **Create uses `If-None-Match: *`** so it is a true create, never a silent
  overwrite; Update is the overwrite path.
- **Container List emits one item per member**, the n8n-idiomatic shape for
  downstream iteration, each with `pairedItem` linkage to the source item.

See the design discussion issue on the repo for the rationale + open questions.

## Status

- GitHub-installable now (committed self-contained `dist/`).
- **npm publish is deferred** (a `needs:user` maintainer step). n8n community nodes
  are normally installed from npm by the `n8n-nodes-` package name; that prefix is
  the reason this package is **unscoped** (see below).

## Package name note

This package is named **`n8n-nodes-solid`** — **unscoped**, not `@jeswr/…`. The
rest of the suite uses the `@jeswr/` scope, but n8n's community-node loader
**requires** the `n8n-nodes-` name prefix to discover and load a community node, so
this is the one sanctioned exception to the suite namespace rule.

## Development

```sh
npm install          # installs deps (rewrites the lockfile @jeswr github: dep to https — see below)
npm run build:deps   # build the off-npm @jeswr/fetch-rdf dist into node_modules (ignore-scripts skips its prepare)
npm run lint         # Biome + lockfile-transport guard
npm run typecheck    # tsc --noEmit
npm test             # vitest
npm run build        # esbuild bundle (fetch-rdf inlined) + tsc .d.ts -> committed dist/
npm run check:dist   # fails if committed dist/ drifts from source
```

Rebuild and **commit `dist/`** alongside any `src/`/`nodes/`/`credentials/` change
— `check:dist` guards the drift.

## License

MIT © Jesse Wright
