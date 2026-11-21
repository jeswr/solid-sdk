// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requirePodScopedUrl } from "./auth.js";
import { fetchDocument } from "./fetch.js";
import { strongWriteEtag } from "./generic-mutation.js";
import { createMemoryTools, type MemoryClientInfo } from "./memory-tools.js";
import { createPersonalTools } from "./personal-tools.js";
import {
  listContainer,
  RDF_MEDIA_TYPES,
  readRdf,
  readResource,
  search,
  writeResource,
} from "./pod.js";
import type { PodPort } from "./pod-port.js";
import { defineTool, type PodTool, toolText } from "./tool.js";

export type { PodTool } from "./tool.js";

/** Build pod tools and ChatGPT search/fetch; legacy search retains its array response. */
export function createPodToolRegistry(
  pod: PodPort,
  readOnly = true,
  clientInfo?: MemoryClientInfo,
): readonly PodTool[] {
  return [
    defineTool(
      {
        name: "search",
        aliases: [],
        title: "Search the Solid pod",
        readOnly: true,
        description:
          "Search by resource name, URL, or RDF literals, including chat titles. Personal memory and audit storage is excluded. Returns {results:[{id,title,url}]} within bounded depth, resources, and time.",
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
          "Fetch a pod URL from search. Returns {id,title,text,url,metadata}: RDF as Turtle, text/* as text, binary metadata only; metadata.etag is the resource version for conditional pod_write and metadata.truncated flags the 1 MiB cap.",
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
        description:
          "Read an in-pod resource as Turtle, text, or base64 for binary data. A second text block supplies its ETag when available; pass that ETag as ifMatch to replace it with pod_write.",
        inputSchema: z.object({ url: z.string().describe("Resource URL within the pod.") }),
        async handler({ url }) {
          const target = requirePodScopedUrl({ podRoot: pod.root }, url);
          const bytes = await readResource(pod, target);
          let text: string;
          let etag = bytes.etag;
          if (bytes.contentType && RDF_MEDIA_TYPES.has(bytes.contentType)) {
            const rdf = await readRdf(pod, target);
            text = rdf.turtle;
            etag = rdf.etag;
          } else {
            text =
              bytes.text ??
              `[binary ${bytes.contentType ?? "application/octet-stream"}, base64]\n${bytes.base64 ?? ""}`;
          }
          const result = toolText(text);
          if (etag) result.content.push({ type: "text", text: `ETag: ${etag}` });
          return result;
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
        description:
          "Create a data resource strictly below the pod root with If-None-Match: *. To replace an existing resource, read it first and pass its strong ETag as ifMatch. Refuses access-control/description documents and fails closed if target or parent HEAD discovery is unavailable. Disabled unless readOnly:false.",
        inputSchema: z.object({
          url: z.string(),
          content: z.string(),
          contentType: z.string(),
          ifMatch: z
            .string()
            .refine(strongWriteEtag, "Read the resource first and pass its strong ETag as ifMatch")
            .optional()
            .describe("Exact strong ETag from pod_read or fetch, required for replacement."),
        }),
        async handler({ url, content, contentType, ifMatch }) {
          const result = await writeResource(pod, url, content, contentType, ifMatch);
          return toolText(`wrote ${result.url}${result.etag ? ` (etag ${result.etag})` : ""}`);
        },
      },
      readOnly,
    ),
    ...createMemoryTools(pod, readOnly, clientInfo),
    ...createPersonalTools(pod, readOnly, clientInfo),
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
