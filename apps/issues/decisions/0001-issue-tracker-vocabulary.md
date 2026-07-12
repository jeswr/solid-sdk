# 0001 — Issue-tracker vocabulary: reuse the W3C `wf:` workflow ontology

**Status:** accepted · **Date:** 2026-06-09

## Decision

Model issues with the **W3C workflow ontology** `wf:`
(`http://www.w3.org/2005/01/wf/flow#`) plus **Dublin Core Terms** `dct:`
(`http://purl.org/dc/terms/`) for generic metadata. No custom terms are minted.

## Why

`docs/data-modelling.md` mandates interop-first: reuse a deployed model before
authoring one. The discovery chain led to:

- `solid/shapes` ships `shapes/issue_tracker.ttl` — a SHACL shape targeting
  `wf:Tracker`, derived from **SolidOS `issue-pane`** (the de-facto deployed Solid
  issue tracker). It uses `wf:`, `dct:`, `vcard:Group`.
- The `wf:` ontology dereferences (200, labelled terms) and is the established,
  broadly-deployed choice — it wins the selection ladder (already used by the one
  deployed app in this domain).

Choosing this makes our issues readable/writable by SolidOS and any `wf:`-aware app.

## The model

**Tracker** (one config resource per tracker, e.g. `…/issues/index.ttl#this`):

| Predicate | Range | Meaning |
|---|---|---|
| `rdf:type` | `wf:Tracker` | it is a tracker |
| `dct:title` | string | tracker title |
| `wf:issueClass` | class | type issues must have (`wf:Task`) |
| `wf:initialState` | class | state new issues start in (`wf:Open`) |

**Issue** (one resource per issue, `…/issues/<id>.ttl#this`):

| Predicate | Range | Meaning |
|---|---|---|
| `rdf:type` | `wf:Task` **and** `wf:Open` \| `wf:Closed` | an issue; **state is carried by rdf:type** (the SolidOS model — no `wf:state` predicate exists) |
| `dct:title` | xsd:string | summary |
| `wf:description` | xsd:string | body |
| `wf:tracker` | IRI → Tracker | back-link to its tracker |
| `dct:created` | xsd:dateTime | creation time |
| `dct:modified` | xsd:dateTime | last change time |
| `dct:creator` | IRI → WebID | who filed it |
| `wf:assignee` | IRI → Agent | assigned agent (optional) |
| `wf:dateDue` | xsd:date | due date (optional) |
| `prov:endedAtTime` | xsd:dateTime | completion time — stamped on close, cleared on reopen (feeds the burndown) |

State change = retype between `wf:Open` and `wf:Closed`. The `wf:` ontology
defines no completion-time property (its own `created`/`modified` are commented
out — hence `dct:` for those), so completion provenance reuses **PROV-O**
(`http://www.w3.org/ns/prov#`), the W3C REC `docs/data-modelling.md` lists for
provenance.

## Deferred to milestone 2

Priority / labels (`wf:issueCategory` ranges over per-tracker category **classes** —
adding them means defining category classes; deferred to avoid minting in the MVP),
comments (`wf:message`), assignee groups (`vcard:Group`), cross-pod sharing (WAC/ACP).

## Validation

Author/borrow a SHACL shape against these reused IRIs; validate object-mapper output
before write (per `docs/data-modelling.md` §5).
