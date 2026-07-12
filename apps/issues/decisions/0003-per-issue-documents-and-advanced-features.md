# 0003 — Milestone 3: per-issue documents, priority/labels, comments, per-issue ACLs, groups, SHACL

**Status:** accepted · **Date:** 2026-06-09

## Storage: one document per issue
Issues moved from a single `issues.ttl` to **one document per issue** in an
`issues/` LDP container, with a separate `tracker.ttl` config document:

```
<pod>/issue-tracker/tracker.ttl        # wf:Tracker config (#this) + category classes + assignee group
<pod>/issue-tracker/issues/<uuid>.ttl  # one issue (#this a wf:Task) + its comments
```

This is what makes **per-issue access control** possible — WAC/ACP applies per
resource, so a fragment in a shared document cannot be individually shared
(solid-scale-and-sharding: permission-driven splitting). Listing is container GET
+ per-member GET; writes are conditional PUTs on each issue's own ETag; delete is
a real DELETE. The repository (`src/lib/repository.ts`) replaces the old
single-document module.

## Priority & labels — `wf:issueCategory` category classes
Both are carried by `rdf:type` (the SolidOS model, like state). The tracker
declares category **classes** as fragments of `tracker.ttl`, via `wf:issueCategory`:

- Priority: `#priority-high|medium|low`, `rdfs:subClassOf #Priority` (fixed, ordered).
- Labels: `#label-<slug>`, `rdfs:subClassOf #Label` (user-defined, declared on use).

An issue derives these IRIs from its own `wf:tracker` link. No IRIs are minted at
non-resolving domains — the classes live in a served pod document.

## Comments — `wf:message`
Per-issue comments are `wf:Message` fragments in the issue document, linked via
`wf:message`: `sioc:content` (body), `foaf:maker` (author), `dct:created`.

## Per-issue ACLs & assignee groups
- Sharing (`src/lib/sharing.ts`) now applies to any resource: a single issue
  document **or** the container (with `acl:default` so it cascades to all issues —
  this is how "share the tracker" works). Owner control is always preserved.
- The tracker carries an assignee **group** (`wf:assigneeGroup` → `vcard:Group` +
  `vcard:hasMember`). Issues can be assigned to the group, and a resource can be
  shared with it via `acl:agentGroup` (`setGroupAccess`).

## SHACL
`shapes/issue.ttl` ships anonymous SHACL node shapes (`wf:Task`, `wf:Message`,
and an `as:Announce` assignment-notification shape) over the reused IRIs.
`src/lib/shacl.test.ts` validates object-mapper output in CI (`rdf-validate-shacl`).
SHACL caught a real wrapper bug: `LiteralFrom.date` emits a malformed `xsd:date`
(dateTime lexical), so `wf:dateDue` is stored as `xsd:dateTime`.

The `wf:Task` shape constrains state (the `wf:Open`/`wf:Closed` `rdf:type` classes,
since the literal `wf:state` was replaced) via a `sh:qualifiedValueShape`
`[ sh:in ( wf:Open wf:Closed ) ]` with `sh:qualifiedMinCount 1` (at least one) and
`sh:qualifiedMaxCount 1` (at most one), enforcing exactly-one-of {Open, Closed} at
`sh:Warning` severity. SHACL **Core** *can* express this Open-XOR-Closed
exclusivity on a single `rdf:type` path via `sh:qualifiedMaxCount 1`; a node typed
with both `wf:Open` and `wf:Closed` is rejected by the shape. (What Core cannot
express is cross-path conditionals — none are needed here.) Severity stays Warning
because `Issue.state` already guarantees exclusivity at write time (it deletes the
opposite class), and Warning lets read-path callers of untrusted/mid-migration data
decide their own escalation policy. Issue↔issue links are constrained to IRIs:
`dct:isPartOf` (parent / Monday subitem), `dct:requires` (blocked-by),
`dct:relation` (symmetric relates-to), `dct:isReplacedBy` (close-as-duplicate /
supersession, `sh:maxCount 1`) and `prov:wasDerivedFrom` (clone source,
`sh:maxCount 1`); `wf:assignee` is constrained to an `^https?://` IRI.

## Jira/Monday parity (F2/F5/F6/F8)

No new surface — all four reuse the model above:

- **F2 link types** — typed issue↔issue links via the IRI-valued predicates above.
  `src/lib/rollups.ts#linksOf` derives the bidirectional view (A `dct:requires` B ⇒
  B blocks A; `dct:relation` is symmetric; `dct:isReplacedBy`/`prov:wasDerivedFrom`
  surface their inverses as duplicated-by / clones).
- **F5 issue-type levels** — the `#type-*` class dimension extends to a six-level
  hierarchy (Initiative → Epic → Feature → Story → Task/Bug, see `issue.ts`
  `typeLevel`/`canNest`); `canNest` requires a parent strictly coarser than its
  child, so a leaf (task/bug) never parents.
- **F6 subitems / rollups** — `dct:isPartOf` is already recursive; `rollups.ts`
  derives sum/min/max + done/total over the transitive subtree (cycle-safe — a
  `seen` set short-circuits A⊂B⊂A). Nothing new is written to the pod.
- **F8 bulk ops** — the list-view selection toolbar batches close/reopen/delete
  **+ assign + label** through one `useIssues.batch` boundary.

## Trade-offs / deferred
- Listing is N+1 fetches (container + each issue) — fine at this scale; a pod
  SPARQL endpoint would be the scale answer.
- SHACL validation runs in CI, not in the browser bundle (keeps it lean).
- Future: label management UI (rename/delete), saved filters, notifications-driven
  live sync.
