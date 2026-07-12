# Pod Chat

> ⚠️ Experimental — AI-agent-generated (Claude Opus 4.8, @jeswr PSS agent); under active development, not production-hardened.

The typed RDF **data layer** for chat — **ActivityStreams 2.0** rooms and messages, with
*actionable* messages that double as cross-app tasks — stored in a [Solid](https://solidproject.org)
pod. One concrete app in the `@jeswr` Solid suite (ADR-0013: every app built in parallel),
federation-registry-ready via the [`fedapp:`](https://w3id.org/jeswr/fed) vocabulary.

This package is the **non-throwaway core**: a typed model over quads, read/write/list against a
Solid pod, type-index registration, and a `clientid.jsonld` that declares the app's federation
metadata. The full chat UI is a deliberate follow-up (see below).

## What it does

- **A typed chat model on ActivityStreams 2.0** (`src/room.ts`, `src/message.ts`). Pod Chat speaks
  the same vocabulary the wider social ecosystem (ActivityPub, Mastodon, the SolidOS chat pane)
  already speaks, so a room/message is interoperable rather than bespoke:
  - A **room** is an `as:Collection`, also typed `pc:ChatRoom`
    (`https://w3id.org/jeswr/pod-chat#ChatRoom` — the app's primary type-index class): `as:name`,
    `dct:created` / `dct:creator`, an `as:Person` node per `pc:participant`, and a forward
    `as:items` index over its message resources.
  - A **message** is an `as:Note`: `as:content` + `as:mediaType` (the body), `as:attributedTo`
    (author WebID), `as:published`, `as:context` (the room) and an optional `as:inReplyTo`.
- **Actionable messages — the shared cross-app task model** (`src/message.ts`). A "could you do X?"
  message can *also* be a tracked task: the SAME subject is typed `wf:Task` and carries the shared
  model from [`https://w3id.org/jeswr/task#`](https://w3id.org/jeswr/task) — a re-use of the
  SolidOS workflow ontology (`wf:`), Dublin Core (`dct:`) and ActivityStreams (`as:`), **not a new
  ontology**: `rdf:type wf:Open`/`wf:Closed` (lifecycle as a class, never a literal), `dct:title`,
  `wf:assignee`. Because it is BOTH an `as:Note` and a `wf:Task`, solid-issues / Pod Manager pick it
  up as a task with no Pod-Chat-specific code, and the chat UI still renders it as a message.
- **Pod CRUD + discovery** (`src/store.ts`). One resource per room under `pod-chat/rooms/`, one per
  message under `pod-chat/messages/`; the rooms container is registered in the user's **Type Index**
  (`solid:instanceContainer` for `pc:ChatRoom`) for cross-app discovery (e.g. a Pod Manager's "My
  data"). Every caller-supplied URL is scope-guarded (a confused-deputy defence) and writes are
  conditional (`If-Match` / `If-None-Match`) so a concurrent edit fails loudly instead of clobbering.
- **Federation metadata** (`clientid.jsonld`). The Client Identifier Document publishes the
  `fedapp:` block — `fedapp:App` over the `social` sector, `fedapp:produces` `pc:ChatRoom` +
  `as:Note`, `fedapp:consumes` those plus `wf:Task` (actionable messages) — so a federation registry
  can reason about it.

### RDF discipline

All RDF goes through the suite's sanctioned libraries — **never a bespoke parser**:

- [`@jeswr/fetch-rdf`](https://github.com/jeswr/fetch-rdf) to GET + parse (force-revalidated),
- [`@solid/object`](https://github.com/o-development/solid-object) (`ContainerDataset`) to read
  container listings,
- [`@rdfjs/wrapper`](https://github.com/rdfjs/wrapper) typed accessors to extract + build
  (never hand-built quads),
- `n3.Writer` to serialise.

## Install / use

```sh
npm install   # ignore-scripts=true (supply-chain hardening); see .npmrc
npm run gate  # lint + typecheck + coverage (100% lines/stmts/funcs) + build
```

```ts
import { createChatStore } from "@jeswr/pod-chat";

// In production pass NO fetchImpl — @solid/reactive-authentication patches the
// global fetch, so auth is automatic. Tests inject a fetch.
const store = createChatStore({ podRoot: "https://alice.pod/", webId });

// Create a room (registers pc:ChatRoom in the Type Index on first use).
const { url: room } = await store.createRoom({ name: "General", creator: webId });

// Post a plain message…
await store.postMessage({ content: "hello", author: webId, room: `${room}#it` });

// …or an actionable one that also shows up as a cross-app task.
await store.postMessage({
  content: "could you review the PR?",
  author: webId,
  room: `${room}#it`,
  task: { state: "open", title: "Review PR", assignee: bobWebId },
});

const rooms = await store.listRooms();
const messages = await store.listMessages();
```

## Tracked follow-ups

These are the deliberate next steps for Pod Chat — tracked, not bundled into this core:

- **Next.js UI via `create-solid-app`.** The browser app (room list + message thread + login,
  with live updates via `solid-notifications` WebSocketChannel2023) is built on `create-solid-app`
  once it lands — this package stays the headless data layer.
- **Cross-server E2E matrix.** A Playwright matrix exercising the data layer against every
  well-known Solid server — including **prod-solid-server with passkey AND username/password**,
  CSS (WAC + ACP), ESS and NSS — to ratchet real-server behaviour.
- **Coverage-ratchet gate.** Extend the unit coverage gate (here, 100% lines/statements/functions)
  into a CI ratchet that also tracks the cross-server matrix pass rate, so behaviour on every server
  only ever improves.
- **Sector-vocab ADR.** The `social` sector IRI under `https://w3id.org/jeswr/sectors/` is
  referenced ahead of that namespace being frozen; the freeze + a per-app sector mapping is its own
  decision record.

## License

MIT.

---

_Authored by Claude Opus 4.8 (the `@jeswr` PSS agent). Provenance is tracked for re-review /
upgrade when Fable returns._
