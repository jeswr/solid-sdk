<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-community-feeds

Read Matrix rooms and Discourse topics through one framework-independent community feed model.

> Experimental. Credentials are injected by the caller and must never be logged or persisted in
> feed data.

## Install

```sh
npm install github:jeswr/solid-community-feeds#main
```

Requires Node.js 24 or newer.

## Minimal usage

```ts
import {
  CommunityFeed,
  DiscourseFeedSource,
  MatrixFeedSource,
  SOLID_CHANNELS,
} from "@jeswr/solid-community-feeds";

const accessToken = process.env.MATRIX_ACCESS_TOKEN!;
const feed = new CommunityFeed({
  matrix: new MatrixFeedSource({
    homeserverUrl: SOLID_CHANNELS.matrixHomeserver,
    accessToken,
  }),
  discourse: new DiscourseFeedSource({ baseUrl: SOLID_CHANNELS.forumBaseUrl }),
});

const result = await feed.getFeed({
  matrixRooms: [SOLID_CHANNELS.matrixRoom],
  includeDiscourseLatest: true,
});
```

One source failing does not discard successful results from the other; inspect `result.errors`.
The default sources use the built-in guarded fetch. If you inject a fetch implementation for
tests or custom authentication, it must preserve DNS pinning and SSRF protection for untrusted
hosts.

## Key API

- Sources: `MatrixFeedSource`, `DiscourseFeedSource`.
- Aggregation: `CommunityFeed#getFeed` returns threads, unread totals, and per-source errors.
- Model: `CommunityChannel`, `CommunityThread`, `CommunityMessage`, and read-marker types.
- JSON-LD projections: `channelToAs2`, `threadToAs2`, `messageToAs2`.
- Defaults: `SOLID_CHANNELS` names the public Solid Matrix and forum endpoints.

## Links

- [Source](https://github.com/jeswr/solid-community-feeds)
- [Issues](https://github.com/jeswr/solid-community-feeds/issues)
- [Matrix Client-Server API](https://spec.matrix.org/latest/client-server-api/)
- [Discourse API](https://docs.discourse.org/)

## License

MIT © Jesse Wright
