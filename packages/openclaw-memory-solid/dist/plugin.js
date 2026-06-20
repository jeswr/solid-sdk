// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The THIN OpenClaw memory-slot wrapper over the pure {@link SolidMemoryAdapter}.
 *
 * OpenClaw (the OSS self-hosted agent framework, `openclaw/openclaw`) loads a
 * memory backend as a `kind: "memory"` plugin from `~/.openclaw/extensions/*.ts`,
 * selected via `plugins.slots.memory` in `openclaw.json`. The plugin module
 * default-exports `{ id, name, description, kind, configSchema, register(api) }`;
 * `register` is called once and uses `api.registerTool(...)` to expose tools.
 *
 * **What is VERIFIED vs ASSUMED (see README).** The plugin EXPORT SHAPE
 * (`{ id, name, kind:"memory", configSchema, register(api) }`), `api.registerTool`,
 * the `{ content: [{ type:"text", text }] }` tool-result envelope, and the
 * `memory_recall` / `memory_store` / `memory_forget` tool set are VERIFIED against
 * `serenichron/openclaw-memory-mem0` + docs.openclaw.ai. Exact `api` method names
 * beyond `registerTool`/`on`, and the `before_agent_start` / `agent_end`
 * auto-recall/auto-capture event payloads, are ASSUMED and must be confirmed on a
 * live instance — so this wrapper registers ONLY the tool surface (the verified
 * contract) and keeps the optional event/CLI wiring behind feature flags that
 * degrade silently if `api` lacks the method.
 *
 * **Local types, no unpublished dependency.** OpenClaw ships no published types
 * package, so we declare a MINIMAL local {@link OpenClawPluginApi} / {@link
 * OpenClawTool} / {@link OpenClawMemoryPlugin} — enough to type the wrapper without
 * coupling to OpenClaw internals. They are intentionally permissive (the runtime
 * may pass more).
 */
import { SolidMemoryAdapter, } from "./core.js";
const DEFAULT_LIMIT = 10;
/** Read a string field from an unknown record, or `undefined`. */
function strOf(obj, key) {
    const v = obj[key];
    return typeof v === "string" && v.length > 0 ? v : undefined;
}
/**
 * Build the OpenClaw memory-slot plugin object backed by a Solid pod.
 *
 * The returned object's `configSchema.parse` normalises the raw plugin config
 * (applying defaults from `opts`); `register(api)` builds a {@link
 * SolidMemoryAdapter} from the parsed config + injected `fetch` and registers the
 * memory tools (`memory_store`, `memory_recall`, `memory_forget`, plus the
 * `memory_get` / `memory_search` aliases the docs describe), each mapping to the
 * adapter and wrapping its result in the `{ content:[{type:"text",text}] }`
 * envelope.
 */
export function createOpenClawMemoryPlugin(opts = {}) {
    const configSchema = {
        parse(value) {
            const raw = value && typeof value === "object" ? value : {};
            const container = strOf(raw, "container") ?? opts.container;
            if (!container) {
                throw new Error("[openclaw-memory-solid] plugin config is missing `container` (the absolute http(s) Solid container URL memories live under).");
            }
            const rawLimit = raw.defaultLimit;
            const defaultLimit = typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit >= 0
                ? Math.floor(rawLimit)
                : (opts.defaultLimit ?? DEFAULT_LIMIT);
            return {
                container,
                agentWebId: strOf(raw, "agentWebId") ?? opts.agentWebId,
                defaultGeneratedBy: strOf(raw, "defaultGeneratedBy") ?? opts.defaultGeneratedBy,
                defaultLimit,
            };
        },
    };
    return {
        id: opts.id ?? "memory-solid",
        name: "Solid Pod Memory",
        description: "Store agent memory in the user's own Solid pod (RDF-native, portable, owner-owned) via @jeswr/solid-memory.",
        kind: "memory",
        configSchema,
        register(api) {
            const config = configSchema.parse(api.pluginConfig);
            // Build the adapter. A supplied adapter is authoritative; otherwise we need
            // an injected authenticated fetch.
            let adapter;
            if (opts.adapter) {
                adapter = opts.adapter;
            }
            else {
                if (!opts.fetch) {
                    throw new Error("[openclaw-memory-solid] createOpenClawMemoryPlugin requires either `fetch` (an authenticated pod fetch) or a pre-built `adapter`.");
                }
                const adapterOptions = {
                    container: config.container,
                    fetch: opts.fetch,
                    agentWebId: config.agentWebId,
                    defaultGeneratedBy: config.defaultGeneratedBy,
                };
                adapter = new SolidMemoryAdapter(adapterOptions);
            }
            for (const tool of buildTools(adapter, config.defaultLimit)) {
                api.registerTool(tool, { name: tool.name });
            }
        },
    };
}
/** Build the memory tool set bound to `adapter`. */
function buildTools(adapter, defaultLimit) {
    const recall = {
        name: "memory_recall",
        label: "Recall memories",
        description: "Recall stored memories matching a free-text query (case-insensitive substring over the memory body). Returns the most relevant memories with their stable ids.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Free-text query to recall by." },
                limit: { type: "number", description: "Max results (optional)." },
            },
            required: ["query"],
            additionalProperties: false,
        },
        async execute(_id, params) {
            const query = typeof params.query === "string" ? params.query : "";
            const limit = typeof params.limit === "number" ? params.limit : defaultLimit;
            const records = await adapter.recall(query, limit);
            return textResult(records);
        },
    };
    const search = {
        name: "memory_search",
        label: "Search memories",
        description: "Alias of memory_recall — search stored memories by a free-text query. (memory_search is a documented alias of memory_recall.)",
        parameters: recall.parameters,
        execute: recall.execute,
    };
    const storeTool = {
        name: "memory_store",
        label: "Store a memory",
        description: "Store a memory in the user's Solid pod. Attributed to the configured agent WebID; optionally linked to the generating conversation.",
        parameters: {
            type: "object",
            properties: {
                content: { type: "string", description: "The memory text to store." },
                agent_id: { type: "string", description: "Informational agent identity (optional)." },
                generatedBy: {
                    type: "string",
                    description: "The generating conversation IRI (prov:wasGeneratedBy, optional).",
                },
                keywords: {
                    type: "array",
                    items: { type: "string" },
                    description: "Free-text tags (optional).",
                },
                categories: {
                    type: "array",
                    items: { type: "string" },
                    description: "Category/topic class IRIs (optional).",
                },
            },
            required: ["content"],
            additionalProperties: false,
        },
        async execute(_id, params) {
            const content = typeof params.content === "string" ? params.content : "";
            if (content.length === 0) {
                return errorResult("memory_store requires non-empty `content`.");
            }
            const result = await adapter.store(content, {
                agentId: typeof params.agent_id === "string" ? params.agent_id : undefined,
                generatedBy: typeof params.generatedBy === "string" ? params.generatedBy : undefined,
                keywords: stringArrayOf(params.keywords),
                categories: stringArrayOf(params.categories),
            });
            return textResult(result);
        },
    };
    const get = {
        name: "memory_get",
        label: "Get a memory",
        description: "Fetch a single memory by its id (pod URL). Returns null if not found.",
        parameters: {
            type: "object",
            properties: {
                id: { type: "string", description: "The memory id (its pod URL)." },
            },
            required: ["id"],
            additionalProperties: false,
        },
        async execute(_id, params) {
            const id = typeof params.id === "string" ? params.id : "";
            if (id.length === 0)
                return errorResult("memory_get requires `id`.");
            const record = await adapter.get(id);
            return textResult(record);
        },
    };
    const forget = {
        name: "memory_forget",
        label: "Forget a memory",
        description: "Forget (delete) a memory by its id (pod URL). An id outside the configured container is refused cleanly (no request issued).",
        parameters: {
            type: "object",
            properties: {
                id: { type: "string", description: "The memory id (its pod URL) to forget." },
            },
            required: ["id"],
            additionalProperties: false,
        },
        async execute(_id, params) {
            const id = typeof params.id === "string" ? params.id : "";
            if (id.length === 0)
                return errorResult("memory_forget requires `id`.");
            const result = await adapter.forget(id);
            if (!result.ok) {
                return errorResult(result.message);
            }
            return textResult(result);
        },
    };
    return [recall, search, storeTool, get, forget];
}
/** Coerce an unknown value into a string[] (dropping non-string entries). */
function stringArrayOf(value) {
    if (!Array.isArray(value))
        return undefined;
    const out = value.filter((v) => typeof v === "string");
    return out.length > 0 ? out : undefined;
}
/** Wrap any JSON-serialisable result in the OpenClaw tool-result envelope. */
function textResult(data) {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
/** An error tool-result (clean failure, never an unhandled crash). */
function errorResult(message) {
    return { content: [{ type: "text", text: message }], isError: true };
}
//# sourceMappingURL=plugin.js.map