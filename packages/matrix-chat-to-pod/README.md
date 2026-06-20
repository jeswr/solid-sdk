# @jeswr/matrix-chat-to-pod

> Ingest **Matrix** room history into a **Solid pod** — owner-private, READ/import-only (phase 1).

The highest chat-capture multiplier in the suite's OSS-integration plan: **one schema reaches
WhatsApp / Signal / Telegram / Slack / Discord / iMessage** via [mautrix](https://github.com/mautrix)
bridges / [Beeper](https://www.beeper.com/), because they all surface as ordinary Matrix
`m.room.message` events on the network-neutral [Matrix Client-Server API](https://spec.matrix.org/).
Read the Matrix history with a Matrix access token, transform each event into the suite's canonical
chat model, and write it into the user's own pod as a SolidOS LongChat resource that
[Pod Manager](https://github.com/jeswr/solid-pod-manager)'s `/chat` and any LongChat reader can read.

Part of the `@jeswr` Solid app suite. **Mints no new RDF predicate and hand-builds no triples** — the
canonical model and the LongChat serialization come from
[`@jeswr/solid-chat-interop`](https://github.com/jeswr/solid-chat-interop); RDF parse/serialize go
through [`@jeswr/fetch-rdf`](https://github.com/jeswr/fetch-rdf) + `n3.Writer`.

## Two layers

1. **The pure transform `matrixEventToCanonical(event, ctx)`** — the heart of the package. A single
   untrusted Matrix CS-API event → a `@jeswr/solid-chat-interop` `CanonicalMessage` (or a redaction /
   skip instruction). NO network, NO state — exhaustively fixture-tested. This is the value.
2. **The thin `importRoom(options)` orchestration** — pages the Matrix `/messages` API through
   `@jeswr/guarded-fetch`, transforms each event, stitches edits/redactions onto their target
   resources, and writes each message as an **owner-private** LongChat resource via an injectable
   authed `fetch`.

## Install (GitHub — no npm publish yet)

```sh
npm install github:jeswr/matrix-chat-to-pod#main
```

The built `dist/` is committed, so it imports with **no build step** under `ignore-scripts=true`.
`@jeswr/fetch-rdf` resolves from npm; `@jeswr/solid-chat-interop` and `@jeswr/guarded-fetch` resolve
from GitHub (they also ship committed `dist/`). npm publish is a deferred migration, not a blocker.

## Quick start

### The pure transform (no network)

```ts
import { matrixEventToCanonical } from "@jeswr/matrix-chat-to-pod/transform";

const result = matrixEventToCanonical(matrixEvent, {
  // Map a Matrix event_id to the in-pod resource it is written at (stable + deterministic).
  messageIriFor: (eventId) =>
    `https://alice.pod.example/chat/matrix/m-${encodeURIComponent(eventId)}.ttl#it`,
  // Resolve a Matrix sender to a REAL WebID, or undefined when none is known.
  // The bare @user:server is NEVER fabricated into a WebID — honest absence beats a fake link.
  webIdFor: (matrixUserId) => knownWebIds[matrixUserId],
  derivedFrom: "https://matrix.example.org", // prov:wasDerivedFrom (http(s) only)
});

switch (result.kind) {
  case "message":   /* result.message is a CanonicalMessage */ break;
  case "replace":   /* an edit: apply result.message to result.targetEventId */ break;
  case "redaction": /* tombstone result.targetEventId with result.deletedAt */ break;
  case "skip":      /* non-message / unmappable / hostile — result.reason */ break;
}
```

### Import a whole room into a pod

```ts
import { importRoom } from "@jeswr/matrix-chat-to-pod";

const result = await importRoom({
  homeserverUrl: "https://matrix.example.org", // a USER-CONFIGURED REMOTE → SSRF-guarded, https-only
  accessToken: process.env.MATRIX_ACCESS_TOKEN!, // a runtime secret — never logged/persisted
  roomId: "!abc:example.org",
  container: "https://alice.pod.example/chat/matrix/", // must end with "/"
  ownerWebId: "https://alice.pod.example/profile/card#me", // owner-only ACL is written first
  writeFetch: authedSolidFetch, // your DPoP/Bearer Solid fetch (the pod is your trusted origin)
  webIdFor: (matrixUserId) => knownWebIds[matrixUserId],
});
// { written, redacted, skipped, pages }
```

## Field mapping (Matrix → canonical → the suite chat shapes)

| Matrix | Canonical | Notes |
|---|---|---|
| `content.body` / `content.formatted_body` (HTML) | `content` (+ `mediaType` `text/html` when HTML) | for an edit, the body is read from `content['m.new_content']` |
| `sender` (`@user:server`) | `author` | **only** when a `webIdFor` resolver yields an http(s) WebID; the raw matrix id is preserved as `matrixSender` for audit, never as an RDF IRI |
| `origin_server_ts` (ms epoch) | `published` (ISO-8601) | an out-of-range/garbage timestamp is dropped, never thrown |
| `room_id` | `room` | via `roomIriFor` (the in-pod container IRI) |
| `content['m.relates_to']['m.in_reply_to'].event_id` | `inReplyTo` | the in-pod resource of the replied-to event |
| `m.replace` edit | `replacedBy` (`dct:isReplacedBy`) on the **target** | the edit's new content rewrites the target resource |
| `m.room.redaction` / already-redacted | `deletedAt` (`schema:dateDeleted`) | the body is cleared (right-to-be-forgotten) |

Only **text-bearing** msgtypes (`m.text`/`m.notice`/`m.emote`, and unknown/custom) are imported in
phase 1; `m.image`/`m.file`/`m.audio`/`m.video`/`m.location` are skipped (media import is deferred).

## Security & privacy posture

- **The Matrix homeserver URL is a user-configured remote** → every homeserver read goes through
  `@jeswr/guarded-fetch`'s node DNS-pinning fetch: **https-only**, blocks
  private/loopback/link-local/**cloud-metadata** addresses, DNS-pins to close the rebinding window,
  caps response size + time, and **does not auto-follow redirects**.
- **The Matrix access token is a runtime input** — sent only as a `Bearer` header on the guarded
  homeserver request. It is **never written to the pod, never logged, never placed in a URL** (there
  is a regression test for this).
- **Imported chat is third-party data landing in your pod** → the default ACL is **OWNER-ONLY**
  (`acl:Read`/`acl:Write`/`acl:Control` for the owner over the container + descendants), written
  **before** any message lands. Nothing is auto-shared; the importer never widens an existing ACL.
- **Source edits and redactions are honoured on re-sync** — re-running rewrites the same stable
  resource per event id, applies new edits, and clears redacted bodies.
- **Untrusted-input discipline** — every Matrix field is read defensively; a missing or wrong-typed
  field is dropped (never coerced, never thrown). Non-http(s) IRIs are filtered by the canonical
  model on read and write.

## Public API

- `matrixEventToCanonical(event, ctx): MatrixEventResult` — the pure transform (`./transform` and the
  root export). `MatrixEventResult` = `MessageResult | ReplaceResult | RedactionResult | SkipResult`.
- `importRoom(options): Promise<ImportRoomResult>` — the orchestration.
- `buildOwnerOnlyAclTurtle(container, ownerWebId): Promise<string>` — the owner-only WAC ACL builder.
- Types: `MatrixContext`, `ImportRoomOptions`, `ImportRoomResult`, the `Matrix*` wire types, and
  `CanonicalMessage` (re-exported from `@jeswr/solid-chat-interop`).

## Scripts

| Script | What |
|---|---|
| `npm run gate` | lint + typecheck + test + build + check:dist (the full local gate) |
| `npm run build` | `tsc` → `dist/` (commit `dist/` alongside any `src/` change) |
| `npm run check:dist` | fails if committed `dist/` drifts from a fresh build |
| `npm test` | vitest |

## Roadmap / status

Phase 1 (this package) is **READ/import-only, owner-private**. Follow-ups (tracked, not in this repo):

- **Live import needs a real Matrix access token** → `needs:user` for go-live. The library + transform
  are fully buildable and testable **now** with fixtures (the deliverable).
- **Phase 2: live append** via the Matrix `/sync` long-poll (incremental, WebSocket-like).
- **Phase 3: media import** (map `m.image`/`m.file` to attachment metadata).

## Provenance

Authored by Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate. MIT.
