# solid-federation-vocab

> ⚠️ Experimental — AI-agent-generated (Claude Opus 4.8, @jeswr PSS agent); under active development, not production-hardened.

The federation vocabularies for the [@jeswr](https://github.com/jeswr) Solid app
suite, served under the persistent namespace **`https://w3id.org/jeswr/`**
(decided in `prod-solid-server` ADR-0013). Two vocabularies live here:

| Namespace | Prefix | What it is |
|---|---|---|
| `https://w3id.org/jeswr/fed#` | `fedapp:` | **App-registration** metadata an app publishes in its Client Identifier Document (OpenID-Federation-style): the sectors it operates in, the WAC/ACP access modes it requests, and the shared shapes it consumes / produces. |
| `https://w3id.org/jeswr/fedreg#` | `fedreg:` | **Federation Catalogue / Registry** — the discovery axis. A `fedreg:Registry` (a `dcat:Catalog`) listing member apps with a **registry-asserted** `fedreg:Membership` (lifecycle status + `assertedBy` authority — distinct from the app's self-asserted `fedapp:App`), and a `fedreg:StorageDescription` advertising **which client-client spec-versions a resource server accepts** (`acceptsSpec`) and which sectors it supports — the substrate for asynchronous schema migration. Consumed by [`@jeswr/federation-registry`](https://github.com/jeswr/federation-registry). |
| `https://w3id.org/jeswr/task#` | `tm:` | The **shared cross-app task / issue model** — the canonical, dereferenceable re-use of the W3C workflow ontology (`wf:`), Dublin Core Terms (`dct:`) and ActivityStreams 2.0 (`as:`) every suite app reads/writes for tasks and issues. |
| `https://w3id.org/jeswr/core#` | `core:` | The **gUFO-based Solid Core** — the foundational ontology every sector imports and constrains-but-never-forks. Every cross-sector root (Agent, Account, Identifier, Record, Relationship, Quantity, …) carries a gUFO meta-type (Kind / Relator / Role(Mixin) / Phase / EventType / …). |
| `https://w3id.org/jeswr/sectors/<sector>#` | per-sector | The **sector ontologies** (`identity`, `finance`, `health`, `media`, `scheduling`, `contacts`) — the domain models a `fedapp:sector` references. Each imports `core:` and reuses real vocabularies (see below). |

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
  it; use when per-sector access differs. Attached to an app with
  **`fedapp:sectorUse`**.
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

## The `fedreg:` vocabulary (Catalogue / Registry)

The **discovery axis** of a Solid data federation — one of the five federation
services (R9 §2.2 / research brief 09 in `full-solid-ecosystem`). It answers two
questions the self-asserted `fedapp:` layer cannot:

1. **Who is actually a member?** A **`fedreg:Registry`** (a `dcat:Catalog`) lists
   apps via **`fedreg:Membership`** records (`dcat:CatalogRecord`s). A Membership
   is the **registry's own** assertion — `fedreg:app` (the client_id),
   `fedreg:status` (one of the coded values **`fedreg:Proposed` / `Active` /
   `Suspended` / `Revoked`**), `fedreg:assertedBy` (the WebID / key of the
   authority vouching for it) and `fedreg:asserted` (timestamp). This is the
   load-bearing distinction the `fedapp:` vocab itself flags: *membership is the
   registry's job after a signed challenge — a registry MUST NOT trust a
   self-asserted membership claim*. `Suspended` / `Revoked` are the federation's
   **recovery** lever.
2. **Which storage accepts which spec-version?** A **`fedreg:StorageDescription`**
   advertises **`fedreg:acceptsSpec`** (the persistent, immutable client-client
   spec-version IRIs a resource server currently accepts) and
   **`fedreg:supportsSector`** (the sectors it holds). This realises the
   **decoupling** principle (each storage decides which specs it supports) and is
   the substrate for **asynchronous schema migration**: during a dual-read window
   a storage advertises both the old and new version, so apps, pods and RS upgrade
   on their own clock — an app discovers acceptable versions here, never by
   assumption.

`fedreg:` reuses **DCAT** (`dcat:Catalog` / `dcat:CatalogRecord`, `fedreg:member
⊑ dcat:record`) and Dublin Core Terms for the catalogue spine rather than minting
parallel terms (the LD/SW "reuse, don't reinvent" rule). The typed TS client is
[`@jeswr/federation-registry`](https://github.com/jeswr/federation-registry):
`buildRegistry` / `parseRegistry` / `verifyMembership` and `describeStorage` /
`parseStorage` / `acceptsSpec`.

JSON-LD `@context`: [`fedreg-context.jsonld`](./fedreg-context.jsonld).

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

## The Solid Core + sector ontologies (`core:` + `sectors/<sector>#`)

The domain models a `fedapp:sector` references. They live under `sectors/` and
are served from `docs/core.*` and `docs/sectors/*`.

**`core:` — the gUFO-based Solid Core** (`sectors/core/core.ttl`). Re-based onto
[gUFO](https://nemo-ufes.github.io/gufo/) (the gentle OWL-2-DL UFO): every
cross-sector root carries a gUFO meta-type — `core:Agent` is a `gufo:Category`;
`core:Account`/`core:Relationship` are `gufo:Relator`; roles
(`core:AccountHolder`, `core:DataSubject`, …) are `gufo:RoleMixin`; status /
life-stage enums (`core:ActiveAccount`, `core:Minor`, …) are `gufo:Phase`;
activities/events are `gufo:EventType`. This carries real ontological force
(rigid-vs-anti-rigid discipline, reified relators, role/phase separation) so
independently-authored sectors stay non-overlapping. Imports gUFO; reaches
external vocabularies (PROV/FOAF/Org/vCard/schema.org/gist) only via the optional
`core-alignments.ttl`.

**The six sectors** — each `rdfs:subClassOf`-roots every class in a `core:` class,
carries its own gUFO meta-type, **constrains but never forks** the Core, and
reuses a real domain vocabulary:

| Sector | Prefix | gUFO highlights | External reuse |
|---|---|---|---|
| `sectors/identity#` | `id:` | NaturalPerson SubKind; VerifiableAttribute; HL7 Gender-Harmony five slots | eIDAS PID, ISO 3166, vCard, schema:Person |
| `sectors/finance#` | `fin:` | Account=Relator(+Phase status); Transaction=Event; Counterparty=RoleMixin | FIBO (version-pinned slim MIREOT), ISO 4217/20022 |
| `sectors/health#` | `health:` | Patient=RoleMixin of Person; Observation=Record+Quantity; record-vs-act split | FHIR (Mode A, no fhir.ttl), SNOMED CT/LOINC, QUDT/UCUM units |
| `sectors/media#` | `media:` | CreativeWork=InformationResource+Asset; Artist=RoleMixin; PlaybackEvent | schema.org CreativeWork/MusicRecording, ODRL |
| `sectors/scheduling#` | `sched:` | CalendarEvent=Event; Attendance=Relator mediating an Attendee role; RSVP coded values | iCalendar RFC 5545, schema.org, OWL-Time |
| `sectors/contacts#` | `contact:` | Contact=Record about an agent; ContactPoint=Identifier; ContactRelationship=Relator | vCard, schema:ContactPoint/PostalAddress |

Each sector declares a `…/sectors/<sector>#sector` marker (a `skos:Concept`) —
that is the IRI an app names in `fedapp:sector`.

Each ontology ships a **SHACL profile** (`<x>.shacl.ttl`, the closed-world
MUST/SHOULD contract; the ontology is open-world) and a **Mode-A alignments file**
(`<x>-alignments.ttl`, the auditable `skos:*Match` / `owl:equivalent*` bridge to
external vocabularies, kept out of the reasoned closure). The whole stack passes a
consistency gate: `npm run ontology` parses every Turtle with n3, checks every
named term carries a label + definition, and — when ROBOT/HermiT is available —
reasons each ontology over its `owl:imports` closure (resolved offline via the
per-dir `catalog-v001.xml`) for **zero unsatisfiable classes**.

> **Provenance + scope.** These ontologies were modelled as OntoUML and
> transformed to gUFO-OWL upstream in
> [`full-solid-ecosystem`](https://github.com/jeswr/full-solid-ecosystem)'s
> federation tree, then **re-namespaced** here from the upstream placeholder IRIs
> to the persistent `https://w3id.org/jeswr/` home. Re-sync with
> `node scripts/import-sectors.mjs <federation/ontologies path>`. Four further
> sectors (work / mobility / documents / social) are **not yet authored** — a
> separate decision.

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
  "sector": "https://w3id.org/jeswr/sectors/scheduling#sector",
  "access": ["Read", "Write", "Append"],
  "produces": ["http://www.w3.org/2005/01/wf/flow#Task"],
  "consumes": ["http://www.w3.org/2005/01/wf/flow#Task"]
}
```

In Turtle the same block is:

```turtle
@prefix fedapp: <https://w3id.org/jeswr/fed#> .
@prefix acl:    <http://www.w3.org/ns/auth/acl#> .
@prefix wf:     <http://www.w3.org/2005/01/wf/flow#> .

<https://app.example/clientid.jsonld>
    a fedapp:App ;
    fedapp:sector <https://w3id.org/jeswr/sectors/scheduling#sector> ;
    fedapp:access acl:Read, acl:Write, acl:Append ;
    fedapp:produces wf:Task ;
    fedapp:consumes wf:Task .
```

For per-sector access, attach an `fedapp:SectorUse` via `fedapp:sectorUse`:

```turtle
<https://app.example/clientid.jsonld>
    a fedapp:App ;
    fedapp:sectorUse [
        a fedapp:SectorUse ;
        fedapp:sector <https://w3id.org/jeswr/sectors/health#sector> ;
        fedapp:access acl:Read
    ] .
```

## Content negotiation

The w3id redirect serves the right representation by `Accept`:

| `Accept` | Served |
|---|---|
| `text/turtle` | the `.ttl` (`fed.ttl` / `fedreg.ttl` / `task.ttl` / `core.ttl` / `sectors/<x>.ttl`) |
| `application/ld+json` | the `.jsonld` context (`context.jsonld` / `fedreg-context.jsonld` / `<slug>-context.jsonld`) |
| `text/html` (browsers) | the human-readable HTML page (`fed.html` / `fedreg.html` / `task.html` / `core.html` / `sectors/<x>.html`) |

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

# --- fedreg (fedreg: — Catalogue / Registry) ---
RewriteCond %{HTTP_ACCEPT} text/turtle [OR]
RewriteCond %{HTTP_ACCEPT} application/x-turtle
RewriteRule ^fedreg$ https://jeswr.github.io/solid-federation-vocab/fedreg.ttl [R=302,L]
RewriteCond %{HTTP_ACCEPT} application/ld\+json [OR]
RewriteCond %{HTTP_ACCEPT} application/json
RewriteRule ^fedreg$ https://jeswr.github.io/solid-federation-vocab/fedreg-context.jsonld [R=302,L]
RewriteRule ^fedreg$ https://jeswr.github.io/solid-federation-vocab/fedreg.html [R=302,L]

# --- task (shared task/issue model) ---
RewriteCond %{HTTP_ACCEPT} text/turtle [OR]
RewriteCond %{HTTP_ACCEPT} application/x-turtle
RewriteRule ^task$ https://jeswr.github.io/solid-federation-vocab/task.ttl [R=302,L]
RewriteCond %{HTTP_ACCEPT} application/ld\+json [OR]
RewriteCond %{HTTP_ACCEPT} application/json
RewriteRule ^task$ https://jeswr.github.io/solid-federation-vocab/task-context.jsonld [R=302,L]
RewriteRule ^task$ https://jeswr.github.io/solid-federation-vocab/task.html [R=302,L]

# --- core (the gUFO Solid Core) ---
RewriteCond %{HTTP_ACCEPT} text/turtle [OR]
RewriteCond %{HTTP_ACCEPT} application/x-turtle
RewriteRule ^core$ https://jeswr.github.io/solid-federation-vocab/core.ttl [R=302,L]
RewriteCond %{HTTP_ACCEPT} application/ld\+json [OR]
RewriteCond %{HTTP_ACCEPT} application/json
RewriteRule ^core$ https://jeswr.github.io/solid-federation-vocab/core-context.jsonld [R=302,L]
RewriteRule ^core$ https://jeswr.github.io/solid-federation-vocab/core.html [R=302,L]

# --- sectors/<sector> (the 6 sector ontologies; $1 = identity|finance|… ) ---
RewriteCond %{HTTP_ACCEPT} text/turtle [OR]
RewriteCond %{HTTP_ACCEPT} application/x-turtle
RewriteRule ^sectors/([a-z]+)$ https://jeswr.github.io/solid-federation-vocab/sectors/$1.ttl [R=302,L]
RewriteCond %{HTTP_ACCEPT} application/ld\+json [OR]
RewriteCond %{HTTP_ACCEPT} application/json
RewriteRule ^sectors/([a-z]+)$ https://jeswr.github.io/solid-federation-vocab/sectors/$1-context.jsonld [R=302,L]
RewriteRule ^sectors/([a-z]+)$ https://jeswr.github.io/solid-federation-vocab/sectors/$1.html [R=302,L]

# --- default: the index ---
RewriteRule ^$ https://jeswr.github.io/solid-federation-vocab/ [R=302,L]
RewriteRule ^(.+)$ https://jeswr.github.io/solid-federation-vocab/$1 [R=302,L]
```

> Note: w3id serves a 302 to the Pages target; the fragment (`#App`, `#Task`,
> `#Person`, `#sector`, …) is retained by the client. The `RewriteRule` rows are
> evaluated top-down, so the conneg `RewriteCond` rows must precede the HTML
> fallback for each path, and the more specific `core` / `sectors/<x>` rules must
> precede the catch-all `^(.+)$` row.

## Develop & gate

```bash
npm install
npm run gate    # lint + typecheck + test (n3 parse + jsonld expand) + ontology + build
```

The gate, in order:

- **`lint`** — every `.ttl` / `.mjs` carries the `AUTHORED-BY` marker, the JSON-LD
  contexts are valid JSON, the required files exist.
- **`typecheck`** — `node --check` on every script.
- **`test`** (`validate.mjs`) — parses the root vocabs (`fed.ttl` / `task.ttl`)
  with **n3** (well-formedness + `rdfs:label`/`rdfs:comment`/`rdfs:isDefinedBy`
  per term) and expands the `@context`s with **jsonld**.
- **`ontology`** (`ontology-gate.mjs`) — for the Core + 6 sectors: n3
  well-formedness, term hygiene (`rdfs:label`|`skos:prefLabel` + a definition per
  named term), and — when ROBOT/HermiT is discoverable — a **reasoner-consistency
  pass** (`robot reason --reasoner HermiT` over each `owl:imports` closure, 0
  unsatisfiable classes). It **fail-softs** (SKIP, not fail) when Java/ROBOT is
  absent so CI is not blocked on a host-capability gap; set
  `PSS_ONTOLOGY_REASON=required` (or `SOLIDFED_ROBOT_JAR=/path/to/robot.jar`) to
  enforce / run the real pass.
- **`build`** — re-serialises the root vocabs through **`n3.Writer`** to
  `dist/vocab.nt` and regenerates `docs/` (the served `.ttl` + the derived HTML +
  JSON-LD contexts for every vocab and ontology).

RDF goes through `@jeswr/fetch-rdf` / `@solid/object` / `@rdfjs/wrapper` / `n3`
only, never a bespoke parser/serialiser (suite house rule). The `.ttl` source
files are authored as Turtle directly.

## Provenance

Authored by **Claude Opus 4.8** (Fable unavailable) — re-review/upgrade
candidate. Commits carry `Model: claude-opus-4-8` trailers; source files carry an
`AUTHORED-BY` marker.
