# Phase 2 — top-5 productivity tools on Solid

The standing goal after Jira/Monday parity (done — see `parity-matrix.md`): implement the
top five other most-used productivity tools to the same feature parity as their
competitors. All built on the same stack and conventions as the tracker (AGENTS.md),
data in the user's pod, vocabularies chosen per `data-modelling.md`.

Candidate set (most-used tools whose jobs the tracker does **not** already cover),
in build order:

| # | Tool archetype | Competitor bar | Solid shape | Notes |
|---|---|---|---|---|
| 1 | Notes / docs / wiki | Notion, Evernote | block documents in pod containers; type-index discovery; cross-doc links | Highest distinct value; reuse tracker's sharing + design system |
| 2 | Personal tasks | Todoist, TickTick | lightweight task lists, quick-add grammar, recurring rules, today/upcoming views | Can share the `wf:`+`dct:` model; separate app surface, not tracker views |
| 3 | Team chat | Slack | channels as pod resources; SolidOS LongChat vocab (`meeting:LongChat`, `sioc`/`flow` messages) for interop | Live-sync via solid-notifications skill |
| 4 | Calendar / scheduling | Google Calendar, Calendly | events + availability + booking links; RDF calendar (`schema:Event`, iCal vocab) | Tracker due dates / sprints feed in |
| 5 | Spreadsheet-ish databases | Airtable | typed tables = custom-field machinery generalised beyond issues; views (grid/kanban/calendar) over arbitrary rows | Largest reuse of existing field/SKOS code |

Sequencing rationale: each row reuses progressively more of what exists; chat (3)
depends on the notifications skill; databases (5) generalise the custom-fields layer
once it has survived two more consumers.

Definition of done per tool: parity matrix authored first (like `parity-matrix.md`),
test-first features against live CSS, the shared ink-and-paper design language,
design-guidelines + responsive (375/768/1280) + light/dark verification, roborev clean.

Open question for each tool: same repo (suite with an app switcher) vs sibling repo.
Default: sibling repo per tool, shared conventions copied from here — keeps test
suites and deploys independent; revisit if a shared design package emerges.
