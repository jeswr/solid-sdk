<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/site-model

> **Experimental, AI-agent-generated, private.** Part of the semantic agent browser in
> [`jeswr/solid-sdk`](https://github.com/jeswr/solid-sdk). The vocabulary is provisional.

A **site model** describes what a website lets you do, so an agent never has to read the
site's pages. A profiler learns a site once and writes the model: each **operation** is a
schema.org action type (`SearchAction`, `AddToCartAction`, ...) mapped onto one of the site's
own HTTP requests, and each **flow** chains operations into one larger action
(`BuyAction` = add to cart, then pay). A planner LLM sees only a short catalogue, asks for an
action in RDF, and an executor compiles that request into the site's HTTP calls.

This package holds the shared contract (`src/types.ts`), the RDF vocabulary and shapes, and
the functions that move between them:

| Export | What it does |
|---|---|
| `readSiteModel(input, { baseIRI?, format? })` | Turtle (or quads) to a `SiteModel`. |
| `writeSiteModel(model)` | `SiteModel` to Turtle via `n3.Writer`: stable order, prefixes, inline lists. |
| `parseActionRequest(input, { format?, baseIRI? })` | A planner's RDF action to an `ActionRequest`. |
| `renderCatalogue(model)` | The compact action listing a planner sees. |
| `validateSiteModel(model)` | Structural problems SHACL cannot express. |
| `canonicalSiteModel(model)` | The normalised form `readSiteModel` returns. |

`site-action.ttl` (the ontology) and `site-action.shacl.ttl` (the normative shapes) are
exported as package files.

## Vocabulary

Namespace `https://jeswr.org/ns/site-action#` (prefix `sab:`, provisional). schema.org is used
with the `https://schema.org/` scheme throughout; readers normalise `http://schema.org/`.

| Contract | RDF |
|---|---|
| `SiteModel` | `sab:SiteModel`; `schema:url` (site origin), `schema:version`, `prov:generatedAtTime`, `schema:potentialAction` (operations and flows), `sab:loginRoute` |
| `Operation`, `Flow` | `sab:Operation`, `sab:Flow` (both `rdfs:subClassOf schema:Action`); `sab:actionType` (the schema.org action class), `schema:name` (label), `schema:description`, `sab:input`, `sab:effect`, `schema:position` |
| `Operation.request` | `schema:target` a `schema:EntryPoint`: `schema:httpMethod`, `schema:urlTemplate`, `schema:contentType`, `sab:bodyTemplate`, `sab:header` (`schema:PropertyValue` name/value pairs) |
| `Operation.session` | `sab:session` `sab:NoSession` or `sab:SignedIn` |
| `EffectClass` | `sab:effect` `sab:Read` < `sab:ReversibleWrite` < `sab:IrreversibleWrite` < `sab:Payment` (concepts of `sab:EffectScheme`) |
| `ActionOutcome` | Executor-authored `sab:ActionOutcome`: `sab:status` (`sab:Completed`, `sab:Failed` or `sab:Uncertain`), `sab:target` (operation/flow label), `sab:effect`, authorized payment total (`schema:price`, `schema:priceCurrency`), and optional created-item IRI (`schema:result`) with its trusted facts |
| `Parameter` | `sab:Parameter` (`rdfs:subClassOf schema:PropertyValueSpecification`): `schema:valueName`, `sab:valuePath` (a predicate, or an RDF list for a sequence path, as in SHACL), `sab:range`, `schema:valueRequired`, `sab:location`, `schema:description`, `sab:option` (RDF list), `skos:example`, `schema:defaultValue` |
| `CsrfRule` | `sab:CsrfRule`: `sab:csrfSource` (`sab:sourceKind` cookie/html/json/meta with `schema:name`, `schema:urlTemplate`, `sab:selector`, `sab:attribute`, `sab:pointer`) and `sab:csrfTarget` (`sab:targetKind` header/form/query, `schema:name`) |
| `Extraction`, `FieldRule` | `sab:Extraction`: `sab:format`, `sab:itemPath`, `sab:totalPath`, `sab:itemType`, `sab:idField`, `sab:fieldRule`; `sab:FieldRule`: `sab:fieldProperty`, `sab:selectorPath`, `sab:attribute`, `sab:valueDatatype` (`sab:IriValue` for the contract's `'iri'`), `sab:untrusted` |
| `FlowStep` | `sab:step` a `sab:FlowStep`: `sab:operation`, `schema:position`, `sab:binding` (`schema:PropertyValue`: parameter name and `$input.x`, `$step<N>.<property IRI>` with N counted from 0, or a literal) |
| `Provenance` | on the operation or flow: `prov:wasDerivedFrom`, `prov:generatedAtTime` (learnedAt), `sab:learnMethod`, `sab:confidence`, `sab:lastVerified`, `sab:successes`, `sab:attempts` |
| `LoginRoute` | `sab:LoginRoute`: `sab:loginMethod`, `sab:operation`, `sab:sessionCookie`, `sab:probeUrl`, `sab:refresh` a `sab:RefreshRule` (`schema:urlTemplate`, `sab:tokenPointer`, `sab:expiresInPointer`) |

`sab:UntrustedText` is a datatype for literals an executor extracts from untrusted field rules.
Ordered collections (inputs, steps, CSRF rules, field rules, login routes, operations, flows)
carry `schema:position`; a reader orders by position, then by IRI.
Execution outcomes are runtime receipts, separate from the learned `SiteModel` graph.
`sab:Completed` means the action is done and must not be repeated. `sab:Failed` means execution
stopped without a committed or uncertain write. `sab:Uncertain` means at least one
write may have reached the site without a 4xx rejection, but execution did not finish; those writes must not be
repeated. Completed payment outcomes require an authorized amount and currency in the normative
shapes. Failed and uncertain receipts allow those fields to be absent. The ontology and both
SHACL profiles admit Uncertain; generated artifacts are regenerated through codegen. The shared
TypeScript `ActionOutcome` stays unchanged; site-executor's local `ExecutionOutcome` adds the
uncertain status and its result supplies committed write targets/fingerprints.

## Worked example

An add-to-cart operation and a buy flow, hand-written with blank nodes:

```turtle
@prefix sab:    <https://jeswr.org/ns/site-action#> .
@prefix schema: <https://schema.org/> .
@prefix prov:   <http://www.w3.org/ns/prov#> .
@prefix xsd:    <http://www.w3.org/2001/XMLSchema#> .
@base <https://shop.test/.well-known/site-model> .

<#model> a sab:SiteModel ;
  schema:url <https://shop.test> ;
  schema:version "1.0.0" ;
  prov:generatedAtTime "2026-11-13T10:00:00Z"^^xsd:dateTime ;
  schema:potentialAction <#add-to-cart>, <#checkout>, <#buy> .

<#add-to-cart> a sab:Operation ;
  sab:actionType schema:AddToCartAction ;
  schema:name "Add to cart" ;
  schema:position 0 ;
  sab:input [ a sab:Parameter ;
    schema:valueName "sku" ; sab:valuePath ( schema:object schema:sku ) ;
    sab:range xsd:string ; schema:valueRequired true ; sab:location "body" ] ;
  schema:target [ a schema:EntryPoint ;
    schema:httpMethod "POST" ;
    schema:urlTemplate "https://shop.test/api/cart" ;
    schema:contentType "application/json" ;
    sab:bodyTemplate "{\"sku\": {sku}}" ] ;
  sab:session sab:SignedIn ;
  sab:csrfRule [ a sab:CsrfRule ;
    sab:csrfSource [ a sab:CsrfSource ; sab:sourceKind "cookie" ; schema:name "csrftoken" ] ;
    sab:csrfTarget [ a sab:CsrfTarget ; sab:targetKind "header" ; schema:name "X-CSRF-Token" ] ] ;
  sab:effect sab:ReversibleWrite ;
  sab:extraction [ a sab:Extraction ;
    sab:format "json" ; sab:itemType schema:Order ;
    sab:fieldRule [ a sab:FieldRule ; sab:fieldProperty schema:orderNumber ; sab:selectorPath "/cartId" ] ] ;
  prov:wasDerivedFrom <urn:uuid:5f0c2a9e-7d1b-4c3a-9e8f-0a1b2c3d4e5f> ;
  prov:generatedAtTime "2026-11-01T09:30:00Z"^^xsd:dateTime ;
  sab:learnMethod "demonstration" ;
  sab:confidence 0.95 .

<#checkout> a sab:Operation ;
  sab:actionType schema:PayAction ;
  schema:name "Place order" ;
  schema:position 1 ;
  sab:input [ a sab:Parameter ;
    schema:valueName "cart" ; sab:range xsd:string ; schema:valueRequired true ; sab:location "form" ] ;
  schema:target [ a schema:EntryPoint ;
    schema:httpMethod "POST" ; schema:urlTemplate "https://shop.test/checkout" ;
    schema:contentType "application/x-www-form-urlencoded" ] ;
  sab:session sab:SignedIn ;
  sab:effect sab:Payment ;
  prov:generatedAtTime "2026-11-01T09:31:00Z"^^xsd:dateTime ;
  sab:learnMethod "demonstration" ;
  sab:confidence 0.9 .

<#buy> a sab:Flow ;
  sab:actionType schema:BuyAction ;
  schema:name "Buy a product" ;
  sab:input [ a sab:Parameter ;
    schema:valueName "sku" ; sab:valuePath ( schema:object schema:sku ) ;
    sab:range schema:Product ; schema:valueRequired true ; sab:location "body" ] ;
  sab:step
    [ a sab:FlowStep ; schema:position 0 ; sab:operation <#add-to-cart> ;
      sab:binding [ a schema:PropertyValue ; schema:name "sku" ; schema:value "$input.sku" ] ] ,
    [ a sab:FlowStep ; schema:position 1 ; sab:operation <#checkout> ;
      sab:binding [ a schema:PropertyValue ; schema:name "cart" ;
                    schema:value "$step0.https://schema.org/orderNumber" ] ] ;
  sab:effect sab:Payment ;
  prov:generatedAtTime "2026-11-01T09:32:00Z"^^xsd:dateTime ;
  sab:learnMethod "demonstration" ;
  sab:confidence 0.9 .
```

```ts
import { readFileSync } from "node:fs";
import { parseActionRequest, readSiteModel, renderCatalogue, validateSiteModel } from "@jeswr/site-model";

const model = readSiteModel(readFileSync("shop.ttl", "utf8"));
validateSiteModel(model); // []
renderCatalogue(model);
// buy  BuyAction  payment  inputs: object/sku(schema:Product, required)  "Buy a product"
// add-to-cart  AddToCartAction  reversible-write  inputs: object/sku(xsd:string, required)  "Add to cart"
// checkout  PayAction  payment  inputs: none  "Place order"

const request = parseActionRequest(`
  @prefix schema: <http://schema.org/> .
  [] a schema:BuyAction ; schema:object [ a schema:Product ; schema:sku "TR-42" ] .`);
request.types;                                                       // ["https://schema.org/BuyAction"]
request.values(["https://schema.org/object", "https://schema.org/sku"]); // ["TR-42"]
```

## Reading and writing

- `readSiteModel` accepts Turtle-family text (`format` defaults to `text/turtle`; also
  N-Triples, N-Quads, TriG, and the JSON-LD subset below) or quads. The document must hold
  exactly one `sab:SiteModel`. Blank nodes other than RDF list cells become
  `urn:x-site-model:genid:<n>` IRIs, because the generated wrappers read named nodes only.
  Every node is read through its generated entity, so a missing or malformed required field
  throws a `SiteModelError` naming the node.
- `writeSiteModel` mints node IRIs under their owner (`<op>#request` or `<op>.request` when the
  owner already has a fragment, `.input.0`, `.csrf.0.source`, `.step.1.bind.0`, `<model>.login.0`
  ...), writes every node through its generated entity, then **reads the result back and
  compares it with `canonicalSiteModel(model)`**. Anything that would not survive (a control
  character the runtime strips, a relative IRI, an out-of-range confidence, an unknown enum
  value) throws a `SiteModelError` naming the first differing field.
- The round trip is lossless for every contract field, up to this canonical form:
  timestamps become `Date#toISOString()` (UTC with milliseconds); `derivedFrom` and
  `sessionCookies` are sets, read back sorted; empty optional collections (`headers`, `csrf`,
  `login`, `sessionCookies`) are dropped. An empty `options` list is kept (`rdf:nil`). Record
  keys (`headers`, `bind`) are written sorted.

## Action requests

`parseActionRequest` picks the single node typed with a schema.org class whose name ends in
`Action` (`https://` or `http://schema.org/`, normalised to https) and errors when there are
none or several. `values(path)` follows the path (also normalised), returning literals as
lexical forms, IRIs as IRIs and blank nodes as `_:label`, deduplicated.

JSON-LD is read **synchronously**, so only a compact subset is supported: the schema.org
context URL (treated offline as `@vocab: https://schema.org/`), inline contexts with `@vocab`,
`@base`, `@language`, `@version` and simple term definitions (`@id`, `@type` of `@id`,
`@vocab` or a datatype), node objects, nested nodes, arrays, value objects, and a top-level
array or `@graph`. Remote contexts, `@list`, `@reverse`, containers and named graphs throw
rather than being dropped. Use `parseRdf` from `@jeswr/fetch-rdf` for full JSON-LD.

## Catalogue

One line per flow, then per operation: short name (the IRI fragment), the schema.org action
name, the effect class, the inputs a planner can set (the property path from the action node,
the range, `required`, allowed options) and the label. Inputs only a flow binding sets are
left out. The catalogue never contains URLs, templates, CSRF rules or session details; IRIs
outside schema:, xsd: and sab: are shown by their short name.

## Validation

`validateSiteModel(model)` returns `{ path, message }[]`: duplicate or relative ids, flow
steps naming unknown operations, binds naming unknown parameters, `$input.x` naming unknown
flow inputs, `$stepN` not naming an earlier step, URL templates (RFC 6570, level 4) or body
placeholders using undeclared variables, path parameters missing from the URL template,
CSRF source templates using undeclared variables, an `idField` that is no field rule's
property, a flow effect weaker than its strongest step, login routes naming unknown
operations or a password route without its form operation, duplicate parameter names,
relative ranges or path steps, and defaults outside the options. Static headers, header parameters
and CSRF header targets cannot name executor-owned headers (case-insensitively), including Accept,
Content-Type, session credentials and framing headers. One otherwise-unbound simple whole path
segment named by a query-target CSRF rule is reserved for session decoration; other undeclared
variables, including body and CSRF source template variables, still fail validation.

## Generated model

`src/generated/` is compiled by `@jeswr/federation-codegen` from `site-action.ttl`, the
profile `codegen/site-action.codegen.shacl.ttl` and `codegen.config.json`
(`pnpm run codegen`); `test/codegen.test.ts` checks it regenerates byte for byte. Every node
class is a flat entity with the `self` subject convention; the facade (`src/read.ts`,
`src/write.ts`) walks links between them.

### Generator gaps

Each gap is handled in the facade; the generator would need the named feature to absorb it.

| Gap | Handled by | Generator would need |
|---|---|---|
| A site model is a variable-size graph (n operations, each with n inputs...). Composite entities have fixed fragments per node, so links are plain IRI fields and `sh:class` on links is dropped from the profile. | `src/read.ts` walks links; the normative shapes keep `sh:class`. | Composite links to repeated child nodes (sets of nested entities with minted subjects). |
| `sab:valuePath` is a predicate IRI or an RDF list; `sab:option` is an RDF list. | `src/lists.ts` via `@rdfjs/wrapper` `RdfList`. | `rdf:List` field projection, and `sh:or` of IRI and list. |
| `CsrfSource` is a discriminated union (`sh:xone` in the normative shape). | Per-kind requirements checked in `src/read.ts`; the writer emits only the kind's fields. | `sh:xone`/`sh:or` admission with discriminator-conditional requiredness. |
| `sh:pattern "^https?://"` on string-valued URL templates and the probe URL. | Kept in the normative shapes only. | A reviewed pattern guard for string fields. |
| Conditional payment amount/currency requiredness (`sh:or`) and the currency literal pattern on `ActionOutcome`. | Normative shapes and executor output checks; the generated profile keeps those fields optional. | Conditional admission and literal pattern guards. |
| The shared `sabsh:LearnedActionShape` (`sh:node` from the operation and flow shapes). | Inlined into both shapes of the profile. | Flat `sh:node` conjunction. |
| Field names `value` and `datatype` are reserved by the runtime. | Projected as `propertyValue` and `valueDatatype`. | None (a naming rule). |
| `xsd:dateTime` projects to `Date`, so lexical forms are not kept. | Timestamps are canonicalised to `toISOString()`. | A lexical-preserving string projection for date-times. |
| Blank nodes cannot be wrapped (`model subject must be a NamedNode`). | Skolemised on read (`urn:x-site-model:genid:`). | Blank-node subjects for flat entities. |

## Development

```sh
pnpm --filter @jeswr/site-model run lint
pnpm --filter @jeswr/site-model run build
pnpm --filter @jeswr/site-model run typecheck
pnpm --filter @jeswr/site-model run test
pnpm run check:codegen
```

Parsed action requests retain RDF term kinds through `actionRequestTerms(request, path)` in addition
to the unchanged lexical `values(path)` contract. Custom ActionRequest implementations can provide
an optional `terms(path)` method; otherwise the helper returns undefined. This lets executors reject
scalar blank nodes and normalize IRI terms without confusing them with literal text.
`sab:Uncertain` includes writes that may have reached the site without a 4xx rejection (5xx,
network/reset/timeout, or failed extraction after 2xx/3xx); hosts retain and guard their fingerprints.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
## List counts and response identities

`Extraction.totalPath` optionally selects the matching-record count from the response document
(JSON pointer or HTML selector). The executor publishes a trusted `schema:ItemList` with an
integer `schema:numberOfItems`; a total larger than the returned page makes the observation
partial. Paging remains ordinary described inputs. This count is display information and
cannot establish payment money.

`endpointItemType(url)` uses only endpoint paths and dispatch selectors, ignoring user search
values. Specific nouns take precedence: invoices → Invoice, shipments → ParcelDelivery,
customers → Person, products → Product, orders → Order. Credit memo/refund records use Thing
with textual additionalType because schema.org supplies no corresponding document class.
`responseIdentity(location)` recognizes explicit `/id/<id>` routes or terminal numeric/UUID
segments in server redirects. Executors additionally enforce origin and secret checks.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
Response identities also recognize a numeric segment immediately before a hyphenated canonical
slug (for example `/topics/42/a-test-story`). Origin and secret checks still belong to the caller;
queries/fragments are stripped. HTML documents with several record classes use separate operations,
each with its own existing Extraction. No shared contract extension is required.
