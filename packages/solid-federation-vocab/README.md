# solid-federation-vocab

> ⚠️ Experimental — AI-agent-generated (Claude Opus 4.8, @jeswr PSS agent); under active development, not production-hardened.

The federation vocabularies for the [@jeswr](https://github.com/jeswr) Solid app
suite, served (mostly) under the persistent namespace **`https://w3id.org/jeswr/`**
(decided in `prod-solid-server` ADR-0013). The vocabularies that live here:

| Namespace | Prefix | What it is |
|---|---|---|
| `https://w3id.org/jeswr/fed#` | `fedapp:` | **App-registration** metadata an app publishes in its Client Identifier Document (OpenID-Federation-style): the sectors it operates in, the WAC/ACP access modes it requests, and the shared shapes it consumes / produces. |
| `https://w3id.org/jeswr/fedreg#` | `fedreg:` | **Federation Catalogue / Registry** — the discovery axis. A `fedreg:Registry` (a `dcat:Catalog`) listing member apps with a **registry-asserted** `fedreg:Membership` (lifecycle status + `assertedBy` authority — distinct from the app's self-asserted `fedapp:App`), and a `fedreg:StorageDescription` advertising **which client-client spec-versions a resource server accepts** (`acceptsSpec`) and which sectors it supports — the substrate for asynchronous schema migration. Consumed by [`@jeswr/federation-registry`](https://github.com/jeswr/federation-registry). |
| `https://jeswr.org/fedcon#` | `fedcon:` | **Federation Contribution / Admission** — the write / governance axis. The contribution + admission lifecycle for the concept-federation registry: an ownerless, content-addressed concept is **proposed** (define / extend / promote), publicly **commented** on (Web Annotations + a `fedcon:stance`) and **admitted** (or rejected) by a registry authority, with usage attestations as promotion evidence and a **mandatory dissent annex** on every admission. A `fedcon:Admission` is a `fedreg:RegistryAssertion`, the sibling of a `fedreg:Membership`. **Mints under `jeswr.org` directly** (not the `w3id.org` redirect its siblings use — see the `fedcon:` section). |
| `https://w3id.org/jeswr/task#` | `tm:` | The **shared cross-app task / issue model** — the canonical, dereferenceable re-use of the W3C workflow ontology (`wf:`), Dublin Core Terms (`dct:`) and ActivityStreams 2.0 (`as:`) every suite app reads/writes for tasks and issues. |
| `https://w3id.org/jeswr/core#` | `core:` | The **gUFO-based Solid Core** — the foundational ontology every sector imports and constrains-but-never-forks. Every cross-sector root (Agent, Account, Identifier, Record, Relationship, Quantity, …) carries a gUFO meta-type (Kind / Relator / Role(Mixin) / Phase / EventType / …). |
| `https://w3id.org/jeswr/sectors/<sector>#` | per-sector | The **sector ontologies** (`identity`, `finance`, `health`, `media`, `scheduling`, `contacts`, `drawing`, `social`, `bookmarks`, `futures`) — the domain models a `fedapp:sector` references. Each imports `core:` and reuses real vocabularies (see below). |

The `w3id.org`-rooted IRIs resolve via a permanent `w3id.org` redirect to a GitHub
Pages target under this repo (`docs/`), so they survive a host move and stay under
`@jeswr` (not `solidproject.org`, which would require a CG adoption first).
**`fedcon:` is the exception** — it mints under `jeswr.org`, whose live resolution
is a pending hosting/DNS decision (see the `fedcon:` section); its documents are
still generated into `docs/` and gate-checked identically.

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
   apps via **`fedreg:Membership`** records (each a **`fedreg:RegistryAssertion`**
   ⊑ `dcat:CatalogRecord` — see below). A Membership
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

`fedreg:Membership` is a **`fedreg:RegistryAssertion`** — the common superclass
(⊑ `dcat:CatalogRecord`) for any registry-authority-signed record, carrying the
`fedreg:assertedBy` / `fedreg:asserted` / `fedreg:status` spine. Its sibling is the
concept-admission record `fedcon:Admission` (see the `fedcon:` section). This is an
**additive, backward-compatible** generalisation: `Membership` was re-parented under
`RegistryAssertion` (both `rdfs:subClassOf` triples are kept — `RegistryAssertion`
**and** the direct `dcat:CatalogRecord` — so even a non-reasoning consumer that read
`Membership ⊑ dcat:CatalogRecord` sees no change), and the
`assertedBy` / `asserted` / `status` domains were widened from `Membership` to
`RegistryAssertion` — existing `Membership` data still satisfies every widened
domain. The only semantic effect of the widening is on **domain inference**: a bare
`?x fedreg:assertedBy ?a` now entails the more general `?x a fedreg:RegistryAssertion`
rather than `fedreg:Membership`. Explicitly-typed membership data (how every
membership in the suite is written — `@jeswr/federation-registry` always asserts the
type and validates by explicit `targetClass`) is unaffected; records SHOULD carry an
explicit `rdf:type` and not rely on domain inference to tell a membership from a
concept admission (the ambiguity the shared spine deliberately introduces, resolved
by the explicit type).

JSON-LD `@context`: [`fedreg-context.jsonld`](./fedreg-context.jsonld).

## The `fedcon:` vocabulary (Contribution / Admission)

The **write / governance axis** of the concept-federation registry — the companion
to the discovery-axis `fedreg:` and the self-asserted `fedapp:`. Where `fedreg:`
describes *who* is a member and *which* specs a storage accepts, `fedcon:` describes
*how a concept crystallises into a federation*: proposed, publicly commented, and
admitted (or rejected) by a registry authority. Bottom-up crystallisation, with
usage-across-peers as the forcing function.

> **Namespace — `https://jeswr.org/fedcon#`, not `w3id.org/jeswr`.** Unlike every
> sibling vocabulary here, `fedcon:` mints under the maintainer's now-live
> `jeswr.org` domain, avoiding a dependency on the still-pending `w3id.org` redirect
> PR for new work. **Live resolution of `https://jeswr.org/fedcon` is a pending
> `jeswr.org` hosting/DNS decision** (out of scope for this vocab-only phase — the
> same "not yet resolving" honesty this README already applies to the pending w3id
> PR). `fedcon:` is therefore deliberately **not** in the `.htaccess` redirect block
> below (that block is for the w3id-rooted vocabs only). Cross-namespace references
> (a `fedcon:` term pointing at a `w3id.org` `fedreg:` term) are ordinary RDF.

**The lifecycle** (`fedcon:ConceptStatus`) — a concept in local use is *no registry
record at all* (the fast path: define, hash, serve, use, with zero gatekeeping); the
state machine begins only when a `fedcon:Proposal` is filed:
`Proposed → UnderReview` (a public comment window, policy default 7 days) →
`Admitted` / `Rejected` (a reasoned, dissent-annexed authority decision) →
`Superseded` / `Deprecated` (or `Withdrawn` by the proposer). Rejection is
per-registry and non-terminal — the hash still works locally and can be admitted
elsewhere; there is no global state.

**The record shapes:**

- **`fedcon:Proposal`** — one LDN-POSTed record, three intents (`fedcon:intent` ∈
  `Define` / `Extend` / `Promote`). Always references the concept by its content
  hash (`fedcon:concept`); carries the definition graph (`fedcon:definition`, inline
  preferred), the proposer (`prov:wasAttributedTo`), and — for a Promote — usage
  attestations (`fedcon:evidence`) and prior standing (`fedcon:priorAdmission`).
  `fedcon:Extend` never mutates a parent (hashes are immutable): it is a *new*
  concept whose definition references the parent hash via `fedcon:extends`.
- **`fedcon:UsageAttestation`** — each *using* agent signs its OWN `{ concept, user,
  since, context? }`; nobody attests about anybody else, so consent to disclosure is
  by construction. The promotion evidence.
- **`fedcon:Admission`** — the registry authority's signed decision, a
  **`fedreg:RegistryAssertion`** (the sibling of `fedreg:Membership`) reusing the
  `fedreg:assertedBy` / `fedreg:asserted` spine. Carries `fedcon:conceptStatus`, the
  `fedcon:proposal` it decides, the `fedcon:reviewWindow`, the governing
  `fedcon:underPolicy`, a `fedcon:decisionRationale`, and the **mandatory dissent
  annex**.
- **`fedcon:AdmissionPolicy`** — governance-as-data: the authorities, the minimum
  comment window, the promotion-evidence expectation, the comment-write gate.
  Thresholds are registry *policy*, never protocol constants.
- **`fedcon:Announcement`** — a review-free notice that makes a concept
  *discoverable* (indexed, usable, explicitly unendorsed) before any governance —
  the bootstrap for the "sourced from registries" EXTEND loop.

**Comments** are Web Annotations (`oa:Annotation`, motivated by
commenting / replying / assessing) in a per-proposal inbox; a structured review
stance rides on assessing annotations via **`fedcon:stance`** ∈ `Support` / `Oppose`
/ `Concern`, and an `Oppose` MUST carry a non-empty rationale body.

**The mandatory dissent annex** (SHACL `fcsh:AdmissionShape`, mirroring the unite
`fut:SharedFuture` idiom): an `Admission` whose thread holds unresolved `Oppose`
stances but which records no `fedcon:dissent` is **invalid** unless it explicitly
asserts `fedcon:noDissentRecorded true` (`fedcon:noDissentRecorded` is minted here
precisely so that rule is structurally enforceable, exactly as `fut:noDissentRecorded`
backs the futures annex). The record format itself refuses manufactured consensus —
objections travel with the outcome rather than being averaged away.

`fedcon:` **mints only the federation contribution/admission glue**; it reuses Web
Annotation (`oa:`), PROV-O (`prov:`), DCAT/Dublin Core, LDP (`ldp:inbox`) and Hydra
(`hydra:operation` / `hydra:search`) at the instance/API level. The typed client SDK
and the LDN contribution service (`@jeswr/federation-contrib`) are a later,
out-of-scope phase; this repo ships the vocabulary + SHACL profile only.

JSON-LD `@context`: [`fedcon-context.jsonld`](./fedcon-context.jsonld); SHACL
profile: [`fedcon.shacl.ttl`](./fedcon.shacl.ttl). (In the context, the concept
lifecycle value `fedcon:Proposed` is aliased **`ConceptProposed`**, not `Proposed`,
so the `fedcon:` context can compose with the `@protected` `fedreg:` context — which
already binds `Proposed` to the membership-lifecycle `fedreg:Proposed` — without a
protected-term-redefinition clash. The `fedcon:`-prefixed form works regardless.)

## The shared task / issue model (`tm:`)

Mostly **agreed re-use** that `solid-issues` and Pod Manager already write, plus
**two minimal `tm:` extensions** (WIP limits + automation rules) minted below:

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

### WIP (work-in-progress) limits on a board column

A board column / workflow state in `solid-issues` is a per-tracker
`#status-<slug>` `rdfs:Class` typed **`wf:State`**. The minimal pair below puts a
[kanban WIP limit](https://support.atlassian.com/jira-software-cloud/docs/set-up-work-in-progress-limits/)
(Jira's column Min/Max, Trello/Monday's per-list cap) on such a state:

- **`tm:wipMin`** (`xsd:nonNegativeInteger`, domain `wf:State`) — the lower bound:
  a client warns when the column holds *fewer* open items than this.
- **`tm:wipMax`** (`xsd:nonNegativeInteger`, domain `wf:State`) — the upper bound:
  a client warns (or blocks the move) when adding a card would push the column
  *over* this count — the core "limit work in progress so bottlenecks surface"
  mechanism.

Both are optional; absent means no bound. The count enforcement is **client-side**
(a pod has no server-side compute); the vocab only records the configured bound.

```turtle
@prefix tm: <https://w3id.org/jeswr/task#> .
<#status-in-progress> a rdfs:Class, wf:State ;
    rdfs:subClassOf wf:Open ;
    tm:wipMax 3 .         # at most 3 cards in "In progress"
```

### Automation rules — event-condition-action ("when X then Y")

A tracker automation is an **ECA rule**: *WHEN* an event fires, *IF* optional
conditions hold, *THEN* perform an action. This is **not** an access-control /
usage policy, so it is deliberately **not** ODRL (see the decision note below).
The terms:

- **`tm:Rule`** — a rule, linked from a `wf:Tracker` via **`tm:rule`**. Bundles
  one **`tm:trigger`**, zero+ **`tm:condition`** guards, one+ **`tm:action`**
  effects.
- **`tm:trigger`** → a **`tm:Trigger`** coded value: `tm:OnStatusChange`,
  `tm:OnDueDatePassed`, `tm:OnAllSubtasksDone`, `tm:OnAssigned`, `tm:OnCreated`.
- **`tm:condition`** → an **`odrl:Constraint`** (`odrl:leftOperand` /
  `odrl:operator` / `odrl:rightOperand`) — **re-used from W3C ODRL 2.2**, so the
  suite's existing [`@jeswr/solid-odrl`](https://github.com/jeswr/solid-odrl)
  constraint evaluator applies unchanged. The rule fires only when **all** its
  conditions are satisfied.
- **`tm:action`** → a **`tm:Action`** coded value: `tm:SetStatus`,
  `tm:SetPriority`, `tm:Assign`, `tm:AddComment`, `tm:CloseIssue`, each carrying
  its parameter on **`tm:actionValue`**.

Rules are **pod-persisted** and **client-evaluated** (a pod has no server-side
compute — the honest pure-Solid translation of an automation engine, the model
`solid-issues`' built-in automations already use).

```turtle
@prefix tm:   <https://w3id.org/jeswr/task#> .
@prefix odrl: <http://www.w3.org/ns/odrl/2/> .
<#tracker> tm:rule [
    a tm:Rule ;
    tm:trigger tm:OnDueDatePassed ;
    tm:condition [ a odrl:Constraint ;
        odrl:leftOperand <#priority> ; odrl:operator odrl:neq ; odrl:rightOperand "high" ] ;
    tm:action [ a tm:SetPriority ; tm:actionValue "high" ]
] .   # "when an open issue passes its due date, escalate it to high priority"
```

#### Decision: mint a minimal `tm:` ECA vocab, **not** reuse ODRL for the rule

The brief asked whether to express automations by **reusing `@jeswr/solid-odrl`**
(ODRL `Rule`/`Permission`/`Duty` + constraint + action) or to **mint** a small
`tm:Rule` vocab. The recommendation, implemented here, is **mint a minimal ECA
vocab for the rule skeleton but reuse the ODRL *constraint* for the condition**:

- **ODRL models usage control, not automation.** An ODRL rule grants/denies a
  *party's use of an asset* and evaluates to **permit/deny**. A tracker
  automation has **no party and no asset-use** — it **reacts to an event** and
  **executes a side-effecting mutation** (close, set priority, assign). ODRL has
  no concept of a *trigger* (the load-bearing "WHEN" of ECA), and its `action` is
  a closed vocabulary of usage acts (`read`/`distribute`/`attribute`), not
  arbitrary tracker mutations. Forcing automations onto ODRL would be a category
  error and would mislead any ODRL-aware consumer.
- **But the *condition* is exactly an ODRL constraint.** "if the new status is
  `done`", "if priority ≠ high" is a `leftOperand operator rightOperand` boolean —
  the precise shape `@jeswr/solid-odrl` already evaluates. So `tm:condition`
  **re-uses `odrl:Constraint`** verbatim (zero new condition terms, reuse the
  existing evaluator) rather than minting a parallel constraint vocabulary.

Net new minted `tm:` terms: **3 classes** (`Rule`/`Trigger`/`Action`),
**7 properties** (`wipMin`, `wipMax`, `rule`, `trigger`, `condition`, `action`,
`actionValue` — `condition`'s *value* is the re-used `odrl:Constraint`), and
**10 coded values** (5 triggers + 5 actions). `wf:State` / `wf:Tracker` (the WIP /
rule domains) and the whole `odrl:Constraint` condition shape (incl. its operators)
are **re-used**, not minted (restated with `rdfs:isDefinedBy` pointing at their
owning vocabularies).

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

**The twelve sectors** — each `rdfs:subClassOf`-roots every class in a `core:` class,
carries its own gUFO meta-type, **constrains but never forks** the Core, and
reuses a real domain vocabulary:

| Sector | Prefix | gUFO highlights | External reuse |
|---|---|---|---|
| `sectors/identity#` | `id:` | NaturalPerson SubKind; VerifiableAttribute; HL7 Gender-Harmony five slots | eIDAS PID, ISO 3166, vCard, schema:Person |
| `sectors/finance#` | `fin:` | Account=Relator(+Phase status); Transaction=Event; Counterparty=RoleMixin; Budget/BudgetCategory(envelope)+CRDT-sync (Actual Budget); **double-entry LEDGER** (LedgerAccount/JournalEntry/LedgerEntry + Debit/Credit + account-class/code — Keystone) + **private equity** (Fund/Commitment/Notice + GP/LP + capital-call/distribution amounts — CapNote) + `fin:sharePct`/`fin:jurisdiction` (v1.2.0) | FIBO (version-pinned slim MIREOT + Mode-A LedgerAccount/LedgerEntry/PrivateEquityFund), ISO 4217/20022 |
| `sectors/health#` | `health:` | Patient=RoleMixin of Person; Observation=Record+Quantity; record-vs-act split | FHIR (Mode A, no fhir.ttl), SNOMED CT/LOINC, QUDT/UCUM units |
| `sectors/health/diet#` | `diet:` | SUB-SECTOR of health — Meal/FoodItem/Exposure=Record; Symptom=ClinicalEntry; TriggerClass+coded values=Category (per-trigger evidence-prior lag windows); elimination-protocol FSM; time-boxed conclusions; summary-only genetics — for the coeliac/multi-intolerance diary (`@jeswr/solid-health-diary`) | schema.org FoodEvent/NutritionInformation, SNOMED CT/LOINC symptoms, ChEBI + Monash-FODMAP triggers, Open Food Facts allergen/additive taxonomy (all Mode A) |
| `sectors/media#` | `media:` | CreativeWork=InformationResource+Asset; Artist=RoleMixin; PlaybackEvent | schema.org CreativeWork/MusicRecording, ODRL |
| `sectors/scheduling#` | `sched:` | CalendarEvent=Event; Attendance=Relator mediating an Attendee role; RSVP coded values | iCalendar RFC 5545, schema.org, OWL-Time |
| `sectors/contacts#` | `contact:` | Contact=Record about an agent; ContactPoint=Identifier; ContactRelationship=Relator | vCard, schema:ContactPoint/PostalAddress |
| `sectors/drawing#` | `drawing:` | Scene=InformationResource (a creative work) + the round-trip spine (opaque scene document, schema version, thumbnail) — for Excalidraw | schema:CreativeWork; the forthcoming `@jeswr/solid-drawing` `draw:` (Mode A) |
| `sectors/social#` | `social:` | Note=InformationResource (as:Note/sioc:Note); Feed=InformationResource (as:Collection) — for Elk + Miniflux + pod-chat | ActivityStreams 2.0, SIOC, `@jeswr/solid-chat-interop` CanonicalMessage |
| `sectors/bookmarks#` | `bookmark:` | Bookmark=InformationResource (a saved reference) + archived/notes/tags(skos) — for Linkding | schema:url/BookmarkAction, DCT, SKOS; the forthcoming `@jeswr/solid-bookmark` `book:` (Mode A) |
| `sectors/futures#` | `fut:` | Participatory-democracy deliberation — Need/Satisfier SPLIT (Max-Neef axiological×existential matrix + Schwartz value scheme, all seeds not law); tri-state Resonance=Record; Deliberation=Activity; SharedFuture with per-cluster BridgingEvidence + MANDATORY dissent annex; Stage-1 AppProposal⊑wf:Task — for `jeswr/unite` (the exact IRIs its Stage-1 client writes); v0.2.0 ADDITIVE (the unite S1 draft, formalised): scope-B InfraProposal⊑wf:Task + AdoptionDecision⊑SharedFuture with MEASURED-not-decreed ratification (AdoptionObservation records of fedreg:acceptsSpec), Convergence-Room Critique, methodProvenance/decomposedBy, the indirectStakeholders VSD prompt | ActivityStreams 2.0, PROV-O, ODRL 2.2 consent actions, VC 2.0, wf:/`@jeswr/solid-task-model` (all Mode A); Max-Neef 1991 + Schwartz 1992 + bridging-systems literature cited in the alignments |
| `sectors/collectibles#` | `col:` | ProvenanceEvent=Activity (PROV-O-correct: creation is the only `prov:wasGeneratedBy`, others `prov:used`; attribution → an Agent NODE; `prov:startedAtTime` not `prov:atTime`); Valuation/Appraisal=Record on a separate MonetaryAmount node (never `schema:offers`); InsurancePolicy=InformationResource — for Provena (art/collectibles provenance). Replaces the reserved `provena.example.org` NS + the non-existent `schema:artworkMedium/artworkSize` | schema.org (real terms: `schema:artMedium`, `width`/`height`, MonetaryAmount), PROV-O, linked.art/CIDOC-CRM (reference-only, never adopted) — all Mode A |
| `sectors/equine#` | `eq:` | Horse=Kind⊑Asset (schema.org has NO animal class — 404); Syndicate=Kind⊑Organization; OwnershipShare/StudShare=Record; StudNomination⊑schema:Reservation (`schema:totalPrice`); RaceResult⊑schema:SportsEvent; PrizeDistribution⊑schema:MoneyTransfer (`schema:amount` — replacing the non-existent `schema:prize`); coded sex/status/expense; percentages plain `xsd:decimal` — for Furlong. Replaces the per-resource `#flg.` fragment-IRI anti-pattern with shared `eq:` terms | schema.org (real dual-types only), W3C Organization, Wikidata horse anchor (all Mode A) |

Each sector declares a `…/sectors/<sector>#sector` marker (a `skos:Concept`) —
that is the IRI an app names in `fedapp:sector`. (`drawing`, `social` and
`bookmarks` are the FOUNDATION sectors for the 5-OSS-fork initiative — Excalidraw,
Elk + Miniflux, and Linkding; the per-app `fedapp:`/`fedreg:` registration blocks
land later with each app build, which need the app `client_id` IRIs.)

Each ontology ships a **SHACL profile** (`<x>.shacl.ttl`, the closed-world
MUST/SHOULD contract; the ontology is open-world) and a **Mode-A alignments file**
(`<x>-alignments.ttl`, the auditable `skos:*Match` / `owl:equivalent*` bridge to
external vocabularies, kept out of the reasoned closure). The whole stack passes a
consistency gate: `npm run ontology` parses every Turtle with n3, checks every
named term carries a label + definition, and — when ROBOT/HermiT is available —
reasons each ontology over its `owl:imports` closure (resolved offline via the
per-dir `catalog-v001.xml`) for **zero unsatisfiable classes**.

> **Provenance + scope.** The first six sectors (identity / finance / health /
> media / scheduling / contacts) were modelled as OntoUML and transformed to
> gUFO-OWL upstream in
> [`full-solid-ecosystem`](https://github.com/jeswr/full-solid-ecosystem)'s
> federation tree, then **re-namespaced** here from the upstream placeholder IRIs
> to the persistent `https://w3id.org/jeswr/` home. Re-sync those with
> `node scripts/import-sectors.mjs <federation/ontologies path>`. The three
> 5-OSS-fork FOUNDATION sectors (`drawing` / `social` / `bookmarks`) were authored
> directly here, gUFO-rooted from the outset (not an OntoUML re-base) — they are
> thin DOMAIN MARKERS that root one or two classes in the Core and align (Mode A)
> to the detailed external/forthcoming vocabularies, so the re-sync script does not
> own them. `social` also REPAIRS the previously-dangling `fedapp:sector`
> reference in `@jeswr/pod-chat`'s clientid. The `futures` sector was likewise
> authored directly here (gUFO-rooted from the outset) from `jeswr/unite`'s
> design/01 data model — its Need/Resonance term IRIs are the strings the running
> unite Stage-1 client already writes, so they are frozen against that client.
> The remaining unauthored sectors
> (work / mobility / documents) are a separate decision. The detail vocabularies
> `@jeswr/solid-drawing` (`draw:`) and `@jeswr/solid-bookmark` (`book:`) ship in
> their own repos (Phase B), referenced here only via the Mode-A alignment hooks.

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
| `text/turtle` | the `.ttl` (`fed.ttl` / `fedreg.ttl` / `fedcon.ttl` / `task.ttl` / `core.ttl` / `sectors/<x>.ttl`) |
| `application/ld+json` | the `.jsonld` context (`context.jsonld` / `fedreg-context.jsonld` / `fedcon-context.jsonld` / `<slug>-context.jsonld`) |
| `text/html` (browsers) | the human-readable HTML page (`fed.html` / `fedreg.html` / `fedcon.html` / `task.html` / `core.html` / `sectors/<x>.html`) |

The `fedcon.shacl.ttl` SHACL profile is served verbatim alongside `fedcon.ttl` (as
the sector `.shacl.ttl` profiles are). `fedcon:` conneg activates only once
`jeswr.org` resolution is decided (above); the documents are generated into `docs/`
regardless.

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

# --- sectors/<sector> (the 9 sector ontologies; $1 = identity|finance|drawing|… ) ---
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
- **`ontology`** (`ontology-gate.mjs`) — for the Core + 9 sectors: n3
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
