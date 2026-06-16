# @jeswr/solid-task-model

> The **shared federated Task/Issue RDF model** for the Solid app suite — one
> model that every app reads and writes, so a task created in **solid-issues**
> shows up as "assigned to me" in the **Pod Manager** (and vice-versa).

This is the linchpin of the data-federation initiative. It is a small, dependency-light
package: a documented RDF vocabulary, typed read/write accessors, and a SHACL shape —
nothing app-specific. Apps depend on it for the *data contract*; the discovery, trust,
and provenance machinery (e.g. the Pod Manager's `federation-tasks.ts` "assigned to me"
gate) lives in the consumers.

## Why one model

`wf:Task` written by one app is only useful to another if both agree on **which
predicates carry which fields**. The two existing producers —
[`jeswr/solid-issues`](https://github.com/jeswr/solid-issues) and
[`jeswr/solid-pod-manager`](https://github.com/jeswr/solid-pod-manager) — independently
converged on `wf:Task` + Dublin Core + `rdf:type wf:Open/wf:Closed`. This package is
their **common denominator**, extracted so they (and every future pod-app) share exactly
one definition instead of three drifting copies.

## The vocabulary (reused, dereferenceable terms only)

Per [ADR-0013](https://github.com/jeswr/prod-solid-server/blob/main/decisions/0013-federation-namespace-suite-scope-pm-canonical.md)
(federation namespace) and the
[R9 data-federation recommendation](https://github.com/jeswr/full-solid-ecosystem)
(reuse `wf`/flow, iCal VTODO, schema.org, AS2), the model mints **nothing** — every term
is an established, dereferenceable IRI:

| Field | Predicate | Vocabulary |
|---|---|---|
| class | `rdf:type wf:Task` | W3C SolidOS workflow ontology (`wf:`) |
| state | `rdf:type wf:Open` / `wf:Closed` | `wf:` (the SolidOS open/closed model) |
| title | `dct:title` | Dublin Core Terms |
| description | `wf:description` **+** `dct:description` | `wf:` / Dublin Core (see note) |
| created / modified | `dct:created` / `dct:modified` | Dublin Core Terms |
| completed | `prov:endedAtTime` | W3C PROV-O (written on close) |
| creator | `dct:creator` (WebID) | Dublin Core Terms |
| assignee | `wf:assignee` (WebID) | `wf:` |
| project / tracker | `wf:tracker` | `wf:` |
| due date | `wf:dateDue` | `wf:` |
| priority | `schema:priority` | schema.org |
| rank / order | `schema:position` | schema.org |
| parent | `dct:isPartOf` | Dublin Core Terms |
| blocked-by | `dct:requires` | Dublin Core Terms |
| relates-to | `dct:relation` | Dublin Core Terms |
| duplicate-of | `dct:isReplacedBy` | Dublin Core Terms |
| cloned-from | `prov:wasDerivedFrom` | W3C PROV-O |

> **Note on `description`.** The two existing producers diverged — solid-issues writes
> `wf:description`, the Pod Manager writes `dct:description`. The model therefore reads
> *both* (preferring `wf:description`) and writes *both*, and the SHACL shape constrains
> both, so neither producer's body is dropped on a cross-app read. Once apps adopt this
> package they converge on the pair.
>
> **Note on `wf:Open`/`wf:Closed`.** The wire state is binary so it federates cleanly —
> any consumer maps a task to open or closed. An app-local "in-progress" band (the Pod
> Manager carries one as an extra producer-scoped `rdf:type` subclass) is a *refinement*,
> not part of the shared model: a foreign consumer still reads `wf:Open` → open and is
> correct.

## The tracker (`wf:Tracker`) — the federation-core of a SolidOS issue tracker

A `wf:Task` points at its tracker via `wf:tracker` (`Task.project`); a `wf:Tracker` is the
entity on the other end. `@jeswr/solid-task-model/tracker` carries the **federation-core**
of solid-issues' own `Tracker` so the Pod Manager and solid-issues share ONE tracker model
— a tracker created in one is a valid, fully-readable SolidOS issue tracker in the others.
App-specific surface (priority/label/type category classes, custom fields, saved views,
sprints, the activity log) stays in the consuming app.

| Field | Predicate | Vocabulary |
|---|---|---|
| class | `rdf:type wf:Tracker` | `wf:` |
| title | `dct:title` | Dublin Core Terms |
| issue class | `wf:issueClass` (defaults to `wf:Task`) | `wf:` |
| state store | `wf:stateStore` (where issue resources live) | `wf:` |
| categories | `wf:issueCategory` (dimension class IRIs) | `wf:` |
| workflow status | `wf:State` `#status-*` `rdfs:subClassOf wf:Open`/`wf:Closed` | `wf:` |
| initial status | `wf:initialState` | `wf:` |
| transitions | `wf:allowedTransitions` | `wf:` |
| assignee group | `wf:assigneeGroup` → `vcard:Group` / `vcard:hasMember` | `wf:` / vCard |

> **SolidOS-readable by construction.** The SolidOS issue pane *throws* when a tracker is
> missing `wf:issueClass`, so `buildTracker` always writes `wf:issueClass wf:Task`, a
> `wf:initialState`, and (optionally) `wf:stateStore` — exactly the triples SolidOS needs.
>
> **The tracker subject is `#this`, NOT `#it`.** A task roots at `${url}#it`
> (`taskSubject`); a tracker roots at `${docUrl}#this` (`trackerSubject`). The two fragments
> are intentionally distinct — both match the existing producers — so don't unify them, or a
> cross-app read silently misses the subject.

```ts
import {
  buildTracker,
  parseTracker,
  parseTrackerTtl,
  serializeTracker,
  trackerSubject,
  DEFAULT_WORKFLOW,
  canTransition,
  statusState,
  type TrackerData,
  type WorkflowDef,
} from "@jeswr/solid-task-model/tracker"; // client-safe subpath (no node:fs)

// Build + serialise a tracker (n3.Writer under the hood — never hand-built RDF).
const ttl = await serializeTracker("https://alice.pod/issues/tracker.ttl", {
  title: "Alice's Issues",
  stateStore: "https://alice.pod/issues/",
  groupMembers: ["https://bob.pod/profile/card#me"],
});

// Parse a fetched body (Turtle or JSON-LD, dispatched via @jeswr/fetch-rdf).
const tracker: TrackerData | undefined = await parseTrackerTtl(url, body, contentType);
```

The runtime `Tracker` accessor (incremental edits) and the workflow helpers
(`WorkflowDef` / `DEFAULT_WORKFLOW` / `canTransition` / `statusState`) are exported from both
the barrel (`.`) and the **client-safe `./tracker` subpath** — import from `./tracker` (like
`./task`) inside client components, since the barrel re-exports the `node:fs`-using
`trackerShapeTtl`. The tracker SHACL shape is `shapes/tracker.ttl`, also a string via
`trackerShapeTtl()`.

## Usage

```ts
import {
  buildTask,
  parseTask,
  parseTaskTtl,
  serializeTask,
  taskShapeTtl,
  type TaskData,
} from "@jeswr/solid-task-model";

// Build + serialise (n3.Writer under the hood — never hand-concatenated RDF).
const ttl = await serializeTask("https://alice.pod/issues/x", {
  title: "Add OAuth login",
  state: "open",
  assignee: "https://bob.pod/profile/card#me",
  dueDate: new Date("2026-07-01"),
});

// Parse a fetched body (Turtle or JSON-LD, dispatched via @jeswr/fetch-rdf).
const task: TaskData | undefined = await parseTaskTtl(url, body, contentType);

// Or parse an already-fetched dataset (e.g. from @jeswr/fetch-rdf's fetchRdf).
const fromDataset = parseTask(url, dataset);
```

### Typed accessors

For incremental edits (set one field on an existing graph), use the `Task` wrapper —
the same `@rdfjs/wrapper` pattern the apps already use:

```ts
import { Task, taskSubject } from "@jeswr/solid-task-model";
import { DataFactory, Store } from "n3";

const store = new Store(/* parsed from the pod */);
const task = new Task(taskSubject(url), store, DataFactory);
task.state = "closed";        // sets wf:Closed + prov:endedAtTime
task.assignee = myWebId;       // wf:assignee
```

#### Browser/client bundles: import from `./task`

The main entry (`.`) re-exports `taskShapeTtl`, which reads the shape file via
`node:fs` — fine on the server, but a **client bundler** (Next.js / Turbopack)
cannot bundle `node:fs` into a browser chunk, so importing `Task` from `.` inside a
client component fails (`the chunking context does not support external modules
(request: node:fs)`). Import the runtime model from the **`./task` subpath**, which
never touches `node:fs`:

```ts
import { Task, parseTask, buildTask, type TaskData } from "@jeswr/solid-task-model/task";
```

The `./shape` subpath (`taskShapeTtl` / `TASK_SHAPE_PATH`) is the `node:fs`-using
half — keep it on server-only / test code, never a client component.

### SHACL validation

The canonical shape is `shapes/task.ttl` (also exported as a string via `taskShapeTtl()`).
Validate with whatever SHACL engine you depend on — the suite uses `rdf-validate-shacl`:

```ts
import env from "@zazuko/env-node";
import { Parser } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { taskShapeTtl } from "@jeswr/solid-task-model";

const toDs = (quads) => { const ds = env.dataset(); for (const q of quads) ds.add(q); return ds; };
const shapes = toDs(new Parser().parse(taskShapeTtl()));
const report = new SHACLValidator(shapes, { factory: env }).validate(toDs(dataQuads));
```

## Install (GitHub, no build step)

`dist/` is **committed**, so under the suite's `ignore-scripts=true` policy the package
installs and imports with no build step:

```sh
npm install github:jeswr/solid-task-model#main
```

> Because `dist/` is committed it can drift from `src/`. The `check:dist` gate
> (`npm run check:dist`) rebuilds into a temp dir and diffs — so **any `src/` change must
> rebuild + commit `dist/` in the same change**. npm publish is a deferred migration, not
> a blocker (consume via the `github:` dep now).

## Develop

```sh
npm run gate   # lint (Biome) + typecheck (tsc) + test (vitest) + build + check:dist
```

Authored by Claude Opus 4.8 (Fable unavailable). See commit trailers / `AUTHORED-BY`
markers.
