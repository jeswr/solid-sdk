<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-chat-interop

A pure-RDF reconciler between ActivityStreams 2.0 chat, SolidOS LongChat, and external chat
schemas.

## Install

```sh
npm install github:jeswr/solid-chat-interop#main
```

Requires Node.js 24 or newer.

## Minimal usage

```ts
import { parseAs2, serializeLongChat } from "@jeswr/solid-chat-interop";

const resourceUrl = "https://alice.example/chat/room/message.ttl";
const response = await fetch(resourceUrl);
const message = await parseAs2(
  resourceUrl,
  await response.text(),
  response.headers.get("content-type"),
);

if (message) {
  // `#it` is the subject IRI for this SolidOS LongChat message document.
  const longChatTurtle = await serializeLongChat(message, `${resourceUrl}#it`);
}
```

The library transforms RDF in memory and does not perform network requests. Its canonical model
preserves message content, author, time, replies, edits, deletion, provenance, and task overlays.

## Key API

- Serialized RDF: `parseAs2`, `parseLongChat`, `serializeAs2`, `serializeLongChat`.
- Dataset conversion: `as2ToCanonical`, `canonicalToAs2`, `longChatToCanonical`,
  `canonicalToLongChat`.
- Models and accessors: `CanonicalMessage`, `CanonicalRoom`, `As2MessageDoc`,
  `LongChatMessageDoc`.
- External adapters: `ChatAdapter` from the focused `/adapter` entry and `LibreChatAdapter` from
  the package root; `MAPPING_TABLE` documents the field mapping.
- Node-only shape helpers from `@jeswr/solid-chat-interop/shape`; the raw SHACL file is exported
  at `/shapes/message.shacl.ttl`.

IRI-valued fields from untrusted data are restricted to safe HTTP(S) IRIs on both read and write.

## Links

- [Source](https://github.com/jeswr/solid-chat-interop)
- [Issues](https://github.com/jeswr/solid-chat-interop/issues)
- [ActivityStreams 2.0](https://www.w3.org/TR/activitystreams-core/)

## License

[MIT](./LICENSE) © Jesse Wright
