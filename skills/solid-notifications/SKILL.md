---
name: solid-notifications
description: Use when reacting to pod changes, discovering Solid notification services, subscribing to WebSocketChannel2023, supporting legacy NSS live updates, reconciling missed events, or adding a polling fallback.
---
<!-- AUTHORED-BY Codex GPT-5 -->

# Implement Solid live updates

Notifications are optional capabilities. Discover support at runtime and preserve a polling or manual-refresh fallback.

## Modern protocol

1. Read the resource's `Link` headers for `describedby` and the Solid `storageDescription` relation.
2. Fetch the description and find a subscription service advertising the desired channel type.
3. POST the JSON-LD subscription request to the discovered service.
4. Open the returned `receiveFrom` WebSocket URL and treat messages as invalidation hints.
5. Re-fetch the changed resource or listing. If a notification state equals the cached ETag, it may be skipped as an optimization.

Do not hardcode `/.notifications/` paths or WebSocket hosts. The returned socket URL may be short-lived and self-authorizing; do not try to attach DPoP HTTP headers to the browser WebSocket.

## Legacy NSS

Read `Updates-Via`, open the socket with subprotocol `solid-0.1`, send `sub <absolute-resource-uri>`, and handle `pub <uri>` frames. Frames contain no resource representation; re-fetch after a publication.

## Reliability rules

- On close/error, rerun discovery and subscription instead of reconnecting forever to an expired URL.
- Use bounded exponential backoff with jitter and expose a paused/degraded state.
- Perform a full ETag reconciliation after reconnect because socket messages can be missed.
- Assume container subscriptions reliably cover membership changes only; subscribe to individual resources when edits must be observed across implementations.
- Treat messages and advertised URLs as untrusted input. Validate types, schemes, origins, and resource scope before fetching.
- Keep notification JSON-LD protocol bodies separate from pod RDF mutation rules.

If this package is later imported as `packages/solid-notifications`, move this skill alongside it.
