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
import { SolidMemoryAdapter } from "./core.js";
/** A JSON-Schema-ish object literal describing a tool's parameters (zero-dep). */
export interface JsonSchemaObject {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
    [extra: string]: unknown;
}
/** The result envelope every OpenClaw tool returns. */
export interface OpenClawToolResult {
    content: Array<{
        type: "text";
        text: string;
    }>;
    /** OpenClaw may read an `isError` flag; set on a failure result. */
    isError?: boolean;
}
/** A tool registered with OpenClaw via {@link OpenClawPluginApi.registerTool}. */
export interface OpenClawTool {
    name: string;
    label?: string;
    description: string;
    /** A plain JSON-schema object literal (no typebox / zod). */
    parameters: JsonSchemaObject;
    /** Execute the tool. `params` is the validated argument object. */
    execute(toolCallId: string, params: Record<string, unknown>): Promise<OpenClawToolResult>;
}
/**
 * The minimal slice of the OpenClaw plugin `api` this wrapper uses. `registerTool`
 * is VERIFIED; `registerCli` and `on` are ASSUMED (optional) and only used when
 * present (the wrapper feature-detects them). `pluginConfig` is the raw config
 * OpenClaw passes for this plugin slot.
 */
export interface OpenClawPluginApi {
    /** Register a tool. The second arg mirrors the observed `{ name }` options. */
    registerTool(tool: OpenClawTool, options?: {
        name?: string;
    }): void;
    /** Register CLI commands (ASSUMED — only used if present). */
    registerCli?(setup: (ctx: {
        program: unknown;
    }) => void, options?: {
        commands?: string[];
    }): void;
    /** Subscribe to a lifecycle event (ASSUMED — only used if present). */
    on?(event: string, handler: (...args: unknown[]) => unknown): void;
    /** The raw plugin config OpenClaw passes for this slot (unknown until parsed). */
    pluginConfig?: unknown;
}
/** The parsed, defaulted config for the Solid memory plugin. */
export interface SolidMemoryPluginConfig {
    /** Absolute http(s) container URL the memories live under. REQUIRED. */
    container: string;
    /** The producing agent's WebID (`prov:wasAttributedTo`). Optional. */
    agentWebId?: string;
    /** Default generating-conversation IRI (`prov:wasGeneratedBy`). Optional. */
    defaultGeneratedBy?: string;
    /** Default recall result cap when a tool call omits `limit`. Default 10. */
    defaultLimit: number;
}
/** A config schema with a `parse` that normalises + applies defaults. */
export interface ConfigSchema<C> {
    parse(value: unknown): C;
}
/**
 * The OpenClaw memory-slot plugin object (the wrapper's return type). Matches the
 * VERIFIED export shape `{ id, name, description, kind:"memory", configSchema,
 * register(api) }`.
 */
export interface OpenClawMemoryPlugin {
    id: string;
    name: string;
    description: string;
    kind: "memory";
    configSchema: ConfigSchema<SolidMemoryPluginConfig>;
    register(api: OpenClawPluginApi): void;
}
/**
 * Options for {@link createOpenClawMemoryPlugin}. Provide an authenticated
 * `fetch` (the pod credentials are the consumer's concern — OpenClaw config is
 * plain data, so the fetch is injected in code, not via JSON config) and,
 * optionally, a pre-built adapter or store. Container + provenance come either
 * from these options or from the parsed plugin config at `register` time.
 */
export interface CreateOpenClawMemoryPluginOptions {
    /**
     * The injected, already-authenticated pod `fetch`. Required UNLESS a ready
     * `adapter` is supplied (which already holds its fetch).
     */
    fetch?: typeof globalThis.fetch;
    /**
     * A pre-built {@link SolidMemoryAdapter} to use as-is (advanced / testing).
     * When given, `fetch` / container / provenance options are ignored — the
     * adapter is authoritative.
     */
    adapter?: SolidMemoryAdapter;
    /**
     * Container default if the plugin config omits `container` (config wins when
     * present).
     */
    container?: string;
    /** Default agent WebID (config `agentWebId` wins when present). */
    agentWebId?: string;
    /** Default generating-conversation IRI (config `defaultGeneratedBy` wins). */
    defaultGeneratedBy?: string;
    /** Default recall cap if config omits `defaultLimit`. Default 10. */
    defaultLimit?: number;
    /** Override the plugin `id` (default `"memory-solid"`). */
    id?: string;
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
export declare function createOpenClawMemoryPlugin(opts?: CreateOpenClawMemoryPluginOptions): OpenClawMemoryPlugin;
//# sourceMappingURL=plugin.d.ts.map