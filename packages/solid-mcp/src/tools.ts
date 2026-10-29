// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { requirePodScopedUrl } from "./auth.js";
import { fetchDocument } from "./fetch.js";
import { podOutputError } from "./output.js";
import {
  listContainer,
  RDF_MEDIA_TYPES,
  readRdf,
  readResource,
  search,
  writeResource,
} from "./pod.js";
import type { PodPort } from "./pod-port.js";

/** A registered tool, including its schema, read-only annotation and guarded handler. */
export interface PodTool {
  /** Canonical MCP tool name. */
  name: string;
  /** Compatibility names retained for the 0.2 release. */
  aliases: readonly string[];
  /** Human-readable tool title. */
  title: string;
  /** Tool behavior and restrictions. */
  description: string;
  /** Zod object schema, emitted as JSON Schema by the MCP SDK. */
  inputSchema: z.ZodObject;
  /** Whether the handler is non-mutating. */
  readOnly: boolean;
  /** Validate and execute, returning tool errors instead of throwing. */
  handler(input: unknown): Promise<CallToolResult>;
}

function toolText(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function toolError(error: unknown): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: podOutputError(error).message }],
  };
}

function defineTool<Shape extends z.ZodRawShape>(
  definition: Omit<PodTool, "inputSchema" | "handler"> & {
    inputSchema: z.ZodObject<Shape>;
    handler(input: z.output<z.ZodObject<Shape>>): Promise<CallToolResult>;
  },
  readOnly: boolean,
): PodTool {
  return {
    ...definition,
    async handler(input) {
      if (!definition.readOnly && readOnly) {
        return toolError(
          "write disabled: server is read-only (set readOnly:false to enable writes).",
        );
      }
      try {
        return await definition.handler(definition.inputSchema.parse(input));
      } catch (error) {
        return toolError(error);
      }
    },
  };
}

/** Build pod tools and ChatGPT search/fetch; legacy search retains its array response. */
export function createPodToolRegistry(pod: PodPort, readOnly = true): readonly PodTool[] {
  return [
    defineTool(
      {
        name: "search",
        aliases: [],
        title: "Search the Solid pod",
        readOnly: true,
        description:
          "Search by resource name, URL, or RDF literals, including memory notes and chat titles. Returns {results:[{id,title,url}]} within bounded depth, resources, and time.",
        inputSchema: z.object({ query: z.string().describe("Case-insensitive search term.") }),
        async handler({ query }) {
          const matches = await search(pod, query);
          return toolText(
            JSON.stringify({
              results: matches.map(({ url, name }) => ({ id: url, title: name, url })),
            }),
          );
        },
      },
      readOnly,
    ),
    defineTool(
      {
        name: "fetch",
        aliases: [],
        title: "Fetch a Solid resource",
        readOnly: true,
        description:
          "Fetch a pod URL from search. Returns {id,title,text,url,metadata}: RDF as Turtle, text/* as text, binary metadata only; metadata.truncated flags the 1 MiB cap.",
        inputSchema: z.object({ id: z.string().describe("Absolute resource URL within the pod.") }),
        async handler({ id }) {
          return toolText(JSON.stringify(await fetchDocument(pod, id)));
        },
      },
      readOnly,
    ),
    defineTool(
      {
        name: "pod_list",
        aliases: ["solid_list"],
        title: "List a Solid container",
        readOnly: true,
        description:
          "List immediate children of an in-pod container, with available resource metadata.",
        inputSchema: z.object({ container: z.string().describe("Container URL within the pod.") }),
        async handler({ container }) {
          return toolText(JSON.stringify(await listContainer(pod, container), null, 2));
        },
      },
      readOnly,
    ),
    defineTool(
      {
        name: "pod_read",
        aliases: ["solid_read"],
        title: "Read a Solid resource",
        readOnly: true,
        description: "Read an in-pod resource as Turtle, text, or base64 for binary data.",
        inputSchema: z.object({ url: z.string().describe("Resource URL within the pod.") }),
        async handler({ url }) {
          const target = requirePodScopedUrl({ podRoot: pod.root }, url);
          const bytes = await readResource(pod, target);
          if (bytes.contentType && RDF_MEDIA_TYPES.has(bytes.contentType)) {
            return toolText((await readRdf(pod, target)).turtle);
          }
          return toolText(
            bytes.text ??
              `[binary ${bytes.contentType ?? "application/octet-stream"}, base64]\n${bytes.base64 ?? ""}`,
          );
        },
      },
      readOnly,
    ),
    defineTool(
      {
        name: "solid_search",
        aliases: [],
        title: "Search the Solid pod",
        readOnly: true,
        description:
          "Search by URL, name and RDF literal using Type Index hints and a bounded container scan.",
        inputSchema: z.object({
          query: z.string().describe("Case-insensitive search term."),
          scope: z.string().optional().describe("Optional in-pod container scope."),
        }),
        async handler({ query, scope }) {
          return toolText(
            JSON.stringify(await search(pod, query, scope ? { scope } : {}), null, 2),
          );
        },
      },
      readOnly,
    ),
    defineTool(
      {
        name: "pod_write",
        aliases: ["solid_write"],
        title: "Write a Solid resource",
        readOnly: false,
        description: "PUT a resource strictly below the pod root. Disabled unless readOnly:false.",
        inputSchema: z.object({ url: z.string(), content: z.string(), contentType: z.string() }),
        async handler({ url, content, contentType }) {
          const result = await writeResource(pod, url, content, contentType);
          return toolText(`wrote ${result.url}${result.etag ? ` (etag ${result.etag})` : ""}`);
        },
      },
      readOnly,
    ),
  ];
}

/** Register canonical tools and one-release compatibility aliases on an MCP server. */
export function registerPodTools(server: McpServer, tools: readonly PodTool[]): void {
  for (const tool of tools) {
    for (const name of [tool.name, ...tool.aliases]) {
      server.registerTool(
        name,
        {
          title: tool.title,
          description:
            tool.description + (name === tool.name ? "" : ` Deprecated alias; use ${tool.name}.`),
          inputSchema: tool.inputSchema,
          annotations: {
            readOnlyHint: tool.readOnly,
            ...(!tool.readOnly ? { destructiveHint: true } : {}),
            openWorldHint: true,
          },
        },
        tool.handler,
      );
    }
  }
}
