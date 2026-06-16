# @jeswr/solid-community-feeds

A framework-agnostic, **read-first** client that normalizes the Solid community's
communication channels into **one unified feed model** — so an app (e.g. the Pod
Manager) can show a user the chats and forum threads they care about in a single
place.

Two sources today:

- **Matrix** — the Solid chat rooms over the Matrix **Client-Server API**
  (`#solid_project:matrix.org`, linked from
  [solidproject.org/community](https://solidproject.org/community); plus the
  bridged historical Gitter room `#solid:matrix.org`).
- **Discourse** — the Solid forum at
  [forum.solidproject.org](https://forum.solidproject.org) over the Discourse
  JSON API.

> Experimental, AI-agent-generated. Not production-hardened.

## Install

GitHub-installable now (committed `dist/`, works under `ignore-scripts=true`):

```bash
npm install github:jeswr/solid-community-feeds#main
```

Zero runtime dependencies. npm publish is a deferred migration.

## Model

```
CommunityChannel   (a Matrix room OR a Discourse category)
  └─ CommunityThread    (a Discourse topic; a Matrix room = one implicit thread)
       └─ CommunityMessage   (author, authorId, body, bodyHtml?, createdAt, permalink)
```

Every message carries an author, an ISO timestamp, plain-text + optional HTML
body, and a `permalink` back to the canonical web source (matrix.to / the forum
topic). `source` discriminates the backend.

## Usage

```ts
import {
  CommunityFeed,
  DiscourseFeedSource,
  MatrixFeedSource,
  SOLID_CHANNELS,
} from "@jeswr/solid-community-feeds";

const feed = new CommunityFeed({
  // Matrix needs a USER access token (the user logs into their Matrix/Gitter
  // account; obtain it via the host app's login or paste). Credentials come via
  // the suite credential seam — never plaintext, never logged.
  matrix: new MatrixFeedSource(
    { homeserverUrl: SOLID_CHANNELS.matrixHomeserver, accessToken: token },
    { fetch: authFetch }, // injectable fetch (auth-fetch seam / tests)
  ),
  // Public forum read needs NO credentials. An optional Discourse user API key
  // (userApiKey) unlocks the user's notifications / restricted categories.
  discourse: new DiscourseFeedSource(
    { baseUrl: SOLID_CHANNELS.forumBaseUrl },
    { fetch },
  ),
});

const { threads, totalUnread, errors } = await feed.getFeed(
  {
    matrixRooms: [SOLID_CHANNELS.matrixRoom],
    discourseTopicIds: [9856],
    includeDiscourseLatest: true,
  },
  readMarker, // caller-persisted last-seen positions → unread counts
);
```

`getFeed` never throws on one source failing: a per-source error is collected in
`errors` so a Matrix outage cannot blank the forum feed.

### ActivityStreams 2.0 projection (optional)

Map the model onto AS2 / JSON-LD for RDF-native consumers (store community items
in a pod with the standard ActivityStreams vocabulary):

```ts
import { messageToAs2, threadToAs2, channelToAs2 } from "@jeswr/solid-community-feeds";
const note = messageToAs2(message); // { "@context": ".../activitystreams", type: "Note", ... }
```

These emit plain JSON-LD objects (no RDF library pulled into the runtime).

## Security

All outbound requests go through an **SSRF-safe** fetch (`safeFetch`): the
homeserver / forum base URLs are user-configured, so each request is `https:`-only,
blocks private/loopback/link-local/reserved/metadata IP literals **and known
local/internal hostnames** (`localhost`, `*.local`, `*.internal`, `*.lan`,
`*.home.arpa`, …), embeds no credentials, does not auto-follow redirects, and
applies a timeout that stays active **through the body read** plus a body-size cap
(a `Content-Length` pre-check rejects a declared-oversize body before buffering).
The `fetch` is injectable — the suite's auth-`fetch` seam and tests substitute it.
Credentials are passed via config and never logged.

> Note: the host-name block is name-based and does not resolve DNS (so it stays
> browser-safe). A public DNS name that *resolves* to a private address is not
> caught here; a server-side deployment wanting a hard guarantee against
> DNS-rebinding should layer a DNS-pinned resolver on top (cf. prod-solid-server's
> `webidResolver`).

## Read APIs used

**Matrix Client-Server API** (`spec.matrix.org/latest/client-server-api`):
`GET /_matrix/client/v3/directory/room/{alias}`,
`GET /_matrix/client/v3/rooms/{roomId}/messages?dir=b&limit=`,
`GET /_matrix/client/v3/rooms/{roomId}/state/m.room.name|m.room.topic`.
Auth: `Authorization: Bearer <user access token>`.

**Discourse** (`docs.discourse.org`):
`GET /categories.json`, `GET /latest.json`, `GET /c/{slug}/{id}.json`,
`GET /t/{id}.json`. Public read needs no auth; optional per-user `User-Api-Key`
(+ `User-Api-Client-Id`) header.

## Scope

Read-first by design. Posting / replying (Matrix `PUT /rooms/{id}/send/...`,
Discourse `POST /posts`) is a deliberate later phase.

## Development

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build      # emits the committed dist/
npm run check:dist # verifies the committed dist/ matches src/
```

## License

MIT © Jesse Wright
