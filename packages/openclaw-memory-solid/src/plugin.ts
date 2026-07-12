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

import {
  type ForgetResult,
  type MemoryRecord,
  SolidMemoryAdapter,
  type SolidMemoryAdapterOptions,
  type StoreResult,
} from "./core.js";

// ---------------------------------------------------------------------------
// Minimal local OpenClaw plugin types (no unpublished @openclaw dependency).
// ---------------------------------------------------------------------------

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
  content: Array<{ type: "text"; text: string }>;
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
  registerTool(tool: OpenClawTool, options?: { name?: string }): void;
  /** Register CLI commands (ASSUMED — only used if present). */
  registerCli?(setup: (ctx: { program: unknown }) => void, options?: { commands?: string[] }): void;
  /** Subscribe to a lifecycle event (ASSUMED — only used if present). */
  on?(event: string, handler: (...args: unknown[]) => unknown): void;
  /** The raw plugin config OpenClaw passes for this slot (unknown until parsed). */
  pluginConfig?: unknown;
  /**
   * An authenticated pod `fetch` the host MAY surface to a memory plugin (ASSUMED
   * — only used as a fallback when the factory was not given a `fetch`/`adapter`).
   * This is the seam the bare `dist/plugin.js` default-export extension relies on:
   * a host that provides `api.fetch` (or `api.podFetch`) lets the default plugin
   * authenticate without a user-written wrapper. Exact name is ASSUMED; both are
   * probed. See the README "VERIFIED vs ASSUMED" section.
   */
  fetch?: typeof globalThis.fetch;
  /** Alternative name for the host-provided authenticated pod fetch (ASSUMED). */
  podFetch?: typeof globalThis.fetch;
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

// ---------------------------------------------------------------------------
// Options for building the plugin.
// ---------------------------------------------------------------------------

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

const DEFAULT_LIMIT = 10;

/** Read a string field from an unknown record, or `undefined`. */
function strOf(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Assert `value` is an absolute http(s) URL, throwing a clear config error
 * otherwise. (Defence in depth: `MemoryStore` re-validates + normalises the
 * container too, but validating at config-parse time gives a clearer, earlier
 * error and satisfies the documented `configSchema.parse` contract.)
 */
function assertHttpUrl(value: string, field: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `[openclaw-memory-solid] config \`${field}\` must be an absolute URL, got: ${value}`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `[openclaw-memory-solid] config \`${field}\` must be an http(s) URL, got protocol: ${url.protocol}`,
    );
  }
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
export function createOpenClawMemoryPlugin(
  opts: CreateOpenClawMemoryPluginOptions = {},
): OpenClawMemoryPlugin {
  const configSchema: ConfigSchema<SolidMemoryPluginConfig> = {
    parse(value: unknown): SolidMemoryPluginConfig {
      const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
      const container = strOf(raw, "container") ?? opts.container;
      if (!container) {
        throw new Error(
          "[openclaw-memory-solid] plugin config is missing `container` (the absolute http(s) Solid container URL memories live under).",
        );
      }
      // Validate the container is an absolute http(s) URL HERE (the documented
      // `configSchema.parse` contract — the README / manifest say so), rather than
      // deferring to `MemoryStore`'s constructor at `register` time. This makes
      // validation timing consistent: a bad container fails at config parse.
      assertHttpUrl(container, "container");
      const rawLimit = raw.defaultLimit;
      const defaultLimit =
        typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit >= 0
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
    description:
      "Store agent memory in the user's own Solid pod (RDF-native, portable, owner-owned) via @jeswr/solid-memory.",
    kind: "memory",
    configSchema,

    register(api: OpenClawPluginApi): void {
      const config = configSchema.parse(api.pluginConfig);

      // Build the adapter. A supplied adapter is authoritative; otherwise we need
      // an authenticated fetch — preferring the factory `opts.fetch`, falling back
      // to a host-provided `api.fetch` / `api.podFetch` (the seam the bare
      // default-export extension relies on; ASSUMED, only used if present).
      let adapter: SolidMemoryAdapter;
      if (opts.adapter) {
        adapter = opts.adapter;
      } else {
        const authFetch = opts.fetch ?? api.fetch ?? api.podFetch;
        if (typeof authFetch !== "function") {
          throw new Error(
            "[openclaw-memory-solid] no authenticated pod fetch available: pass `fetch` (or a pre-built `adapter`) to createOpenClawMemoryPlugin, or have the host provide `api.fetch`/`api.podFetch`. See the README OpenClaw configuration section.",
          );
        }
        const adapterOptions: SolidMemoryAdapterOptions = {
          container: config.container,
          fetch: authFetch,
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
function buildTools(adapter: SolidMemoryAdapter, defaultLimit: number): OpenClawTool[] {
  const recall: OpenClawTool = {
    name: "memory_recall",
    label: "Recall memories",
    description:
      "Recall stored memories matching a free-text query (case-insensitive substring over the memory body). Returns the most relevant memories with their stable ids.",
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

  const search: OpenClawTool = {
    name: "memory_search",
    label: "Search memories",
    description:
      "Alias of memory_recall — search stored memories by a free-text query. (memory_search is a documented alias of memory_recall.)",
    parameters: recall.parameters,
    execute: recall.execute,
  };

  const storeTool: OpenClawTool = {
    name: "memory_store",
    label: "Store a memory",
    description:
      "Store a memory in the user's Solid pod. Attributed to the configured agent WebID; optionally linked to the generating conversation.",
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

  const get: OpenClawTool = {
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
      if (id.length === 0) return errorResult("memory_get requires `id`.");
      const record = await adapter.get(id);
      return textResult(record);
    },
  };

  const forget: OpenClawTool = {
    name: "memory_forget",
    label: "Forget a memory",
    description:
      "Forget (delete) a memory by its id (pod URL). An id outside the configured container is refused cleanly (no request issued).",
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
      if (id.length === 0) return errorResult("memory_forget requires `id`.");
      const result: ForgetResult = await adapter.forget(id);
      if (!result.ok) {
        return errorResult(result.message);
      }
      return textResult(result);
    },
  };

  return [recall, search, storeTool, get, forget];
}

/** Coerce an unknown value into a string[] (dropping non-string entries). */
function stringArrayOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === "string");
  return out.length > 0 ? out : undefined;
}

/** Wrap any JSON-serialisable result in the OpenClaw tool-result envelope. */
function textResult(
  data: MemoryRecord | MemoryRecord[] | StoreResult | ForgetResult | null,
): OpenClawToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** An error tool-result (clean failure, never an unhandled crash). */
function errorResult(message: string): OpenClawToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * The DEFAULT export — the plugin object an OpenClaw extension module exposes. The
 * `package.json` `openclaw.extensions` field points at the built `dist/plugin.js`,
 * and OpenClaw loads an extension by reading its default export, so this module is
 * a valid extension on its own.
 *
 * It is built with NO injected `fetch`, so its `register(api)` resolves the
 * authenticated pod fetch from the host (`api.fetch` / `api.podFetch`) and the
 * container/agent from the plugin config in `openclaw.json`. If the host does not
 * surface an authenticated fetch (the seam is ASSUMED — see "VERIFIED vs ASSUMED"
 * in the README), `register` throws a clear error directing the user to the
 * code-injection wrapper (`examples/index.ts`), which calls
 * {@link createOpenClawMemoryPlugin} with an explicit `fetch`. Either path yields
 * the same plugin; the wrapper is the portable one when the host has no fetch seam.
 */
const plugin: OpenClawMemoryPlugin = createOpenClawMemoryPlugin();
export default plugin;
