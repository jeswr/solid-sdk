# 0005 — F1 configurable workflows + F3 provenance history

**Status:** accepted · **Date:** 2026-06-15

Jira/Monday parity items F1 (per-tracker custom workflows) and F3 (an immutable
activity history). Both reuse published, dereferenceable vocabularies — no minted
terms (`docs/data-modelling.md`), all RDF through the typed `@rdfjs/wrapper`
accessors (never hand-built triples).

## F1 — configurable workflows (the W3C workflow FSM)

The status dimension was a hard-coded `STATUSES` list (`todo/in-progress/done`).
It is now declared **per tracker** as a finite-state machine using the W3C
workflow ontology's own FSM terms (the ontology explicitly models this — it has
`wf:State`, `wf:NonTerminalState`/`wf:TerminalState`, `wf:initialState`,
`wf:allowedTransitions`, `wf:Transition`):

- Each status is a `#status-<slug>` class typed `rdfs:Class, wf:State`, with an
  `rdfs:label`, a `schema:position` (the declared column order; same predicate as
  issue rank), and `wf:allowedTransitions` → the set of reachable target state
  IRIs (the FSM edges). `wf:initialState` points at the first status.
- **Resolution is the load-bearing invariant.** Every custom state carries
  `rdfs:subClassOf wf:Open | wf:Closed` — terminal ⇒ `wf:Closed`, else `wf:Open`.
  So an arbitrary workflow (Backlog → In Progress → In Review → Done) still maps
  cleanly onto the binary open/closed disposition every existing consumer (filters,
  dashboards, the `wf:Open`/`wf:Closed` `rdf:type` on the task, the SHACL
  exactly-one-state rule) depends on. The issue is still typed with the concrete
  `wf:Open`/`wf:Closed` class (not just the subclass) so SHACL Core validates the
  state without an OWL reasoner.
- `Issue.status` reads the status off the `#status-` prefixed `rdf:type`
  (workflow-agnostic — no slug list needed at read time), mirroring how labels are
  read. `Issue.setStatus(slug, terminal)` takes the resolution from the tracker's
  workflow.
- Transition rules are enforced at the write boundary: `Repository.setStatus` /
  `update` reject a move not in the source state's `wf:allowedTransitions` with a
  `TransitionError` (same-status re-asserts are always allowed). `StatusSlug` is
  now `string` (any declared slug), and the issue form / board / detail render the
  tracker's configured statuses.

The default tracker still ships the `DEFAULT_WORKFLOW` (To Do → In Progress →
Done), so existing trackers are unchanged.

## F3 — provenance history (PROV-O, append-only)

An immutable activity log records every state transition, assignment change, and
duplicate-link change, using PROV-O (W3C REC):

- Each entry is a `prov:Activity` with `prov:startedAtTime` (when),
  `prov:wasAssociatedWith` (the actor WebID), `dct:type` (the change kind:
  `status` / `assignment` / `link`), and `prov:used` → `prov:generated` (the prior
  and new value — a status-class IRI, a WebID, or an issue IRI).
- **Append-only.** The writer only ever adds a fresh `prov:Activity` node; it never
  mutates or deletes an existing one. Each `Repository` mutation snapshots the
  before-value, applies the change to the issue, writes the issue, then appends the
  entry (so the log never gets ahead of the issue). Logging is best-effort — a log
  failure never fails the user's primary mutation.
- **Pagination.** Logs live in a sibling `activity/` container, one stem per issue
  (`<activity>/<issue-uuid>.ttl`, rolling over to `.<n>.ttl` at
  `ACTIVITY_PAGE_SIZE` entries) so no single document grows without bound. The
  reader walks pages until a 404 and merges newest-first.
- Surfaced in the issue-detail timeline alongside creation and comments, with
  human labels resolved from the workflow (status names), `allIssues` (issue
  titles), and the actor WebID.

## SHACL

`shapes/issue.ttl` gains two shapes over the reused IRIs:

- `wf:State` — `rdfs:label` (≤1), `wf:allowedTransitions` (IRIs), and the
  resolution constraint: `rdfs:subClassOf` must include **exactly one** of
  {`wf:Open`, `wf:Closed`} (the same `sh:qualifiedValueShape [ sh:in (…) ]` +
  `qualifiedMin/MaxCount 1` pattern as the task-state shape). A status that
  resolves to neither, or to both, is non-conformant.
- `prov:Activity` — required `prov:startedAtTime` (dateTime), `prov:wasAssociatedWith`
  (an `^https?://` IRI), `prov:used`/`prov:generated` (IRIs, ≤1), `dct:type` (string).

## Follow-up

- A three-band cumulative-flow chart can now replay the F3 log to split the
  in-progress band out of the open/done flow (`computeCumulativeFlow` today reads
  only the loaded `IssueRecord`s). The consumer is deferred — it fans out a log
  read per issue.
- Federating the activity log across pods (a cross-pod audit trail) needs the
  O1-gated federation `@context`; out of scope here.
