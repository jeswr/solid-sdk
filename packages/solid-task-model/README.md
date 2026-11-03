<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-task-model

The shared browser-safe RDF model for tasks, issue trackers, and contacts across Solid apps.

## Install

```sh
npm install github:jeswr/solid-task-model#main
```

The package tooling requires Node.js 20 or newer; every runtime entry except `/shape` is
browser-safe.

## Minimal usage

```ts
import {
  parseTaskTtl,
  serializeTask,
  type TaskData,
} from "@jeswr/solid-task-model";

const resourceUrl = "https://alice.example/issues/42";
const turtle = await serializeTask(resourceUrl, {
  title: "Add OAuth login",
  state: "open",
  assignee: "https://bob.example/profile/card#me",
  dueDate: new Date("2026-08-01"),
});

const task: TaskData | undefined = await parseTaskTtl(resourceUrl, turtle, "text/turtle");
```

Pod data is untrusted. `buildTask` drops object-property values that are not absolute
http(s) IRIs, and `parseTask` applies the same scheme check on read: a `javascript:` or
`data:` creator, assignee, project, parent, duplicate-of, cloned-from, blocked-by or
relates-to IRI is left out, as is any value with characters an IRI cannot contain or
without the `//` after the scheme. Accepted IRIs come back exactly as stored, not
canonicalised. A malformed value, such as a literal where an IRI belongs or an invalid
date, drops only that value instead of aborting the parse; a single-valued IRI field
takes the first acceptable IRI among its values.

## Key API

- Tasks: `Task`, `TaskData`, `buildTask`, `parseTask`, `parseTaskTtl`, `serializeTask`,
  `sortTasks`.
- Trackers: `Tracker`, `TrackerData`, `buildTracker`, `parseTracker`, `serializeTracker`,
  `DEFAULT_WORKFLOW`, `canTransition`.
- Contacts: `ContactBook`, `Contact`, `ContactGroup`, plus build, parse, and serialise helpers for
  address books, people, groups, and their indexes.
- Vocabulary constants for `wf`, Dublin Core, PROV-O, schema.org, vCard, ACL, and RDF.
- Node-only SHACL helpers from `@jeswr/solid-task-model/shape`; browser-safe focused entries are
  available at `/task`, `/tracker`, and `/contacts`.
- Raw shapes: `/shapes/task.ttl`, `/shapes/tracker.ttl`, and `/shapes/contacts.ttl`.

Task state is the interoperable `wf:Open` or `wf:Closed` wire model. The serializers use
`n3.Writer`; callers should not construct RDF strings manually.

## Links

- [Source](https://github.com/jeswr/solid-task-model)
- [Issues](https://github.com/jeswr/solid-task-model/issues)
- [SHACL specification](https://www.w3.org/TR/shacl/)

## License

MIT © Jesse Wright
