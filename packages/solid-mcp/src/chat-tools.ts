// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import {
  CHAT_PROVIDERS,
  CHAT_ROLES,
  type ChatPodPort,
  ChatWriter,
  chatConversationId,
  normalizeChatAccount,
  renderTranscript,
} from "@jeswr/solid-chat-interop";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  requirePodScopedWriteUrl,
  type SolidMcpConfig,
  scopedFetch,
  writesEnabled,
} from "./auth.js";
import { PodOutput, podOutputError } from "./output.js";
import { containerCandidates } from "./pod.js";
import { withPodReadLimits } from "./pod-operation.js";
import { createFetchPodPort, type PodPort } from "./pod-port.js";
import { wacAclLink } from "./wac-link.js";

/** Chat storage settings. A PodPort-only server (such as storage-client) has no raw fetch. */
export type ChatPodConfig = Omit<SolidMcpConfig, "fetch"> & { fetch?: typeof fetch };

/**
 * Adapt the chat storage surface to a pod capability. With `config.fetch`, ACLs are discovered
 * with a direct HEAD as before. Without it, `pod` must implement `head`, which promises no
 * redirects, retained Links on 404 and a thrown error on invalid metadata; its advertised ACL is
 * then held to the same pod-scope and shape checks.
 */
export function createChatPodPort(config: ChatPodConfig, pod?: PodPort): ChatPodPort {
  const direct = config.fetch;
  const source = pod ?? (direct ? createFetchPodPort({ ...config, fetch: direct }) : undefined);
  if (!source) throw new TypeError("Chat storage requires a fetch or a PodPort");
  const head = source.head;
  if (!direct && !head) throw new TypeError("Chat ACL discovery requires PodPort.head");
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
    // Only reached without a PodPort, so the direct fetch exists.
    const response = await scopedFetch({ ...config, fetch: direct as typeof fetch })(input, init);
    if (!response.ok) return response;
    requireChatRdf(response.headers.get("content-type") ?? "text/turtle");
    return response;
  };
  return {
    root: config.podRoot,
    webId: config.webId ?? "",
    async discoverAcl(url) {
      const target = requirePodScopedWriteUrl(config, url);
      let link: string;
      if (direct) {
        // Inspect this exact resource, including a not-yet-created container's 404.
        const response = await direct(target, { method: "HEAD", redirect: "manual" });
        if (response.status !== 404) check(response);
        link = wacAclLink(response.headers.get("link") ?? "");
      } else {
        const advertised = (await head?.call(source, target))?.acl;
        if (!advertised) throw new Error("A unique WAC ACL link is required for chats");
        link = advertised;
      }
      const acl = new URL(link, target);
      if (acl.hash || acl.search || acl.href === target)
        throw new Error("Invalid chat ACL resource URL");
      return requirePodScopedWriteUrl(config, acl.href);
    },
    async read(url) {
      return portOperation(() =>
        withPodReadLimits(async () => {
          const output = new PodOutput(source);
          const raw = await output.read(url, { accept: "text/turtle" });
          requireChatRdf(raw.contentType || "text/turtle");
          const read = await output.representation(url, raw);
          return { ...read, contentType: read.contentType || "text/turtle" };
        }),
      );
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
      return portOperation(() => new PodOutput(source).write(target, body, contentType, cond));
    },
  };
}

export function registerChatTools(server: McpServer, config: ChatPodConfig, port?: PodPort): void {
  const fetch = config.fetch;
  const pod = port ?? (fetch ? createFetchPodPort({ ...config, fetch }) : undefined);
  if (!pod) throw new TypeError("Chat tools require a fetch or a PodPort");
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
  const account = z
    .string()
    .max(256)
    .refine((value) => {
      try {
        normalizeChatAccount(value);
        return true;
      } catch {
        return false;
      }
    }, "Invalid chat account label")
    .describe(
      "Optional owner-chosen account label (1-64 characters). With an account, conversationId is the SOURCE conversation id; the stored id is derived from both, so never pass an id returned by chat_list here.",
    )
    .optional();
  server.registerTool(
    "chat_save",
    {
      description:
        "Save an owner-only AS2 conversation. Requires readOnly:false. Message IDs are immutable; first title wins. When `account` is set, conversationId must be the source conversation id (the stored id is derived from account and source id); to append to a stored conversation, resend the same source id and account.",
      inputSchema: {
        provider,
        conversationId: id,
        title: z.string(),
        account,
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
        const saved = await writer().save({
          ...conversation,
          conversationId: await chatConversationId(
            conversation.conversationId,
            conversation.account,
          ),
          channel: "mcp",
        });
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
        account,
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
  // AUTHORED-BY Claude Opus 5.5
  server.registerTool(
    "chat_export",
    {
      description:
        "Export a saved conversation as a redacted Markdown transcript to continue it in another account.",
      inputSchema: { provider, conversationId: id },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ provider, conversationId }) => {
      try {
        const conversation = await writer().get(provider, conversationId);
        const permitted = await new PodOutput(pod).resource(conversation);
        return await result(
          permitted
            ? {
                url: permitted.url,
                ...(permitted.account === undefined ? {} : { account: permitted.account }),
                ...(permitted.channel === undefined ? {} : { channel: permitted.channel }),
                markdown: renderTranscript(permitted),
              }
            : {},
        );
      } catch (e) {
        return error(e);
      }
    },
  );
}
