<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-memory

A typed RDF memory model, Solid-pod store, and client-side search layer for portable agent memory.

Writers use `https://jeswr.org/ns/memory#` and the canonical pod-chat namespace
`https://jeswr.org/ns/pod-chat#`. Readers also accept the read-only legacy memory namespace
exported as `LEGACY_MEMORY_NS`; `LEGACY_POD_CHAT_NS` identifies the legacy chat vocabulary.

## Install

```sh
npm install github:jeswr/solid-memory#main
```

The package tooling requires Node.js 20 or newer; the runtime API is browser-safe.

## Minimal usage

```ts
import { MemoryStore } from "@jeswr/solid-memory";

declare const authenticatedFetch: typeof fetch; // Supplied by your Solid session.

const memories = new MemoryStore({
  container: "https://alice.example/memories/",
  fetch: authenticatedFetch,
});

const created = await memories.create({
  text: "Alice prefers dark mode.",
  keywords: ["preference", "ui"],
});

const matches = await memories.search({ text: "dark" });
await memories.forget(created.url);
```

`forget` records a PROV-O invalidation tombstone; `delete` performs a hard HTTP delete. Forgotten
memories are excluded from search unless `includeForgotten: true` is requested.

## Key API

- Model: `MemoryItem`, `MemoryData`, `buildMemory`, `parseMemory`, `parseMemoryTtl`,
  `serializeMemory`.
- Store: `MemoryStore` with `create`, `get`, `update`, `list`, `all`, `search`, `forget`,
  `unforget`, and `delete`.
- Search: `searchMemories` and `MemorySearchQuery` for pure conjunctive filters.
- Scope and vocabulary: `assertWithinBase`, `normalizeContainer`, `MEMORY_CLASS`, `MEM`, and
  reused schema.org, Dublin Core, PROV-O, and ActivityStreams constants.
- Focused entries: `@jeswr/solid-memory/memory`, `/store`, and `/search`.

Pass an authenticated fetch and protect the memory container with an owner-only policy by default.
The library does not manage credentials or access control. Scope checks delegate to
`@jeswr/guarded-fetch` and reject encoded path delimiters (`%2F` / `%5C`). The exported
`assertWithinBase` is deprecated; it retains absolute-target and strict-resource defaults
for compatibility. New callers may use `assertWithinPodScope` with `{ allowRoot: false }`.

## Links

- [Source](https://github.com/jeswr/solid-memory)
- [Issues](https://github.com/jeswr/solid-memory/issues)
- [PROV-O specification](https://www.w3.org/TR/prov-o/)

## License

[MIT](./LICENSE) © Jesse Wright
