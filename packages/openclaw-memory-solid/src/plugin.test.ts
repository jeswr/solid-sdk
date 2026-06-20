// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
//
// Tests for the thin OpenClaw plugin wrapper: configSchema.parse defaults +
// validation, register(api) tool registration, and a tool execute() round-trip
// through a REAL MemoryStore over an in-memory fake-LDP fetch (no mocked store).

import { describe, expect, it } from "vitest";
import {
  createOpenClawMemoryPlugin,
  type OpenClawPluginApi,
  type OpenClawTool,
  type OpenClawToolResult,
} from "./plugin.js";

const CONTAINER = "https://alice.pod/agent/memories/";
const AGENT_WEBID = "https://agent.example/profile/card#me";

/** Same fake pod as core.test.ts (in-memory LDP). */
function makePod() {
  const store = new Map<string, { body: string; etag: string }>();
  let etagSeq = 0;
  const nextEtag = () => `"etag-${++etagSeq}"`;

  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers ?? {});

    if (url === CONTAINER && method === "GET") {
      const members = [...store.keys()].filter((u) => u !== CONTAINER && u.startsWith(CONTAINER));
      const contains = members.map((u) => `<${u}>`).join(", ");
      const body = `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${CONTAINER}> a ldp:Container, ldp:BasicContainer${contains ? ` ;\n  ldp:contains ${contains}` : ""} .`;
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/turtle", etag: nextEtag() },
      });
    }
    if (method === "GET") {
      const entry = store.get(url);
      if (!entry) return new Response(null, { status: 404 });
      return new Response(entry.body, {
        status: 200,
        headers: { "content-type": "text/turtle", etag: entry.etag },
      });
    }
    if (method === "PUT") {
      const existing = store.get(url);
      if (headers.get("if-none-match") === "*" && existing)
        return new Response(null, { status: 412 });
      const body = typeof init?.body === "string" ? init.body : String(init?.body ?? "");
      const etag = nextEtag();
      store.set(url, { body, etag });
      return new Response(null, { status: existing ? 205 : 201, headers: { etag } });
    }
    if (method === "DELETE") {
      const existing = store.get(url);
      if (!existing) return new Response(null, { status: 404 });
      store.delete(url);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  };

  return { store, fetchImpl };
}

/** A tiny fake OpenClaw `api` that captures registered tools. */
function makeApi(pluginConfig: unknown): {
  api: OpenClawPluginApi;
  tools: Map<string, OpenClawTool>;
  getTool(name: string): OpenClawTool;
} {
  const tools = new Map<string, OpenClawTool>();
  const api: OpenClawPluginApi = {
    pluginConfig,
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
  };
  const getTool = (name: string): OpenClawTool => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`test: tool "${name}" was not registered`);
    return tool;
  };
  return { api, tools, getTool };
}

/** Parse the JSON text out of an OpenClaw tool result envelope. */
function parseResult(result: OpenClawToolResult): unknown {
  expect(result.content).toHaveLength(1);
  const first = result.content[0];
  if (!first) throw new Error("test: empty tool result content");
  expect(first.type).toBe("text");
  return JSON.parse(first.text);
}

describe("configSchema.parse", () => {
  it("applies defaults and requires container", () => {
    const plugin = createOpenClawMemoryPlugin({ fetch: makePod().fetchImpl });
    const config = plugin.configSchema.parse({ container: CONTAINER });
    expect(config.container).toBe(CONTAINER);
    expect(config.defaultLimit).toBe(10);
    expect(config.agentWebId).toBeUndefined();
  });

  it("normalizes a provided defaultLimit + agentWebId", () => {
    const plugin = createOpenClawMemoryPlugin({ fetch: makePod().fetchImpl });
    const config = plugin.configSchema.parse({
      container: CONTAINER,
      agentWebId: AGENT_WEBID,
      defaultLimit: 3.9,
    });
    expect(config.agentWebId).toBe(AGENT_WEBID);
    expect(config.defaultLimit).toBe(3);
  });

  it("throws when container is missing and no opts default", () => {
    const plugin = createOpenClawMemoryPlugin({ fetch: makePod().fetchImpl });
    expect(() => plugin.configSchema.parse({})).toThrow(/container/);
  });

  it("falls back to an opts container default when config omits it", () => {
    const plugin = createOpenClawMemoryPlugin({ fetch: makePod().fetchImpl, container: CONTAINER });
    expect(plugin.configSchema.parse({}).container).toBe(CONTAINER);
  });
});

describe("plugin identity + shape", () => {
  it("has the verified export shape", () => {
    const plugin = createOpenClawMemoryPlugin({ fetch: makePod().fetchImpl });
    expect(plugin.kind).toBe("memory");
    expect(typeof plugin.id).toBe("string");
    expect(typeof plugin.name).toBe("string");
    expect(typeof plugin.description).toBe("string");
    expect(typeof plugin.register).toBe("function");
    expect(typeof plugin.configSchema.parse).toBe("function");
  });

  it("createOpenClawMemoryPlugin requires fetch or adapter at register time", () => {
    const plugin = createOpenClawMemoryPlugin({}); // no fetch, no adapter
    const { api } = makeApi({ container: CONTAINER });
    expect(() => plugin.register(api)).toThrow(/fetch|adapter/);
  });
});

describe("register(api) registers the expected tools", () => {
  it("registers memory_store/recall/search/get/forget", () => {
    const plugin = createOpenClawMemoryPlugin({ fetch: makePod().fetchImpl });
    const { api, tools } = makeApi({ container: CONTAINER });
    plugin.register(api);
    expect([...tools.keys()].sort()).toEqual(
      ["memory_forget", "memory_get", "memory_recall", "memory_search", "memory_store"].sort(),
    );
  });
});

describe("tool execute round-trips through a real pod", () => {
  it("memory_store then memory_recall returns the stored memory in the text envelope", async () => {
    const { fetchImpl } = makePod();
    const plugin = createOpenClawMemoryPlugin({ fetch: fetchImpl, agentWebId: AGENT_WEBID });
    const { api, getTool } = makeApi({ container: CONTAINER });
    plugin.register(api);

    const storeResult = await getTool("memory_store").execute("call-1", {
      content: "remember the launch date",
    });
    const stored = parseResult(storeResult) as { id: string; memory: string };
    expect(stored.memory).toBe("remember the launch date");
    expect(stored.id.startsWith(CONTAINER)).toBe(true);

    const recallResult = await getTool("memory_recall").execute("call-2", { query: "launch" });
    const recalled = parseResult(recallResult) as Array<{ id: string; memory: string }>;
    expect(recalled).toHaveLength(1);
    expect(recalled[0]?.id).toBe(stored.id);
    expect(recalled[0]?.memory).toBe("remember the launch date");
  });

  it("memory_get returns the memory, then memory_forget deletes it (get → null)", async () => {
    const { fetchImpl } = makePod();
    const plugin = createOpenClawMemoryPlugin({ fetch: fetchImpl });
    const { api, getTool } = makeApi({ container: CONTAINER });
    plugin.register(api);

    const stored = parseResult(
      await getTool("memory_store").execute("c", { content: "ephemeral" }),
    ) as { id: string };

    const got = parseResult(await getTool("memory_get").execute("c", { id: stored.id })) as {
      memory: string;
    } | null;
    expect(got?.memory).toBe("ephemeral");

    const forgot = parseResult(await getTool("memory_forget").execute("c", { id: stored.id })) as {
      ok: boolean;
    };
    expect(forgot.ok).toBe(true);

    const after = parseResult(await getTool("memory_get").execute("c", { id: stored.id }));
    expect(after).toBeNull();
  });

  it("memory_forget of an out-of-container id is a clean error result", async () => {
    const { fetchImpl } = makePod();
    const plugin = createOpenClawMemoryPlugin({ fetch: fetchImpl });
    const { api, getTool } = makeApi({ container: CONTAINER });
    plugin.register(api);

    const result = await getTool("memory_forget").execute("c", {
      id: "https://evil.example/steal",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/outside the configured memory container|refused/i);
  });

  it("memory_store with empty content returns a clean error result", async () => {
    const { fetchImpl } = makePod();
    const plugin = createOpenClawMemoryPlugin({ fetch: fetchImpl });
    const { api, getTool } = makeApi({ container: CONTAINER });
    plugin.register(api);
    const result = await getTool("memory_store").execute("c", { content: "" });
    expect(result.isError).toBe(true);
  });

  it("memory_search filters by keywords through the pod", async () => {
    const { fetchImpl } = makePod();
    const plugin = createOpenClawMemoryPlugin({ fetch: fetchImpl });
    const { api, getTool } = makeApi({ container: CONTAINER });
    plugin.register(api);
    await getTool("memory_store").execute("c", { content: "tagged", keywords: ["alpha"] });
    await getTool("memory_store").execute("c", { content: "other", keywords: ["beta"] });
    // memory_search is an alias of recall (free-text query) in this build.
    const result = await getTool("memory_search").execute("c", { query: "tagged" });
    const found = parseResult(result) as Array<{ memory: string }>;
    expect(found.map((m) => m.memory)).toEqual(["tagged"]);
  });

  it("memory_recall respects the configured defaultLimit", async () => {
    const { fetchImpl } = makePod();
    const plugin = createOpenClawMemoryPlugin({ fetch: fetchImpl });
    const { api, getTool } = makeApi({ container: CONTAINER, defaultLimit: 2 });
    plugin.register(api);
    for (let i = 0; i < 5; i++) {
      await getTool("memory_store").execute("c", { content: `memory topic ${i}` });
    }
    const result = await getTool("memory_recall").execute("c", { query: "topic" });
    const recalled = parseResult(result) as unknown[];
    expect(recalled).toHaveLength(2);
  });

  it("a pre-built adapter is used as-is (no fetch needed on opts)", async () => {
    const { fetchImpl } = makePod();
    // Build an adapter via the core through the plugin's own surface: use opts.adapter.
    const { SolidMemoryAdapter } = await import("./core.js");
    const adapter = new SolidMemoryAdapter({ container: CONTAINER, fetch: fetchImpl });
    const plugin = createOpenClawMemoryPlugin({ adapter });
    const { api, getTool } = makeApi({ container: CONTAINER });
    plugin.register(api);
    const stored = parseResult(
      await getTool("memory_store").execute("c", { content: "via adapter opt" }),
    ) as { id: string };
    expect(stored.id.startsWith(CONTAINER)).toBe(true);
  });
});
