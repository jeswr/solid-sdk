# @jeswr/openclaw-memory-solid

> An [OpenClaw](https://github.com/openclaw/openclaw) memory-slot plugin that stores an
> agent's memory in the **user's own Solid pod** — RDF-native, owner-owned, portable and
> readable + searchable by every other agent/app that speaks the shared model, via
> [`@jeswr/solid-memory`](https://github.com/jeswr/solid-memory).

Instead of siloing an agent's memory in a per-tool database, this backend writes each memory
to the user's pod as an RDF-native `mem:MemoryItem` resource. Because the mem0 / LangChain /
Letta adapters all map **TO** the same `@jeswr/solid-memory` model, a memory written by an
OpenClaw agent is re-readable + searchable by another agent or app — the memory belongs to the
user, not the tool.

The package ships **two layers**, deliberately separated so the audited Solid logic never
couples to the (community-driven, may-drift) OpenClaw runtime interface:

| Layer | Subpath | What it is |
|---|---|---|
| **Core** | `@jeswr/openclaw-memory-solid/core` | The pure `SolidMemoryAdapter` — imports **no** OpenClaw symbol; just maps memory ops onto a `@jeswr/solid-memory` `MemoryStore`. |
| **Plugin** | `@jeswr/openclaw-memory-solid/plugin` | The thin OpenClaw `kind:"memory"` wrapper (`createOpenClawMemoryPlugin`) registering the memory tools. |

The barrel (`.`) re-exports both.

## Install (GitHub, no build step)

This package commits a built, self-contained `dist/`, and the suite uses `ignore-scripts=true`,
so it installs and imports under GitHub install with **no build step**:

```bash
npm install github:jeswr/openclaw-memory-solid#main
```

**Dependency chain (verified).** This package depends on `@jeswr/solid-memory` as a GitHub
dependency; `@jeswr/solid-memory` in turn depends on `@jeswr/fetch-rdf`, which **is published on
npm**. So a single install resolves:

```
github:jeswr/openclaw-memory-solid#main   (this package — committed dist/)
  └─ github:jeswr/solid-memory#main        (committed dist/, bare import of fetch-rdf)
       └─ @jeswr/fetch-rdf@^0.1.0          (from the npm registry)
```

Nothing is esbuild-bundled — the committed `dist/` keeps bare `import … from "@jeswr/solid-memory/…"`,
exactly as `@jeswr/solid-memory` keeps a bare `import … from "@jeswr/fetch-rdf"`. The consumer's
`npm install` pulls the chain transitively. `npm` publish is a deferred migration, not a blocker.

## OpenClaw configuration

OpenClaw loads a `kind:"memory"` extension (via jiti) from `~/.openclaw/extensions/*.ts` and
selects it with `plugins.slots.memory` in `openclaw.json`. Because OpenClaw config is plain JSON
data, the **authenticated pod `fetch` cannot be expressed in JSON** — it is injected in code in a
small extension entry that default-exports the plugin.

**1. The extension entry** (`~/.openclaw/extensions/solid-memory.ts`):

```ts
import { createOpenClawMemoryPlugin } from "@jeswr/openclaw-memory-solid/plugin";

// Your authenticated Solid pod fetch — e.g. a client-credentials DPoP fetch or
// the session fetch from @solid/reactive-authentication. The plugin does NO auth
// itself (injectable authed-fetch seam).
import { authedFetch } from "./my-solid-auth.js";

export default createOpenClawMemoryPlugin({ fetch: authedFetch });
```

See [`examples/index.ts`](./examples/index.ts) for the runnable shape.

**2. `openclaw.json`** — select the slot and pass the plugin config:

```json
{
  "plugins": {
    "slots": { "memory": "solid-memory" },
    "config": {
      "solid-memory": {
        "container": "https://you.pod/agent/memories/",
        "agentWebId": "https://you.pod/profile/card#me",
        "defaultGeneratedBy": "https://you.pod/chat/current#it",
        "defaultLimit": 10
      }
    }
  }
}
```

Only `container` is required. The plugin scope-guards every operation to that container.

**3. The plugin manifest** — a sibling [`openclaw.plugin.json`](./openclaw.plugin.json) mirrors the
export (`{ id, name, description, version, kind, author, configSchema, tools }`), and `package.json`
carries the OpenClaw convention field:

```json
"openclaw": { "extensions": ["./dist/plugin.js"] }
```

> The `package.json` `openclaw.extensions` points at the **built** `dist/plugin.js` (the package's
> plugin module). Because the authenticated `fetch` must be injected in code, the actual runnable
> extension you place in `~/.openclaw/extensions/` is the tiny wrapper above that injects your fetch
> and default-exports `createOpenClawMemoryPlugin(...)`.

## API

### Core — `@jeswr/openclaw-memory-solid/core`

```ts
class SolidMemoryAdapter {
  constructor(options:
    | ({ memoryStore: MemoryStore } & { agentWebId?: string; defaultGeneratedBy?: string })
    | ({ container: string; fetch: typeof fetch } & { agentWebId?: string; defaultGeneratedBy?: string })
  );
  get container(): string;

  store(content: string, opts?: StoreOptions): Promise<StoreResult>;     // { id, memory, agentId? }
  recall(query: string, limit?: number): Promise<MemoryRecord[]>;        // free-text substring (unranked)
  search(query: MemorySearchQuery, limit?: number): Promise<MemoryRecord[]>;  // conjunctive filters
  get(id: string): Promise<MemoryRecord | null>;                         // by pod URL; null if missing/foreign
  list(): Promise<MemoryRecord[]>;
  forget(id: string, opts?: { ifMatch?: string }): Promise<ForgetResult>;  // hard delete; typed clean-failure
}
```

- `StoreOptions = { agentId?: string; generatedBy?: string; keywords?: string[]; categories?: string[] }`.
  `agentId` is **informational** identity context (echoed on the result) — the canonical
  `prov:wasAttributedTo` is the **configured** `agentWebId` (a WebID IRI), since a tool-call
  `agent_id` is free text, not necessarily an http(s) IRI. When no `agentWebId` is configured,
  the memory carries **no** attribution (we never invent one).
- `MemoryRecord = { id: string; memory: string; metadata: { created?, modified?, keywords?, categories?, about?, attributedTo?, generatedBy? } }`.
  There is **no `score`** — client-side recall is an unranked deterministic filter (no server FTS /
  vector search), so a relevance number is deliberately omitted, not fabricated.
- `ForgetResult = { ok: true; id } | { ok: false; id; code: "out-of-scope"; message }`. An `id`
  outside the configured container is refused by the fail-closed scope guard **with no network
  request** and returned as `{ ok: false, code: "out-of-scope" }`. (`get` of a foreign id returns
  `null`, likewise with no request.)

`forget` is a **hard `DELETE`** — `@jeswr/solid-memory` has no tombstone (`prov:invalidatedAt`)
write API yet, so the resource is removed, not soft-deleted. A tombstone is a `@jeswr/solid-memory`
follow-up.

### Plugin — `@jeswr/openclaw-memory-solid/plugin`

```ts
function createOpenClawMemoryPlugin(opts?: {
  fetch?: typeof fetch;          // injected authenticated pod fetch (required unless `adapter` given)
  adapter?: SolidMemoryAdapter;  // a pre-built adapter (advanced/testing) — authoritative
  container?: string;            // default if config omits it
  agentWebId?: string;
  defaultGeneratedBy?: string;
  defaultLimit?: number;
  id?: string;
}): OpenClawMemoryPlugin;
```

`OpenClawMemoryPlugin = { id, name, description, kind: "memory", configSchema, register(api) }`.
`configSchema.parse(value)` validates the required `container` (absolute http(s)) and applies
defaults. `register(api)` builds the adapter and registers the tools, each wrapping its result in
the `{ content: [{ type: "text", text }] }` envelope:

- `memory_store({ content, agent_id?, generatedBy?, keywords?, categories? })`
- `memory_recall({ query, limit? })`
- `memory_search({ … })` — a documented alias of `memory_recall`
- `memory_get({ id })`
- `memory_forget({ id })`

The local OpenClaw types (`OpenClawPluginApi`, `OpenClawTool`, `OpenClawToolResult`,
`OpenClawMemoryPlugin`, `ConfigSchema`, `JsonSchemaObject`, `SolidMemoryPluginConfig`) are exported
from the plugin subpath + the barrel, so a consumer can type their extension entry without an
unpublished OpenClaw types package.

## VERIFIED vs ASSUMED (OpenClaw interface)

The OpenClaw memory-backend interface is community-driven and has **no** published, stable types
package (the closed `MemoryBackend` proposal `#32966` is "not-planned"). This adapter is built to
the **slot + tools** contract and honestly scopes its claims:

**VERIFIED** against [`serenichron/openclaw-memory-mem0`](https://github.com/serenichron/openclaw-memory-mem0)
+ [`docs.openclaw.ai`](https://docs.openclaw.ai):

- The plugin **export shape** `{ id, name, description, kind: "memory", configSchema, register(api) }`.
- `api.registerTool(tool, { name })`.
- The tool-result envelope `{ content: [{ type: "text", text }] }`.
- The `memory_recall` / `memory_store` / `memory_forget` tool set (the docs additionally describe
  `memory_search` + `memory_get`, which this plugin also registers).

**ASSUMED — refine on a live instance:**

- Exact `api` method names beyond `registerTool` (`registerCli` / `on` are feature-detected and only
  used if present).
- The `before_agent_start` (auto-recall) / `agent_end` (auto-capture) event payloads — this plugin
  registers ONLY the verified tool surface and does **not** wire auto-recall/-capture yet (it is a
  follow-up pending a live-instance check of those payloads).
- That OpenClaw passes the plugin's `pluginConfig` exactly as the config block shown above, and how
  the host surfaces the user's authenticated pod `fetch` to a memory plugin (hence the explicit
  fetch-injection seam).

## Security

See [`SECURITY.md`](./SECURITY.md). In brief:

- **Owner-private by default.** The adapter never sets ACLs and never auto-shares; defaulting the
  memory container to owner-only is the consumer's (e.g. Pod Manager's) job.
- **Fail-closed container scope guard.** Every `get`/`forget` target is asserted to lie under the
  configured container **before any request** (delegated to `@jeswr/solid-memory`'s
  `assertWithinBase`), so an attacker-supplied `id` can never escape the container or hit a foreign
  origin. The adapter surfaces a rejection as a clean typed outcome, never an unhandled crash.
- **PROV-O attribution (not anonymized).** Stored memories carry `prov:wasAttributedTo` (the
  configured WebID) and `prov:wasGeneratedBy` (the conversation) — provenance is threaded, not
  stripped.
- **Untrusted record drop-not-fatal.** A pod member that is not a valid `mem:MemoryItem`, or that
  stores a hostile non-http(s) IRI, is dropped; `recall` / `list` / `get` skip it gracefully and
  never surface the hostile value. A non-memory body and a hostile IRI are dropped by
  `@jeswr/solid-memory` (it returns `null` / filters non-http(s) IRIs). An **un-parseable** body is
  handled by THIS adapter's own resilient member walk: `@jeswr/solid-memory`'s `MemoryStore.all()`
  re-throws a parse error (one poisoned member would abort the whole listing — an availability hole),
  so the adapter does not delegate bulk reads to `all()`; it lists members and parses each
  individually, dropping a member whose body fails to parse while **re-throwing a genuine network /
  server error**. Making `MemoryStore.all()` itself parse-error-resilient is a tracked
  `@jeswr/solid-memory` follow-up.
- **No remote fetch / no SSRF surface.** The adapter introduces no network call of its own — the
  only egress is the injected, already-authenticated pod `fetch` — so `@jeswr/guarded-fetch` is not
  needed (there is no outbound URL the adapter chooses).

## RDF discipline

All RDF goes through `@jeswr/solid-memory` (`MemoryStore` / `MemoryData` / `searchMemories`). This
package **never** hand-builds or parses a triple. `@jeswr/solid-memory` itself uses the suite's
vetted RDF stack (`@jeswr/fetch-rdf` to parse, `@rdfjs/wrapper` typed accessors, `n3.Writer` to
serialise).

## License

MIT © Jesse Wright. See [`LICENSE`](./LICENSE).
