<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/openclaw-memory-solid

An OpenClaw memory plugin that stores portable RDF memory records in the user's Solid pod.

The core adapter is independent of OpenClaw; the plugin subpath exposes the thin `kind: "memory"`
integration and its tools.

> Experimental. Inject an authenticated fetch and use an owner-private memory container.

## Install

```sh
npm install github:jeswr/openclaw-memory-solid#main
```

Requires Node.js 20 or newer.

## Minimal usage

Create an OpenClaw extension entry that injects your authenticated pod fetch:

```ts
import { createOpenClawMemoryPlugin } from "@jeswr/openclaw-memory-solid/plugin";
import { authenticatedFetch } from "./solid-auth.js";

export default createOpenClawMemoryPlugin({ fetch: authenticatedFetch });
```

Then select the plugin and provide its container in `openclaw.json`:

```json
{
  "plugins": {
    "slots": { "memory": "memory-solid" },
    "config": {
      "memory-solid": { "container": "https://alice.example/agent/memories/" }
    }
  }
}
```

## Key API

- `SolidMemoryAdapter` from `@jeswr/openclaw-memory-solid/core`: `store`, `recall`, `search`,
  `get`, `list`, and `forget`.
- `createOpenClawMemoryPlugin` from `@jeswr/openclaw-memory-solid/plugin`.
- Tools: `memory_store`, `memory_recall`, `memory_search`, `memory_get`, `memory_forget`.
- Plugin configuration: `container`, `agentWebId`, `defaultGeneratedBy`, `defaultLimit`.

## Links

- [Source](https://github.com/jeswr/openclaw-memory-solid)
- [Issues](https://github.com/jeswr/openclaw-memory-solid/issues)
- [Example extension](./examples/index.ts)
- [Security notes](./SECURITY.md)
- [OpenClaw](https://github.com/openclaw/openclaw)

## License

[MIT](./LICENSE) © Jesse Wright
