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
import { PodOutput, podOutputError } from "./output.js";
import { containerCandidates } from "./pod.js";
import { withPodReadLimits } from "./pod-operation.js";
import { createFetchPodPort, type PodPort } from "./pod-port.js";

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
export function createChatPodPort(config: SolidMcpConfig, pod?: PodPort): ChatPodPort {
  const fetch = scopedFetch(config);
  function check(response: Response): void {
    if (!response.ok)
      throw Object.assign(new Error(`Chat pod request failed (${response.status})`), {
        status: response.status,
      });
  }
  async function portOperation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      // ChatWriter distinguishes absent/create-conflict resources from failures.
      // Keep that structural status when using the shared byte port.
      if (error instanceof Error && !("status" in error)) {
        const status = /\bHTTP (\d{3})\b/.exec(error.message)?.[1];
        if (status) Object.assign(error, { status: Number(status) });
      }
      throw error;
    }
  }
  function requireChatRdf(contentType: string): void {
    const mediaType = contentType.replace(/;.*/, "").trim().toLowerCase();
    if (
      !["text/turtle", "application/n-triples", "application/n-quads", "application/trig"].includes(
        mediaType,
      )
    )
      throw new Error("Unsupported chat RDF content type");
  }
  // Container parsing must not let a foreign JSON-LD context bypass pod scope.
  const rdfFetch: typeof globalThis.fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (!response.ok) return response;
    requireChatRdf(response.headers.get("content-type") ?? "text/turtle");
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
      if (pod) {
        const read = await portOperation(() =>
          new PodOutput(pod).read(url, { accept: "text/turtle" }),
        );
        requireChatRdf(read.contentType || "text/turtle");
        return { ...read, contentType: read.contentType || "text/turtle" };
      }
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
      if (pod) {
        return portOperation(() =>
          withPodReadLimits(async () => {
            const output = new PodOutput(pod);
            const read = await output.read(container, { accept: "text/turtle" });
            requireChatRdf(read.contentType || "text/turtle");
            const children = [];
            for (const child of await containerCandidates(pod, container)) {
              // Containers are conversation candidates; a denied conversation
              // cannot enter the writer or leave a title/cursor in its results.
              // Message files are read by ChatWriter, preserving read failures.
              const projected = child.isContainer ? await output.resource(child) : child;
              if (projected !== undefined) children.push(projected);
            }
            return children;
          }),
        );
      }
      return containerCandidates({ ...config, fetch: rdfFetch }, container);
    },
    async write(url, body, contentType, cond) {
      if (!writesEnabled(config)) throw new Error("write disabled: server is read-only");
      const target = requirePodScopedWriteUrl(config, url);
      if (pod) return portOperation(() => pod.write(target, body, contentType, cond));
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

export function registerChatTools(
  server: McpServer,
  config: SolidMcpConfig,
  pod: PodPort = createFetchPodPort(config),
): void {
  const writer = () => new ChatWriter(createChatPodPort(config, pod));
  const result = async (value: unknown) => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value),
      },
    ],
  });
  const error = (value: unknown) => ({
    isError: true,
    content: [{ type: "text" as const, text: podOutputError(value).message }],
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
        const saved = await writer().save(conversation);
        return await result((await new PodOutput(pod).resource(saved)) ?? {});
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
        const listed = await writer().list(options);
        const output = new PodOutput(pod);
        const conversations = [];
        for (const conversation of listed.conversations) {
          const permitted = await output.resource(conversation);
          if (permitted) conversations.push(permitted);
        }
        const cursor = listed.nextCursor
          ? await output.resource({ url: listed.nextCursor })
          : undefined;
        return await result({ conversations, ...(cursor ? { nextCursor: cursor.url } : {}) });
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
        const conversation = await writer().get(provider, conversationId);
        return await result((await new PodOutput(pod).resource(conversation)) ?? {});
      } catch (e) {
        return error(e);
      }
    },
  );
}
