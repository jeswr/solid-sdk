# Data modelling — FAIR vocabularies for Solid apps

For an AI agent (or human) writing the RDF data model of a Solid application. House rule:
**reuse a published term before you mint one, and never mint a term at an address that does not
resolve.** Assumes RDF is produced through the object-mapper stack (`@solid/object` +
`@rdfjs/wrapper`, fetch+parse via `@jeswr/fetch-rdf`) — this document is about *which IRIs go in
the data*, not serialisation.

## 1. Interoperate with deployed apps first

For data that existing Solid apps commonly read and write — profiles, **preferences**, contacts,
chat, bookmarks — the right model is the one already deployed, not the one you would design:

- Survey what is out there: [solidproject.org/apps](https://solidproject.org/apps) lists 40+
  Solid apps by category.
- Reuse the domain shapes in the [Solid SHACL Shapes Catalogue](https://github.com/solid/shapes)
  — `chat.ttl`, `bookmark.ttl`, `address_book.ttl`, `person.ttl`, `event.ttl`, `meeting.ttl`,
  `issue_tracker.ttl`, … — before authoring your own.
- Domain specifications exist for some functionality — e.g. the
  [chat client-to-client specification](https://github.com/solid/chat); follow them so your
  feature interoperates with the ecosystem's existing apps (document *layout* guidance is in the
  `solid-scale-and-sharding` skill).

## 2. Discovery tooling you can call at development time

| Tool | Use it for | Programmatic entry point | Status (2026-06-05) |
|---|---|---|---|
| [prefix.cc](https://prefix.cc/) | prefix ↔ namespace IRI resolution | `GET https://prefix.cc/{prefix}.file.json` | Working |
| [LOV](https://lov.linkeddata.es/) data dump | "does a term for X exist + who uses it" — cross-vocabulary index | `GET https://lov.linkeddata.es/lov.n3.gz` (~757 KB Turtle, weekly refresh) | Working |
| LOV web UI | human term/vocabulary search with usage stats | `https://lov.linkeddata.es/` → Terms / Vocabs | Working (browser only) |
| LOV REST API | scripted term search | `…/dataset/lov/api/v2/term/search?q=…` | **Down — 404 on all `/api/v2/*` + SPARQL. Use the dump.** |
| [Schema.org](https://schema.org/) | broad SEO-backed vocabulary, machine-readable model | `GET https://schema.org/version/latest/schemaorg-current-https.jsonld` (or `.ttl`) | Working |
| [BARTOC](https://bartoc.org/) | controlled vocabularies / SKOS concept schemes | `GET https://bartoc.org/api/voc?search={q}` | Working |

**The discovery chain to run before adding any term to your model:**

1. Pick the candidate vocabulary (§3); resolve its namespace:
   `GET https://prefix.cc/vcard.file.json` → `{"vcard": "http://www.w3.org/2006/vcard/ns#"}`.
2. **Confirm the exact term exists** by dereferencing it (`GET` the term IRI with
   `Accept: text/turtle`). 200 with an `rdfs:label`/`rdfs:comment` proves it is real and
   dereferenceable; 404 means do not use that IRI.
3. **Sanity-check reuse**: grep the LOV dump for the term IRI — high occurrence = de-facto
   standard. (Don't fetch `https://schema.org/Person` per-term with an RDF Accept header — it
   returns HTML; parse the full Schema.org dump instead.)
4. Only if nothing fits, mint locally — see §6 for the one acceptable way.

## 3. The selection ladder

Tie-breakers, top-down: **W3C REC / ISO / IETF beats everything** → established de-facto
standard with broad LOV reuse beats a "cleaner" niche vocab → actively maintained beats
abandoned → already-used-in-this-app beats a new namespace → fewer namespaces beats
term-shopping.

| You are modelling | Use | Notes |
|---|---|---|
| People — contact detail (name, email, tel, address, org) | **vCard** `http://www.w3.org/2006/vcard/ns#` | Default for Solid profile contact data |
| People — social graph / agents | **FOAF** `http://xmlns.com/foaf/0.1/` | What WebID profiles use (`foaf:Person`, `foaf:knows`). Unmaintained but universally deployed; not for addresses or commerce |
| People — public / SEO / commerce-facing | **Schema.org** `http://schema.org/` | Canonical scheme is **`http://`** — see §6 |
| Datasets & catalogue metadata | **DCAT** `http://www.w3.org/ns/dcat#` + **DCTERMS** `http://purl.org/dc/terms/` | DCAT v3 is a W3C REC; designed to combine |
| Generic descriptive metadata (title, created, modified, creator, licence) | **DCTERMS** `http://purl.org/dc/terms/` | Prefer over legacy `dc:` (`…/elements/1.1/`) |
| Taxonomies, tags, categories | **SKOS** `http://www.w3.org/2004/02/skos/core#` | `skos:Concept`, `broader`/`narrower`, `prefLabel`; schemes via BARTOC |
| Social activity / feeds / notifications | **ActivityStreams 2.0** `https://www.w3.org/ns/activitystreams#` | W3C REC; canonically **`https://`** |
| Provenance | **PROV-O** `http://www.w3.org/ns/prov#` | W3C REC |
| Time / events | Schema.org (`Event`, `startDate`) for app-level; **OWL-Time** `http://www.w3.org/2006/time#` for temporal reasoning | |
| Units / quantities | **QUDT** `http://qudt.org/schema/qudt/` | Never bespoke "value + unit string" |
| Geospatial | **WGS84 geo** `http://www.w3.org/2003/01/geo/wgs84_pos#` (lat/long); GeoSPARQL for geometry | |
| Access control | ACL / ACP vocabularies | Do **not** hand-author — use the access-control wrappers |

When two picks tie, the term IRI with more LOV reuse wins.

## 4. FAIR, applied concretely

| Principle | Concrete requirement | How you satisfy it |
|---|---|---|
| **Findable** | Globally-unique dereferenceable IRIs; typed resources | Reuse IRIs that 200 on GET; `rdf:type` on every resource; register types in the pod type index |
| **Accessible** | Retrievable by IRI over a standard protocol | HTTP GET + content negotiation (Turtle / JSON-LD); Solid-OIDC — 401/403 are *accessible* failures |
| **Interoperable** | Shared vocabularies + machine-readable structure | §3 vocabularies, not private terms; ship SHACL shapes; Turtle + JSON-LD only |
| **Reusable** | Documented, validatable, licensed | `dcterms:license` + provenance on datasets; `sh:description` on shapes; no undocumented private terms |

Minimum bar: every property IRI dereferences, every resource is typed, a published SHACL shape
describes the structure, dataset resources carry `dcterms:license`.

## 5. Validation — SHACL

Model and validate with [SHACL](https://www.w3.org/TR/shacl/) (W3C REC). A shape is both the
validation contract and machine-readable documentation.

- **Look before you author**: the [Solid SHACL Shapes Catalogue](https://github.com/solid/shapes)
  is active and npm-published — reuse its shapes, and contribute yours back.
  [awesome-semantic-shapes](https://github.com/w3c-cg/awesome-semantic-shapes) indexes the wider
  ecosystem.
- Author shapes against reused IRIs (`sh:path vcard:fn`); constrain `sh:datatype` /
  `sh:nodeKind` to prevent literal-vs-IRI bugs.
- Validate before write, and on read of untrusted data (`pyshacl` in CI; validate the
  object-mapper output graph in-app).
- Prefer SHACL over ShEx for new Solid shapes (REC status, broader tooling, what `solid/shapes`
  standardises on).

## 6. Anti-patterns

| Anti-pattern | Why it breaks | Do instead |
|---|---|---|
| Minting at a fake / non-resolving domain (`https://myapp.example/vocab#…`) | Kills Findable + Reusable | Reuse a published term; mint only under a domain you control and serve; use **blank nodes** for structural intermediate nodes |
| Inventing a term LOV already has | Fragments the graph | Search first (§2); use the established term even if you'd have named it differently |
| Mixing `http://`/`https://` of one namespace (classically schema.org) | They are *different IRIs* — queries and shapes silently miss data | One canonical scheme per vocabulary: **schema.org → `http://`**, ActivityStreams → `https://`. Lint for stray variants |
| `authorId`-style string properties standing in for links | The value is opaque; nothing joins | A real object property with an IRI (or blank node) as its value |
| Undeclared / inconsistent prefixes | Typo'd IRIs that don't resolve | Resolve via prefix.cc, declare once, never redefine a well-known prefix |
| Literal-vs-IRI confusion (IRI in a string literal; enum as free text) | Breaks links and interop | Object properties → IRIs; controlled values → `skos:Concept` IRIs; enforce with `sh:nodeKind` |
| One vocabulary for everything | Shallow or wrong-domain terms | Apply the §3 ladder per entity; borrow single terms only for real gaps |
| Hand-building triples / ACLs by string concatenation | Security-critical errors, malformed graphs | The object-mapper and access-control wrappers — always |
