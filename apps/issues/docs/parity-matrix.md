# Feature-parity matrix — Jira / Monday.com

Working inventory driving development, compiled 2026-06-10 from
[Atlassian's Jira feature pages](https://www.atlassian.com/software/jira/features),
[Jira reviews](https://thedigitalprojectmanager.com/tools/jira-review/)
([Capterra](https://www.capterra.com/p/19319/JIRA/),
[TaskRhino](https://www.taskrhino.ca/blog/jira-review/)),
and [Monday.com](https://monday.com/) overviews
([Certum](https://www.certumsolutions.com/library/monday-work-management-overview),
[Everhour](https://everhour.com/blog/monday-board/),
[G2](https://learn.g2.com/monday-review)).

Status: ✅ shipped · 🔶 partial · ⏳ queued (priority order) · ◻ later/assess.

## Tier 1 — core issue tracking

| Feature (Jira/Monday) | Status | Notes |
|---|---|---|
| Issues with status workflow (To Do/In Progress/Done) | ✅ | per-tracker status classes |
| **Configurable workflows (custom states + allowed transitions)** | ✅ | F1: a tracker declares its workflow as `#status-*` `wf:State` classes with `wf:allowedTransitions` edges and `schema:position` ordering; every state resolves (`rdfs:subClassOf wf:Open\|wf:Closed`) so the issue model + SHACL exactly-one-state rule are unchanged; `Repository.setStatus`/`update` enforce the transition rules (`TransitionError`) |
| **Activity history / audit trail (immutable)** | ✅ | F3: append-only PROV-O log (`prov:Activity` + `prov:startedAtTime` / `prov:wasAssociatedWith` actor / `prov:used` → `prov:generated`) for status, assignment, and link changes, paginated into a sibling `activity/` container; surfaced in the issue-detail timeline |
| Kanban board, drag-and-drop | ✅ | labeled view tabs (persisted), per-column add, drop highlight |
| List/table view | ✅ | |
| Priorities, labels/tags, due dates | ✅ | |
| **Issue-type hierarchy (Initiative → Epic → Feature → Story → Task / Bug)** | ✅ | six `#type-*` levels; `typeLevel`/`canNest` enforce strictly-coarser-parent nesting; colored type badges |
| **Epics + progress roll-up (epic view)** | ✅ | Epics tab: per-epic progress bars, expandable children, add-to-epic |
| Sub-tasks & dependencies + typed links | ✅ | parent (`dct:isPartOf`, recursive subitems w/ cycle-safe rollups), blocked-by (`dct:requires`), relates-to (`dct:relation`, symmetric), duplicate-of (`dct:isReplacedBy`), cloned-from (`prov:wasDerivedFrom`); bidirectional display |
| Comments, @mentions, attachments, activity log | ✅ | |
| **People as profiles (name/avatar), not raw IDs** | ✅ | profile cache + PersonChip/Avatar across cards, detail, team, sharing |
| Search, filters, saved views | ✅ | |
| Bulk edit | ✅ | close / reopen / delete / assign / label, batched per selection |
| Real-time collaboration | ✅ | notifications + polling fallback |
| Permissions / sharing | ✅ | WAC/ACP, per-issue + tracker, teams |

## Tier 2 — agile planning (next)

| Feature | Status | Notes |
|---|---|---|
| Backlog view (ranked) | ✅ | Backlog tab; rank via `schema:position` (fractional re-rank); sprint sections + points totals |
| Sprints (create, scope, start/complete) | ✅ | `schema:Event` fragments in tracker.ttl, membership via `wf:task`; lifecycle from dates |
| Story points / estimates | ✅ | `dct:extent`; form field, badges, per-sprint/backlog totals |
| Timeline / Gantt view | ✅ | epics-first Gantt rows, month axis, status-colored bars |
| Calendar view | ✅ | month grid with navigation; due issues as chips |

## Tier 3 — insights & automation

| Feature | Status | Notes |
|---|---|---|
| Dashboards (charts: status/assignee/priority distribution) | ✅ | Dashboard tab: stat cards, status donut, type/priority bars, workload, created-per-week |
| Reports: velocity | ✅ | done vs committed points per completed sprint (commitment snapshotted at completion) |
| Reports: burndown, cumulative flow | ✅ | issues stamp `prov:endedAtTime` on completion; burndown charts estimated points per sprint day vs ideal (committed-points snapshot for done sprints); CFD is currently a two-band open/done flow. F3 now records per-status transition history (the `prov:Activity` log), which unblocks a three-band CFD that replays it — that consumer is tracked as follow-up (it fans out a log read per issue) |
| Automation rules (when X then Y) | ✅ | built-in client-side rules with toggles (close-parent, escalate-overdue); per-device |
| Custom fields / column types | ✅ | text / number / date / link / select; fields are `rdf:Property` fragments of the tracker config, select options are SKOS concepts; typed inputs in the form, formatted in detail view |
| Workload view (Monday) | ✅ | per-assignee open points bucketed by due week (Overdue / weeks / Later / No date), adjustable points-per-week capacity with overload flags; unestimated issues weigh 1 point |
| JQL-style query language | ✅ | `key:value` tokens in the search box (`status:` `p:` `type:` `label:` `assignee:` `due:` `points:` `has:` `sort:` + free text), case-insensitive, ANDed with the menu filters (`is:`/`state:` and `sort:` override the state tab / sort dropdown); client-side over the loaded issues (pod SPARQL later) |
| Workspaces / multiple boards per project | ✅ | project switcher; each project a self-contained tracker (`issue-tracker/<slug>/`), type-index discovered, per-project sharing |
| Integrations / marketplace, mobile apps | ◻ | out of scope for now |

## Explicitly not parity goals
Server-administered enterprise schemes (permission schemes, audit log exports),
Atlassian-ecosystem integrations, and native mobile apps.
