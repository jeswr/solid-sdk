# Solid Issues

An issue tracker where the data lives in **your own Solid Pod**, not a central
server. Sign in with your WebID; issues are read and written over authenticated
HTTP to a single document in your pod.

Built following the [`solid-ai-coding`](https://github.com/jeswr/solid-ai-coding)
guide (`AGENTS.md`).

## Stack

| Concern | Library |
|---|---|
| Browser auth (patched `fetch`, DPoP) | `@solid/reactive-authentication` + the issuer-from-profile `WebIdDPoPTokenProvider` (`src/lib/`) |
| Fetch + parse RDF | `@jeswr/fetch-rdf` |
| Typed Solid data access | `@solid/object` |
| Typed RDF wrappers (`Issue`, `Tracker`) | `@rdfjs/wrapper` |
| RDF terms / Turtle | `n3` |
| UI | Next.js (App Router) · Tailwind · shadcn/ui · react-hook-form + zod · sonner |

## Data model

Issues use the **W3C workflow ontology** `wf:`
(`http://www.w3.org/2005/01/wf/flow#`) + Dublin Core Terms — the SolidOS
issue-pane model, so the data interoperates with the wider ecosystem. State is
carried by `rdf:type` (`wf:Open` / `wf:Closed`). Rationale and the full mapping:
[`decisions/0001-issue-tracker-vocabulary.md`](./decisions/0001-issue-tracker-vocabulary.md).

Storage is **one document per issue** in an `issues/` container, beside a
`tracker.ttl` config document — so each issue can carry its own ACL. Priority and
labels are `wf:issueCategory` classes; comments are `wf:Message` (`sioc:content`)
fragments; the assignee group is a `vcard:Group`. Writes are conditional `PUT`s
(`If-Match`) per issue, so a concurrent edit surfaces as a recoverable conflict.
A SHACL shape (`shapes/issue.ttl`) validates the model in CI.

## Sharing & cross-pod (milestone 2)

- **Share** a tracker with another person by WebID (view or edit) — managed via
  Web Access Control, with ACP (Inrupt ESS) supported through the access-control
  converters. The owner always keeps control (fail-closed).
- **Discovery**: the tracker is registered in your **public type index** so others
  can find it; `resolveTracker(webId)` falls back to the conventional pod path.
- **Open another pod's tracker** by WebID; read-only access is detected from the
  `WAC-Allow` header and the UI adapts.
- See [`decisions/0002-sharing-and-discovery.md`](./decisions/0002-sharing-and-discovery.md).

## Priority, labels, comments, per-issue sharing & teams (milestone 3)

- **Priority** (high/medium/low) and **labels** on issues, shown as badges/chips
  and filterable.
- **Comments** thread per issue (`wf:Message`).
- **Per-issue access control**: share a single issue, or the whole tracker
  (the container cascades via `acl:default`), with named WebIDs.
- **Teams**: define a `vcard:Group` of members; assign issues to the team and
  grant the team access (`acl:agentGroup`).
- See [`decisions/0003-per-issue-documents-and-advanced-features.md`](./decisions/0003-per-issue-documents-and-advanced-features.md).

## Develop

```sh
npm install
npm run dev      # in-memory CSS on :3000, seeds alice/bob + prints creds, app on :3200
```

Open http://localhost:3200 and sign in with the printed WebID.

> **Port note:** the dev script and tests default to CSS on `:3000` (per the
> guide). If `:3000` is occupied, override the test port — the app uses an
> issuer-from-profile auth provider, so it is not tied to `:3000`:
> ```sh
> IT_CSS_PORT=3100 IT_CSS_BASE=http://localhost:3100 npm run test:e2e
> ```

## Test

```sh
npm run typecheck   # tsc --noEmit
npm test            # Vitest — data layer unit/integration (src/lib)
npm run test:e2e    # Playwright — golden path against a real local CSS (popup login)
npm run build       # next build
```

## Views & productivity

- **List and Kanban board** views; the board groups by **status** (To Do / In
  Progress / Done) or **priority**, with drag-and-drop between columns.
- **Workflow statuses** in addition to open/closed; status badges on every card.
- **Search** + **multi-facet filters** (priority / label / assignee / state) +
  **sort**; **saved views** to remember filter presets.
- **Bulk actions** — multi-select to close / reopen / delete many at once.
- **Command palette** (⌘K) and keyboard shortcuts (c, /, b, l).
- **Issue detail view**: metadata, description, activity timeline, **comments**
  with **@mentions**, **attachments**, and **sub-tasks / dependencies**
  (parent, blocked-by, blocking).
- **Real-time live-sync** — changes by collaborators (or another tab) appear
  without a reload (Solid Notifications, with a polling fallback).
- **Dark mode** (system / light / dark), responsive, overdue highlighting.

## Roadmap (future)

A pod SPARQL endpoint to replace the N+1 listing fetches; richer custom workflows.
