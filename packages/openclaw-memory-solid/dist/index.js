// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `@jeswr/openclaw-memory-solid` — an OpenClaw memory-slot plugin that stores an
 * agent's memory in the USER'S Solid pod.
 *
 * A `kind: "memory"` backend for the OSS self-hosted agent framework
 * [OpenClaw](https://github.com/openclaw/openclaw): instead of siloing an agent's
 * memory in a per-tool database, memories are written to the user's own pod as
 * RDF-native `mem:MemoryItem` resources (via
 * [`@jeswr/solid-memory`](https://github.com/jeswr/solid-memory)) — owner-owned,
 * portable, and readable + searchable by every other agent / app that speaks the
 * same model (mem0 / LangChain / Letta adapters all map TO it).
 *
 * Two layers, with a deliberate separation so the audited core never couples to
 * the (community-driven, may-drift) OpenClaw runtime interface:
 *
 * | Layer | Subpath | What it is |
 * |---|---|---|
 * | Core | `@jeswr/openclaw-memory-solid/core` | The pure {@link SolidMemoryAdapter} — no OpenClaw symbol imported |
 * | Plugin | `@jeswr/openclaw-memory-solid/plugin` | The thin OpenClaw `kind:"memory"` wrapper |
 *
 * The barrel (`.`) re-exports both.
 *
 * @packageDocumentation
 */
export { AdapterScopeError, SolidMemoryAdapter, } from "./core.js";
export { createOpenClawMemoryPlugin, } from "./plugin.js";
//# sourceMappingURL=index.js.map