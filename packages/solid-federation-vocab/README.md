# solid-federation-vocab

> ⚠️ Experimental — AI-agent-generated (Claude Opus 4.8, @jeswr PSS agent); under active development, not production-hardened.

The federation vocabularies for the [@jeswr](https://github.com/jeswr) Solid app
suite, served under the persistent namespace **`https://w3id.org/jeswr/`**
(decided in `prod-solid-server` ADR-0013). Two vocabularies live here:

| Namespace | Prefix | What it is |
|---|---|---|
| `https://w3id.org/jeswr/fed#` | `fedapp:` | **App-registration** metadata an app publishes in its Client Identifier Document (OpenID-Federation-style): the sectors it operates in, the WAC/ACP access modes it requests, and the shared shapes it consumes / produces. |
| `https://w3id.org/jeswr/task#` | `tm:` | The **shared cross-app task / issue model** — the canonical, dereferenceable re-use of the W3C workflow ontology (`wf:`), Dublin Core Terms (`dct:`) and ActivityStreams 2.0 (`as:`) every suite app reads/writes for tasks and issues. |

The IRIs resolve via a permanent `w3id.org` redirect to a GitHub Pages target
under this repo (`docs/`), so they survive a host move and stay under `@jeswr`
(not `solidproject.org`, which would require a CG adoption first).

## The `fedapp:` vocabulary

The OpenID-Federation-style metadata block an app embeds in its
[Client Identifier Document](https://solidproject.org/TR/oidc#clientids). Terms
(`fedapp.ttl` → served as `fed.ttl`):

- **`fedapp:App`** — a federated client app; the subject is usually the app's
  `client_id` IRI.
- **`fedapp:AppVersion`** — a specific released version (track behavioural change
  across releases of one `client_id`).
- **`fedapp:SectorUse`** — a reified per-sector use bundling a `fedapp:sector`
  with the `fedapp:access` modes (+ optionally `consumes`/`produces`) scoped to
  it; use when per-sector access differs.
- **`fedapp:sector`** — the data sector an app operates in (the
  `https://w3id.org/jeswr/sectors/<sector>#` IRIs).
- **`fedapp:access`** — a WAC/ACP access mode requested (`acl:Read` / `acl:Write`
  / `acl:Append` / rarely `acl:Control`).
- **`fedapp:consumes`** — a shared shape the app **reads**.
- **`fedapp:produces`** — a shared shape the app **writes**.
- **`fedapp:declaresShape`** — a SHACL node shape the app authors as the
  canonical definition of a shared model.

`fedapp:` metadata is **self-asserted**. A registry must **not** trust a
membership claim from it — membership is established by the registry after a
signed challenge. The vocabulary only describes the app's intended footprint so
a user / registry can reason about it before granting consent.

## The shared task / issue model (`tm:`)

Not new terms — the **agreed re-use** that `solid-issues` and Pod Manager already
write:

- A task is **`wf:Task`** (the SolidOS issue-pane class).
- State is **`rdf:type wf:Open`** / **`rdf:type wf:Closed`** — a type, never a
  literal `wf:state`.
- Metadata is `dct:title` / `dct:description` / `dct:created` (`xsd:dateTime`) /
  `dct:creator`; relations via `dct:relation` / `dct:references` / `dct:isPartOf`.
- Assignment is **`wf:assignee`** (a WebID) — the property that drives the
  cross-app "tasks assigned to me" federation query.
- Cross-app updates are announced with **`as:Announce`** (ActivityStreams 2.0)
  POSTed to a peer's inbox.

JSON-LD `@context`s:
[`context.jsonld`](./context.jsonld) (fedapp + task) and
[`task-context.jsonld`](./task-context.jsonld) (task only).

## How an app references the vocabulary in its Client-ID document

An app's static `clientid.jsonld` (served at its `client_id` URL) imports the
context and adds the `fedapp:` block alongside the standard Solid-OIDC client
metadata:

```jsonc
{
  "@context": [
    "https://www.w3.org/ns/solid/oidc-context.jsonld",
    "https://w3id.org/jeswr/fed"
  ],
  "client_id": "https://app.example/clientid.jsonld",
  "client_name": "Example Pod App",
  "redirect_uris": ["https://app.example/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_method": "none",

  "type": "App",
  "sector": "https://w3id.org/jeswr/sectors/productivity#sector",
  "access": ["Read", "Write", "Append"],
  "produces": ["https://w3id.org/jeswr/task#Task"],
  "consumes": ["https://w3id.org/jeswr/task#Task"]
}
```

In Turtle the same block is:

```turtle
@prefix fedapp: <https://w3id.org/jeswr/fed#> .
@prefix acl:    <http://www.w3.org/ns/auth/acl#> .

<https://app.example/clientid.jsonld>
    a fedapp:App ;
    fedapp:sector <https://w3id.org/jeswr/sectors/productivity#sector> ;
    fedapp:access acl:Read, acl:Write, acl:Append ;
    fedapp:produces <https://w3id.org/jeswr/task#Task> ;
    fedapp:consumes <https://w3id.org/jeswr/task#Task> .
```

## Content negotiation

The w3id redirect serves the right representation by `Accept`:

| `Accept` | Served |
|---|---|
| `text/turtle` | the `.ttl` (`fed.ttl` / `task.ttl`) |
| `application/ld+json` | the `.jsonld` context |
| `text/html` (browsers) | the human-readable HTML page (`fed.html` / `task.html`) |

## GitHub Pages

`docs/` is the Pages root (`.nojekyll` so `.ttl`/`.jsonld` are served verbatim).
Enable Pages on this repo with **source = `main` / `docs`**. The build
(`npm run build`) regenerates `docs/` from the source `.ttl`/`.jsonld` and emits
a round-tripped `dist/vocab.nt` via `n3.Writer`.

## w3id.org redirect — `.htaccess` block (maintainer to submit)

To make the IRIs resolve, a redirect must be added under
[`w3id/w3id.org`](https://github.com/perma-id/w3id.org) at `jeswr/.htaccess`.
**The PSS agent does not open that PR** — the maintainer (@jeswr) submits it.
Proposed block (conneg per the LD-API conventions):

```apache
# https://w3id.org/jeswr/  →  jeswr.github.io/solid-federation-vocab/
# Federation vocabularies (fedapp:, shared task/issue model). See
# github.com/jeswr/solid-federation-vocab.
RewriteEngine On

# --- fed (fedapp:) ---
RewriteCond %{HTTP_ACCEPT} text/turtle [OR]
RewriteCond %{HTTP_ACCEPT} application/x-turtle
RewriteRule ^fed$ https://jeswr.github.io/solid-federation-vocab/fed.ttl [R=302,L]
RewriteCond %{HTTP_ACCEPT} application/ld\+json [OR]
RewriteCond %{HTTP_ACCEPT} application/json
RewriteRule ^fed$ https://jeswr.github.io/solid-federation-vocab/context.jsonld [R=302,L]
RewriteRule ^fed$ https://jeswr.github.io/solid-federation-vocab/fed.html [R=302,L]

# --- task (shared task/issue model) ---
RewriteCond %{HTTP_ACCEPT} text/turtle [OR]
RewriteCond %{HTTP_ACCEPT} application/x-turtle
RewriteRule ^task$ https://jeswr.github.io/solid-federation-vocab/task.ttl [R=302,L]
RewriteCond %{HTTP_ACCEPT} application/ld\+json [OR]
RewriteCond %{HTTP_ACCEPT} application/json
RewriteRule ^task$ https://jeswr.github.io/solid-federation-vocab/task-context.jsonld [R=302,L]
RewriteRule ^task$ https://jeswr.github.io/solid-federation-vocab/task.html [R=302,L]

# --- default: the index ---
RewriteRule ^$ https://jeswr.github.io/solid-federation-vocab/ [R=302,L]
RewriteRule ^(.+)$ https://jeswr.github.io/solid-federation-vocab/$1 [R=302,L]
```

> Note: w3id serves a 302 to the Pages target; the fragment (`#App`, `#Task`) is
> retained by the client. The `RewriteRule` rows are evaluated top-down, so the
> conneg `RewriteCond` rows must precede the HTML fallback for each path.

## Develop & gate

```bash
npm install
npm run gate    # lint + typecheck + test (n3 parse + jsonld expand) + build
```

The gate parses every `.ttl` with **n3** (well-formedness + required
`rdfs:label`/`rdfs:comment`/`rdfs:isDefinedBy` on each term), expands every
`@context` with **jsonld**, and re-serialises the merged graph through
**`n3.Writer`** — RDF goes through `@jeswr/fetch-rdf` / `@solid/object` /
`@rdfjs/wrapper` / `n3` only, never a bespoke parser/serialiser (suite house
rule). The `.ttl` source files are authored as Turtle directly.

## Provenance

Authored by **Claude Opus 4.8** (Fable unavailable) — re-review/upgrade
candidate. Commits carry `Model: claude-opus-4-8` trailers; source files carry an
`AUTHORED-BY` marker.
