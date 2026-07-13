<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/matrix-chat-to-pod

Import Matrix room history into owner-private Solid LongChat resources.

The package separates a pure Matrix-event transform from the network orchestration, and preserves
edits, replies, redactions, timestamps, and source provenance.

> Import-only and experimental. Write the owner-only ACL before content and keep Matrix tokens out
> of logs and pod data.

## Install

```sh
npm install github:jeswr/matrix-chat-to-pod#main @rdfjs/types
```

Requires Node.js 24 or newer.

## Minimal usage

```ts
import { importRoom } from "@jeswr/matrix-chat-to-pod";

const report = await importRoom({
  homeserverUrl: "https://matrix.example.org",
  accessToken: process.env.MATRIX_ACCESS_TOKEN!,
  roomId: "!abc:example.org",
  container: "https://alice.example/chat/matrix/",
  ownerWebId: "https://alice.example/profile/card#me",
  writeFetch: authenticatedSolidFetch,
  webIdFor: (matrixUserId) => knownWebIds[matrixUserId],
});
```

For network-free mapping, import `matrixEventToCanonical` from
`@jeswr/matrix-chat-to-pod/transform`.

## Key API

- `importRoom`: guarded Matrix pagination, transformation, ACL-first pod writes, and an import report.
- `matrixEventToCanonical`: pure event mapping with `message`, `replace`, `redaction`, and `skip`
  outcomes.
- `buildOwnerOnlyAclTurtle`: owner-only WAC document builder.
- Types: Matrix wire events, transform contexts/results, and import options/results.

## Links

- [Source](https://github.com/jeswr/matrix-chat-to-pod)
- [Issues](https://github.com/jeswr/matrix-chat-to-pod/issues)
- [Matrix Client-Server API](https://spec.matrix.org/latest/client-server-api/)
- [SolidOS chat](https://solid.github.io/chat/)

## License

MIT © Jesse Wright
