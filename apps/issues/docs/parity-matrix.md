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
| Kanban board, drag-and-drop | ✅ | labeled view tabs (persisted), per-column add, drop highlight |
| List/table view | ✅ | |
| Priorities, labels/tags, due dates | ✅ | |
| **Issue types (Epic / Story / Task / Bug)** | ✅ | type dimension via `wf:issueCategory`; colored type badges |
| **Epics + progress roll-up (epic view)** | ✅ | Epics tab: per-epic progress bars, expandable children, add-to-epic |
| Sub-tasks & dependencies (blocked-by) | ✅ | |
| Comments, @mentions, attachments, activity log | ✅ | |
| **People as profiles (name/avatar), not raw IDs** | ✅ | profile cache + PersonChip/Avatar across cards, detail, team, sharing |
| Search, filters, saved views | ✅ | |
| Bulk edit | ✅ | close/reopen/delete; extend to assign/label later |
| Real-time collaboration | ✅ | notifications + polling fallback |
| Permissions / sharing | ✅ | WAC/ACP, per-issue + tracker, teams |

## Tier 2 — agile planning (next)

| Feature | Status | Notes |
|---|---|---|
| Backlog view (ranked, drag to reorder) | ⏳ | needs an ordering predicate |
| Sprints (create, scope, start/complete) | ⏳ | sprint as a resource; issues link to sprint |
| Story points / estimates | ⏳ | numeric estimate field |
| Timeline / Gantt view | ⏳ | from created/due dates + epics |
| Calendar view | ⏳ | due-date month grid |

## Tier 3 — insights & automation

| Feature | Status | Notes |
|---|---|---|
| Dashboards (charts: status/assignee/priority distribution) | ✅ | Dashboard tab: stat cards, status donut, type/priority bars, workload, created-per-week |
| Reports: burndown, velocity, cumulative flow | ◻ | needs sprint + history data |
| Automation rules (when X then Y) | ◻ | e.g. "when all sub-tasks done → close parent" |
| Custom fields / column types (Monday's 30+) | ◻ | RDF makes this natural; UI is the work |
| Workload view (Monday) | ◻ | per-assignee capacity |
| JQL-style query language | ◻ | SPARQL-backed, eventually |
| Workspaces / multiple boards per project | 🔶 | one tracker per pod today; multi-tracker later |
| Integrations / marketplace, mobile apps | ◻ | out of scope for now |

## Explicitly not parity goals
Server-administered enterprise schemes (permission schemes, audit log exports),
Atlassian-ecosystem integrations, and native mobile apps.
