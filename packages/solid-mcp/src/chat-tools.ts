// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import {
  CHAT_PROVIDERS,
  CHAT_ROLES,
  type ChatPodPort,
  ChatWriter,
} from "@jeswr/solid-chat-interop";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  requirePodScopedUrl,
  requirePodScopedWriteUrl,
  type SolidMcpConfig,
  scopedFetch,
  writesEnabled,
} from "./auth.js";
import { containerCandidates } from "./pod.js";

/** Parse a conservative Link-header subset; ambiguous/unsupported discovery fails closed. */
function wacAclLink(header: string): string {
  const acls: string[] = [];
  let remaining = header;
  while (remaining.trim()) {
    const link =
      /^\s*<([^<>]*)>((?:\s*;\s*[\w-]+\s*=\s*(?:"(?:[^"\\]|\\.)*"|[^\s;,"]+))*)\s*(?:,|$)/.exec(
        remaining,
      );
    if (!link) throw new Error("Invalid chat ACL discovery Link header");
    remaining = remaining.slice(link[0].length);
    const params = new Map<string, string>();
    for (const param of (link[2] ?? "").matchAll(
      /;\s*([\w-]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^\s;,"]+)/g,
    )) {
      const name = (param[1] ?? "").toLowerCase();
      const raw = param[2] ?? "";
      if (params.has(name)) throw new Error("Ambiguous chat ACL discovery Link header");
      params.set(name, raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, "$1") : raw);
    }
    const relations = (params.get("rel") ?? "").split(/\s+/);
    if (relations.includes("http://www.w3.org/ns/solid/acp#accessControl"))
      throw new Error("Unsupported chat access-control model: ACP");
    if (relations.includes("acl")) {
      if (params.has("anchor")) throw new Error("Unsupported anchored chat ACL link");
      acls.push(link[1] ?? "");
    }
  }
  if (acls.length !== 1 || !acls[0]) throw new Error("A unique WAC ACL link is required for chats");
  return acls[0];
}

/** Adapt only the chat storage surface while MCP-01's shared port is absent. */
export function createChatPodPort(config: SolidMcpConfig): ChatPodPort {
  const fetch = scopedFetch(config);
  function check(response: Response): void {
    if (!response.ok)
      throw Object.assign(new Error(`Chat pod request failed (${response.status})`), {
        status: response.status,
      });
  }
  // Container parsing must not let a foreign JSON-LD context bypass pod scope.
  const rdfFetch: typeof globalThis.fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (!response.ok) return response;
    const mediaType = (response.headers.get("content-type") ?? "text/turtle")
      .replace(/;.*/, "")
      .trim()
      .toLowerCase();
    if (
      !["text/turtle", "application/n-triples", "application/n-quads", "application/trig"].includes(
        mediaType,
      )
    )
      throw new Error("Unsupported chat RDF content type");
    return response;
  };
  return {
    root: config.podRoot,
    webId: config.webId ?? "",
    async discoverAcl(url) {
      const target = requirePodScopedWriteUrl(config, url);
      // Inspect this exact resource, including a not-yet-created container's 404.
      const response = await config.fetch(target, { method: "HEAD", redirect: "manual" });
      if (response.status !== 404) check(response);
      const acl = new URL(wacAclLink(response.headers.get("link") ?? ""), target);
      if (acl.hash || acl.search || acl.href === target)
        throw new Error("Invalid chat ACL resource URL");
      return requirePodScopedWriteUrl(config, acl.href);
    },
    async read(url) {
      const response = await rdfFetch(requirePodScopedUrl(config, url), {
        headers: { accept: "text/turtle" },
      });
      check(response);
      return {
        body: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") ?? "text/turtle",
      };
    },
    async list(container) {
      // ChatWriter reads metadata and every message before returning a result.
      // Preserve those read errors instead of silently filtering missing messages.
      return containerCandidates({ ...config, fetch: rdfFetch }, container);
    },
    async write(url, body, contentType, cond) {
      if (!writesEnabled(config)) throw new Error("write disabled: server is read-only");
      const target = requirePodScopedWriteUrl(config, url);
      const headers = new Headers({ "content-type": contentType });
      if (cond.ifMatch !== undefined) headers.set("if-match", cond.ifMatch);
      if (cond.ifNoneMatch !== undefined) headers.set("if-none-match", cond.ifNoneMatch);
      const response = await config.fetch(target, {
        method: "PUT",
        headers,
        body: new Uint8Array(body),
        redirect: "manual",
      });
      if (response.status >= 300 && response.status < 400)
        throw new Error(`Refusing a redirect (${response.status}) on a chat write`);
      check(response);
      const etag = response.headers.get("etag");
      return etag === null ? {} : { etag };
    },
  };
}

export function registerChatTools(server: McpServer, config: SolidMcpConfig): void {
  const writer = () => new ChatWriter(createChatPodPort(config));
  const result = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  });
  const error = (value: unknown) => ({
    isError: true,
    content: [
      { type: "text" as const, text: value instanceof Error ? value.message : String(value) },
    ],
  });
  const provider = z.enum(CHAT_PROVIDERS);
  const id = z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/);
  server.registerTool(
    "chat_save",
    {
      description:
        "Save an owner-only AS2 conversation. Requires readOnly:false. Message IDs are immutable; first title wins.",
      inputSchema: {
        provider,
        conversationId: id,
        title: z.string(),
        messages: z.array(
          z.object({
            id: id.optional(),
            role: z.enum(CHAT_ROLES),
            text: z.string(),
            createdAt: z.iso.datetime({ offset: true }),
          }),
        ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (conversation) => {
      try {
        if (!writesEnabled(config))
          throw new Error(
            "write disabled: server is read-only (set readOnly:false to enable writes)",
          );
        return result(await writer().save(conversation));
      } catch (e) {
        return error(e);
      }
    },
  );
  server.registerTool(
    "chat_list",
    {
      description:
        "List saved conversations in URL order. since is exclusive (latest message time); cursor is the previous nextCursor.",
      inputSchema: {
        provider: provider.optional(),
        since: z.iso.datetime({ offset: true }).optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (options) => {
      try {
        return result(await writer().list(options));
      } catch (e) {
        return error(e);
      }
    },
  );
  server.registerTool(
    "chat_get",
    {
      description:
        "Read a saved conversation with canonical message text, roles, IDs and timestamps.",
      inputSchema: { provider, conversationId: id },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ provider, conversationId }) => {
      try {
        return result(await writer().get(provider, conversationId));
      } catch (e) {
        return error(e);
      }
    },
  );
}
