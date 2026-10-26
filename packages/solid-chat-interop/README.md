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

The RDF conversion helpers transform data in memory. `ChatWriter` persists through an injected
pod port; it does not acquire credentials or call global fetch. The canonical model
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

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

## Owner-only conversation storage

```ts
import { ChatWriter } from "@jeswr/solid-chat-interop";

// pod implements ChatPodPort (a structural subset of the MCP DESIGN §3 PodPort).
const chats = new ChatWriter(pod);
await chats.save({
  provider: "codex", // also "claude" or "chatgpt"
  conversationId: "session-123",
  title: "A conversation",
  messages: [{ id: "event-1", role: "user", text: "Hello", createdAt: "2026-10-25T12:00:00Z" }],
});
const page = await chats.list({ provider: "codex", limit: 20, since: "2026-10-01T00:00:00Z" });
const next = page.nextCursor ? await chats.list({ provider: "codex", limit: 20, cursor: page.nextCursor }) : undefined;
const conversation = await chats.get("codex", "session-123");
```

Each conversation lives under `<pod.root>private/chats/<provider>/<conversationId>/`.
The writer discovers and installs owner-only WAC ACL documents on the chats, provider and
conversation containers before creating their content. It leaves the enclosing
`private/` namespace's ACL alone. ACL failures abort; servers must support the
ACL-before-content sequence and advertise the ACL association even before container
creation. The port's `discoverAcl` must obtain a unique WAC `rel="acl"` Link from
the exact target and reject unsupported models and unsafe targets. The association
is checked again after container creation; existing non-WAC ACL documents abort the
save. The caller's port must enforce pod scope, refuse write redirects, and reject
HTTP failures with a numeric `status` property. There is no permissive ACL fallback.

Messages are canonical AS2 `as:Note` resources (`m-<id>.ttl#it`) with Dublin Core
identifier/role metadata; conversation metadata is an AS2 collection. User messages
attribute the owner; assistant messages retain their role without claiming a human
author. IDs use 1–200 ASCII letters, digits, underscores or hyphens. Supply source
message IDs for reliable capture: omitted IDs use SHA-256 of role, text and normalized
time, so identical ID-less events collapse. Every message uses `If-None-Match: *`;
412 skips the existing message. First saved title and message contents win. Failed
partial saves can be replayed safely.

`list` returns `{conversations, nextCursor?}`, ordered by ascending conversation URL.
Pass the exclusive URL cursor back with the same provider/since filters. `since`
is exclusive against the latest message's `createdAt`, applied before paging;
empty conversations are excluded when `since` is present. Limit is 1–100 (default
20). Dates require an explicit timezone. Listing scans conversation resources
without a mutable shared index; it is intended for small chat collections.
Containers with missing conversation metadata are skipped as incomplete saves;
permission, transport and message-read errors still propagate.

## Links

- [Source](https://github.com/jeswr/solid-chat-interop)
- [Issues](https://github.com/jeswr/solid-chat-interop/issues)
- [ActivityStreams 2.0](https://www.w3.org/TR/activitystreams-core/)

## License

[MIT](./LICENSE) © Jesse Wright
