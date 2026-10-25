---
name: solid-notifications
description: Use when reacting to pod changes, discovering Solid notification services, subscribing to WebSocketChannel2023, supporting legacy NSS live updates, reconciling missed events, or adding a polling fallback.
---

## Quick reference

<!-- AUTHORED-BY Codex GPT-5 -->

**Implement Solid live updates**

Notifications are optional capabilities. Discover support at runtime and preserve a polling or manual-refresh fallback.

### Modern protocol

1. Read the resource's `Link` headers for `describedby` and the Solid `storageDescription` relation.
2. Fetch the description and find a subscription service advertising the desired channel type.
3. POST the JSON-LD subscription request to the discovered service.
4. Open the returned `receiveFrom` WebSocket URL and treat messages as invalidation hints.
5. Re-fetch the changed resource or listing. If a notification state equals the cached ETag, it may be skipped as an optimization.

Do not hardcode `/.notifications/` paths or WebSocket hosts. The returned socket URL may be short-lived and self-authorizing; do not try to attach DPoP HTTP headers to the browser WebSocket.

### Legacy NSS

Read `Updates-Via`, open the socket with subprotocol `solid-0.1`, send `sub <absolute-resource-uri>`, and handle `pub <uri>` frames. Frames contain no resource representation; re-fetch after a publication.

### Reliability rules

- On close/error, rerun discovery and subscription instead of reconnecting forever to an expired URL.
- Use bounded exponential backoff with jitter and expose a paused/degraded state.
- Perform a full ETag reconciliation after reconnect because socket messages can be missed.
- Assume container subscriptions reliably cover membership changes only; subscribe to individual resources when edits must be observed across implementations.
- Treat messages and advertised URLs as untrusted input. Validate types, schemes, origins, and resource scope before fetching.
- Keep notification JSON-LD protocol bodies separate from pod RDF mutation rules.

If this package is later imported as `packages/solid-notifications`, move this skill alongside it.

### Agent persona

When this work is delegated to a sub-agent, spawn the `solid-frontend-dev` persona from
[`.claude/agents/solid-frontend-dev.md`](../../.claude/agents/solid-frontend-dev.md) — it routes through this skill.
Orchestration: `.claude/agents/solid-app-orchestration.md`.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Solid notifications — live-sync over the pod

Read the companion [`AGENTS.md`](../../AGENTS.md) first; this skill assumes that stack
(`@solid/reactive-authentication` patches `globalThis.fetch`, so `fetch()` is authenticated).
Notifications are an **optional** capability — discover support, never assume it. A polling
fallback (re-`fetchRdf` on an interval, compare ETags) is acceptable for demos and required
where a server advertises no channel.

## Two worlds — branch by server

There is no single Solid notification mechanism. Detect which one the server speaks; do not
hardcode either.

| | **Solid Notifications Protocol** (modern) | **Legacy NSS "live update"** |
|---|---|---|
| Servers | CSS ≥ 6, modern servers | Node Solid Server (NSS) — `inrupt.net` and other legacy pods |
| Channel type | `WebSocketChannel2023` (also Webhook / StreamingHTTP) | single `wss://` socket, subprotocol `solid-0.1` |
| Discovery | `describedby` / `storageDescription` → subscription service URL | `Updates-Via` response header |
| Subscribe | `POST` a JSON-LD channel request | open socket, send `sub <uri>` text frame |
| Status | active spec; CSS 7.x ships 3 channel types | flagged with "known security issues" |
| Spec | [notifications-protocol](https://solidproject.org/TR/notifications-protocol) | [api-websockets.md](https://github.com/solid/solid-spec/blob/master/api-websockets.md) |

The transition has been long and confusing — ESS once disabled WebSockets entirely, and the
protocol target moved through several drafts
([state-of-the-websocket-api](https://forum.solidproject.org/t/state-of-the-websocket-api/4073)).
Treat live-sync as a feature you probe for, with graceful degradation.

## Modern path — Solid Notifications Protocol

### 1. Discover the subscription service (never hardcode)

Two `Link` rels carry discovery, per
[notifications-protocol §discovery](https://solidproject.org/TR/notifications-protocol):

| Rel | On | Points to |
|---|---|---|
| `describedby` | the topic resource itself | a description doc listing its subscription services |
| `http://www.w3.org/ns/solid/terms#storageDescription` | any resource in a storage | the storage description doc (also lists services) |

`HEAD` the resource, read the `Link` header, dereference the description doc, and read off the
subscription-service URL for the channel type you want. CSS exposes fixed paths under
`/.notifications/` (e.g. `…/.notifications/WebSocketChannel2023/`), but **discover them — do not
assume that layout**
([CSS 7.x notifications docs](https://communitysolidserver.github.io/CommunitySolidServer/7.x/usage/notifications/)).

### 2. Subscribe — POST a JSON-LD channel request

`POST` `application/ld+json` to the subscription service. The channel **type IRI** and
`receiveFrom` are defined by the channel-type spec, not the protocol doc
([WebSocketChannel2023](https://solid.github.io/notifications/websocket-channel-2023)). Context
URL is `https://www.w3.org/ns/solid/notifications-context/v1`
([notifications-protocol](https://solidproject.org/TR/notifications-protocol)).

```ts
// fetch() is the reactive-authentication-patched global — authenticated, DPoP-bound.
const subRes = await fetch(subscriptionServiceUrl, {
  method: "POST",
  headers: { "content-type": "application/ld+json" },
  body: JSON.stringify({
    "@context": "https://www.w3.org/ns/solid/notifications-context/v1",
    type: "http://www.w3.org/ns/solid/notification#WebSocketChannel2023",
    topic: resourceUrl, // the resource OR container to watch
  }),
});
if (!subRes.ok) throw new Error(`subscribe failed: ${subRes.status}`);
const channel = await subRes.json();
const wsUrl: string = channel.receiveFrom; // wss:// URL, may embed a short-lived auth token
```

### 3. Listen

`receiveFrom` is a `wss://` URL carrying its own authorisation (often a token in the query
string), so the WebSocket is a **plain browser `WebSocket`** — you do not, and cannot, send the
DPoP-patched `fetch` headers over it.

```ts
const ws = new WebSocket(wsUrl);
ws.addEventListener("message", (ev) => {
  // Notification body is a JSON-LD ActivityStreams object: type Update/Add/Remove/Delete,
  // `object` = the changed resource. Re-fetchRdf(that URL) to get fresh state.
  const activity = JSON.parse(ev.data);
  onChange(activity.object, activity.type);
});
```

**ETag short-circuit — skip the redundant re-fetch.** A modern-protocol change notification can
carry the changed resource's new ETag in its `state` field (the same value the resource's `ETag`
header would return). If you cache the ETag from each `fetchRdf` (`@jeswr/fetch-rdf` returns it),
compare `activity.state` against your cached ETag: equal ⇒ you already have that version, so it's a
no-op — most usefully, **your own write echoes back as a notification and costs nothing**. Only
when they differ (or `state` is absent — treat absent as "changed") do you re-fetch. Conditional
re-fetch (`If-None-Match: <cachedEtag>`) then collapses the common case to a cheap `304`. Don't
treat `state` as load-bearing across all servers — it's a fast path, not a correctness guarantee;
fall back to an unconditional re-fetch when it's missing.

CSS 7.x also offers two non-WebSocket channel types — use the same discover-then-request flow,
swapping the `type`
([CSS 7.x docs](https://communitysolidserver.github.io/CommunitySolidServer/7.x/usage/notifications/)):

| Type IRI fragment | Delivery | Extra request field |
|---|---|---|
| `WebSocketChannel2023` | client opens `wss://` (`receiveFrom`) | — |
| `WebhookChannel2023` | server `POST`s to your `https` endpoint | `sendTo` = your webhook URL ([webhook-channel-2023](https://solid.github.io/notifications/webhook-channel-2023)) |
| `StreamingHTTPChannel2023` | pre-established per-resource stream | advertised via `rel="http://www.w3.org/ns/solid/terms#updatesViaStreamingHttp2023"` (CSS) |

## Legacy path — NSS `wss://`

NSS predates the protocol. Discover via the `Updates-Via` response header, open the socket with
the `solid-0.1` subprotocol, and send a `sub` text frame per resource; the server replies with
`pub <uri>` text frames on change
([api-websockets.md](https://github.com/solid/solid-spec/blob/master/api-websockets.md)).

```ts
const head = await fetch(resourceUrl, { method: "HEAD" });
const wsUrl = head.headers.get("Updates-Via"); // e.g. wss://example.org
const ws = new WebSocket(wsUrl!, ["solid-0.1"]);
ws.addEventListener("open", () => ws.send(`sub ${resourceUrl}`)); // absolute URI only
ws.addEventListener("message", (ev) => {
  const [verb, uri] = String(ev.data).split(" ");
  if (verb === "pub") onChange(uri); // server announces a change; re-fetch to get content
});
```

Frames are plain text, not JSON. There is no per-change payload — `pub <uri>` only tells you the
URI changed; re-fetch to see what. (The spec text shows `sub`/`pub`; an `ack` frame is **not** in
the current spec — unverified lore, do not rely on it.)

## Webhooks vs WebSockets

| Use WebSockets when | Use Webhooks when |
|---|---|
| Browser/SPA client, user is present | Server-side or long-lived background consumer |
| Sub-second UI refresh, no public ingress | You control an `https` endpoint the pod can reach |
| Connection lifetime ≈ session | Delivery must survive client being offline |

A browser SPA almost always wants WebSockets; webhooks need a publicly reachable receiver, which a
client app does not have.

## Container semantics — the gotcha

Subscribing to a **container** is the usual way to watch a collection (e.g. an inbox). What that
notifies on is **server-dependent and historically under-specified**, and is the single most
common source of confusion
([nature-of-change](https://forum.solidproject.org/t/api-websocket-nature-of-change-and-resource-changed/4968),
[how-can-i-listen-for-new-messages-in-my-inbox](https://forum.solidproject.org/t/how-can-i-listen-for-new-messages-in-my-inbox/3043)):

- **Verified (legacy NSS):** any CRUD on a resource *inside* a subscribed container notifies on
  the container URI ([api-websockets.md](https://github.com/solid/solid-spec/blob/master/api-websockets.md)).
- **Unverified (modern protocol):** whether a container channel fires only on membership change
  (add/remove of contained resources) or also on edits to existing contained resources is **not
  pinned down by the sources gathered here** — assume membership-only and subscribe per-resource
  for deep changes until you confirm against your target server. Treat "container notifies on
  deep content edits" as unverified.

Design implication: to reliably react to edits of individual resources, subscribe to **each
resource**, not just the parent container — or accept membership-only granularity and poll the
contents.

## Reconnection & expiry

- **Channels expire.** A `receiveFrom`/`wss://` URL (and any embedded token) is short-lived. On
  socket `close`/`error`, **re-run discovery + subscribe** to mint a fresh channel — do not blindly
  reconnect to the stale URL. (Exact TTLs are server-specific — unverified; treat any close as
  "re-subscribe".)
- **Backoff.** Reconnect with exponential backoff + jitter; cap retries; surface a "live updates
  paused" state in the UI rather than hammering.
- **Token refresh.** The house `fetch` is DPoP-bound and refreshes transparently on `401`, but the
  WebSocket carries its own auth from subscription time and cannot refresh in place — expiry =
  reconnect via a fresh `POST`.
- **Missed-update safety.** Sockets drop. On reconnect, do a full `fetchRdf` reconcile (compare
  ETags) so the UI converges even if `pub`/notification frames were missed while offline.

## Banned / avoid

- **`@inrupt/solid-client-notifications`** — only partially implements the spec and is
  **ESS-leaning**: it "only works with ESS" and not CSS/NSS per its maintainers
  ([forum thread](https://forum.solidproject.org/t/does-solid-client-notifications-only-works-with-ess-pods/5401)).
  The modern path above is plain `fetch` + discovery + browser `WebSocket` — no Inrupt dependency.
- Do not hand-build the JSON-LD subscription body by string concatenation if it grows beyond the
  flat shape above — but note this body is a **protocol message, not pod RDF**, so it is exempt
  from the "all RDF through @solid/object / TermWrapper" rule; a plain object + `JSON.stringify` is
  correct here.
- Do not assume `/.notifications/...` paths, `wss://` hosts, or channel TTLs — discover them.

## Cross-links

- Server differences (CSS / ESS / NSS) → `solid-server-matrix`.
- Inbox / collection modelling → `solid-scale-and-sharding`.
- Real-world example: [Real Time Solid](https://forum.solidproject.org/t/real-time-solid/7448)
  (Notifications Protocol over live climate data).
