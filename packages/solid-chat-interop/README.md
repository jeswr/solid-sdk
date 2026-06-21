<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate. -->
# @jeswr/solid-chat-interop

A chat/conversation **interop reconciler** for the Solid app suite. It maps between
the suite's three chat shapes through a single canonical hub:

- **ActivityStreams 2.0** — the suite's **canonical write model** (exactly what
  [`@jeswr/pod-chat`](https://github.com/jeswr/pod-chat) produces:
  `as:Note` / `as:Collection` / `as:attributedTo` / `as:published` /
  `as:inReplyTo` / `as:mediaType`, with the actionable `wf:Task` overlay).
- **SolidOS `meeting:LongChat`** — the **installed-base read** shape
  (`sioc:content` / `foaf:maker` / `dct:created`, `dct:isReplacedBy` edits,
  `schema:dateDeleted` deletes).
- **External schemas** via a tiny **adapter seam**, with one concrete
  **LibreChat** adapter as proof.

It is a **pure-RDF, non-server-touching** library: it reads/writes RDF in memory
and serialises Turtle/JSON-LD — it never opens a socket. Reads parse with
[`@jeswr/fetch-rdf`](https://github.com/jeswr/fetch-rdf)'s `parseRdf`; writes go
through typed [`@rdfjs/wrapper`](https://www.npmjs.com/package/@rdfjs/wrapper)
accessors and `n3.Writer`. **It mints no new chat predicate** — it reuses
`pc:ChatRoom` (pod-chat) and the
[`@jeswr/solid-task-model`](https://github.com/jeswr/solid-task-model) `wf:Task`
shape, so an actionable chat message is the **same** task `solid-issues` / the Pod
Manager already read.

## Why a reconciler, not a fourth dialect

The suite already speaks three chat shapes (AS2.0, SolidOS LongChat, the Pod
Manager's sioc append-log). Dumping a foreign tool's export verbatim into a pod
gives opaque, non-RDF, non-WebID, un-mergeable data — the
"non-interoperable engineer" failure. This package **reconciles** the existing
shapes through one canonical hub and exposes a documented mapping, so chat from any
source lands as the shape the rest of the suite reads.

## Install

GitHub-installable now (committed `dist/`, `ignore-scripts=true` — no build step):

```bash
npm install github:jeswr/solid-chat-interop#main
```

(npm publish is a deferred migration; consume via GitHub for now.)

## Quick start

```ts
import {
  parseAs2,
  serializeLongChat,
  LibreChatAdapter,
  type CanonicalMessage,
} from "@jeswr/solid-chat-interop";

// 1) Read an AS2.0 chat message (e.g. a pod-chat resource) into the canonical model.
const subject = "https://alice.example/chat/room1/msg1.ttl#it";
const canonical = await parseAs2(
  "https://alice.example/chat/room1/msg1.ttl",
  turtleBody,            // the raw response body
  "text/turtle",         // Response.headers.get("content-type") (null ⇒ text/turtle)
);

// 2) Write the SAME message in the SolidOS LongChat shape (sioc:Note + as:Note + schema:Message).
const longChatTurtle = await serializeLongChat(canonical!, subject);

// 3) Import a LibreChat message → the canonical model (then write either shape).
const adapter = new LibreChatAdapter({
  humanWebId: "https://alice.example/profile/card#me",
  agentWebId: "https://agents.example/assistant#me",
  roomBaseIri: "https://alice.example/chat/librechat/",
});
const fromLibreChat: CanonicalMessage = adapter.toCanonical({
  text: "What is Solid?",
  createdAt: "2026-06-20T09:00:00.000Z",
  isCreatedByUser: true,
  conversationId: "conv-123",
});
```

## The canonical model

```ts
interface CanonicalMessage {
  id?: string;             // the message subject/resource IRI, when known
  content: string;         // body text
  mediaType: string;       // body content type (default text/plain)
  author?: string;         // human author WebID (IRI)
  published?: string;      // ISO-8601 timestamp
  room?: string;           // the room/thread (IRI)
  inReplyTo?: string;      // reply target (IRI)
  replacedBy?: string;     // edit pointer — the resource that supersedes this (IRI)
  deletedAt?: string;      // soft-delete tombstone (ISO-8601)
  provenance?: MessageProvenance; // AI / external-source attribution (PROV-O)
  task?: MessageTask;      // the wf:Task actionable overlay
}

interface MessageProvenance {
  attributedTo?: string;   // prov:wasAttributedTo — the agent (e.g. AI agent WebID)
  generatedBy?: string;    // prov:wasGeneratedBy — the model/endpoint IRI
  derivedFrom?: string;    // prov:wasDerivedFrom — the source IRI
}

interface MessageTask {    // identical to pod-chat's actionable overlay
  state: "open" | "closed";
  title?: string;
  assignee?: string;       // wf:assignee WebID
}

interface CanonicalRoom {
  id?: string; name?: string; created?: string; creator?: string;
  messages?: CanonicalMessage[];
}
```

## The full mapping table

This is the documented interop contract, also exported as data (`MAPPING_TABLE`).

| Canonical field | ActivityStreams 2.0 | SolidOS LongChat | LibreChat |
|---|---|---|---|
| `content` | `as:content` | `sioc:content` | `text` |
| `mediaType` | `as:mediaType` | — (no per-message type; default `text/plain`) | — (always `text/plain`) |
| `author` (human WebID) | `as:attributedTo` | `foaf:maker` | `sender`/user → configured `humanWebId` |
| `published` | `as:published` | `dct:created` | `createdAt` |
| `room` | `as:context` | — (room = the message's container) | `conversationId` (under `roomBaseIri`) |
| `inReplyTo` | `as:inReplyTo` | `as:inReplyTo` + `sioc:has_reply` | `parentMessageId` (under `roomBaseIri`) |
| `replacedBy` (edit) | `dct:isReplacedBy` | `dct:isReplacedBy` | — |
| `deletedAt` (delete) | `schema:dateDeleted` | `schema:dateDeleted` | — |
| `provenance.attributedTo` | `prov:wasAttributedTo` | `prov:wasAttributedTo` | AI: configured `agentWebId` |
| `provenance.generatedBy` | `prov:wasGeneratedBy` | `prov:wasGeneratedBy` | AI: `model`/`endpoint` (via `resolveModelIri`) |
| `provenance.derivedFrom` | `prov:wasDerivedFrom` | `prov:wasDerivedFrom` | — |
| `task` | `rdf:type wf:Task` + `wf:Open`/`wf:Closed` (+ `dct:title`) | same | — |
| `task.assignee` | `wf:assignee` | `wf:assignee` | — |

Notes:
- **`room`** is AS2.0-only as a triple; SolidOS LongChat models the room by the
  message's *container*, so a LongChat round-trip does not carry it as a triple.
- **`inReplyTo`** is written in both `as:inReplyTo` and `sioc:has_reply` forms on
  the LongChat shape so either reader finds it.
- The **`wf:Task` overlay** is the unchanged `@jeswr/solid-task-model` shape — an
  actionable chat message is genuinely the same task `solid-issues` / PM read.
- **LibreChat private fields** (`_id`, `__v`, `tokenCount`, `error`, `files`,
  `finish_reason`, raw endpoint internals, …) never leak into the canonical model.

## The SHACL shape — `./shape`

The package ships a SHACL `NodeShape` (`shapes/message.shacl.ttl`) for the
canonical message model. Its `sh:targetClass` is `as:Note` (the canonical message
class `parseAs2Message` keys on), and its property paths are the **exact**
predicates `As2MessageDoc` reads and writes — so a message round-tripped through
this package is shape-conformant by construction. It covers the fields a message
component renders (**author**, **content** as text, **timestamp**, **inReplyTo**)
plus the full canonicalised AS2.0 + LongChat surface (room, edit pointer,
soft-delete tombstone, PROV-O provenance, and the `wf:Task` actionable overlay).

This shape **drives the codegen framework's shape-driven message components**
(`jeswr-message-list`, `jeswr-shacl-view` / `jeswr-shacl-form`): the components
render a chat message *from its shape* rather than from hand-written field code, so
the rendered fields stay in lock-step with the canonical chat model. It is also a
validator for untrusted foreign chat data (feed it to `rdf-validate-shacl` or any
SHACL engine).

```ts
import { messageShapeTtl, MESSAGE_SHAPE_PATH } from "@jeswr/solid-chat-interop/shape";

const shapeTurtle = messageShapeTtl();   // the shape as a Turtle string
// MESSAGE_SHAPE_PATH — filesystem path to shapes/message.shacl.ttl
```

The `.ttl` is also resolvable directly as a package subpath:
`@jeswr/solid-chat-interop/shapes/message.shacl.ttl`. The shape is **anonymous**
(a blank node) — like the sibling `@jeswr/solid-task-model` shapes, it mints
nothing at a non-resolving domain. Mirrors that package's `./shape` export exactly.

## Public API

### The reconciler

- **Dataset-level** (you already have the parsed RDF): `as2ToCanonical(dataset, subject)`,
  `canonicalToAs2(msg, subject)`, `longChatToCanonical(dataset, subject)`,
  `canonicalToLongChat(msg, subject)` — return / take an n3 `Store`.
- **Serialized-string-level** (Turtle / JSON-LD body in, Turtle out):
  `parseAs2(baseIri, body, contentType?, subject?)`,
  `parseLongChat(baseIri, body, contentType?, subject?)`,
  `serializeAs2(msg, subject)`, `serializeLongChat(msg, subject)`,
  `storeToTurtle(store)`.
- **Round-trip helper:** `roundTripAs2ToLongChat(msg, subject, { lossy? })` —
  AS2.0 → canonical → LongChat → canonical, for shared-field verification.
- **`MAPPING_TABLE`** — the table above as data (`MappingRow[]`).

### The SHACL shape

- **`messageShapeTtl()`** — the canonical message shape as a Turtle string (cached).
- **`MESSAGE_SHAPE_PATH`** — filesystem path to `shapes/message.shacl.ttl`.
- Both are re-exported from the package root and from the `./shape` subpath; the
  raw `.ttl` is also resolvable as `./shapes/message.shacl.ttl`.

### The adapter seam

```ts
interface ChatAdapter<E, R = E> {
  toCanonical(externalMessage: E): CanonicalMessage;
  toCanonicalRoom?(externalRoom: R): CanonicalRoom;
}
```

### The LibreChat adapter

```ts
class LibreChatAdapter implements ChatAdapter<LibreChatMessage> {
  constructor(opts?: LibreChatAdapterOptions);
  toCanonical(externalMessage: LibreChatMessage): CanonicalMessage;
}

interface LibreChatAdapterOptions {
  humanWebId?: string;   // attribute human messages here (omitted if absent — never fabricated)
  agentWebId?: string;   // attribute AI messages here (provenance.attributedTo)
  roomBaseIri?: string;  // resolve conversationId/parentMessageId under this base
  resolveModelIri?: (model?: string, endpoint?: string) => string | undefined;
}
```

- A **human** message (`isCreatedByUser === true`, or `sender`/`role` = user) maps
  to `author = humanWebId` and carries **no** provenance.
- An **AI/assistant** message maps to honest PROV-O attribution
  (`provenance.attributedTo` the agent WebID + `provenance.generatedBy` the model)
  and carries **no** `author` — it is not a human.
- The default `resolveModelIri` mints a `urn:librechat:model:<model>` URN, which is
  intentionally **not** an http(s) IRI and is therefore dropped by the IRI guard on
  write — supply your own resolver to surface a real model IRI.

## How to add an adapter

1. Define your source's public message type (only the fields you read).
2. Implement `ChatAdapter<YourMessage>` — map ONLY canonical fields, and:
   - apply the http(s)-only IRI guard (`isHttpIri` / `safeIri`) to anything that
     becomes an IRI (author, room, inReplyTo, provenance members, assignee) — drop,
     never coerce;
   - attribute bot/AI messages via `provenance`, never a fabricated human `author`;
   - never let a source-private field reach the canonical model.
3. Feed the result to the reconciler (`canonicalToAs2` / `canonicalToLongChat`).

Roadmap adapters (M2): Matrix / mautrix-bridgev2, granary; plus the
`librechat-solid-mcp` wiring.

## Security posture

Chat documents and external schemas are **untrusted input**. Every IRI-valued field
is filtered **http(s)-only** on **read AND write**, in **both** RDF shapes and in the
LibreChat adapter — a `javascript:` / `mailto:` / `urn:` / bare-string value is
**dropped**, never coerced into a `NamedNode` nor surfaced to a UI. This is the same
filter (`isHttpIri`) `@jeswr/solid-task-model` uses, copied verbatim.

## Development

```bash
npm install            # ignore-scripts=true via .npmrc
npm run gate           # lint + typecheck + test + build + check:dist + check:lockfile-transport
```

`dist/` is **committed** (so the package installs from GitHub with no build step);
the `check:dist` gate fails if it drifts from a fresh build — rebuild + commit
`dist/` alongside any `src/` change.

## License

MIT © Jesse Wright
