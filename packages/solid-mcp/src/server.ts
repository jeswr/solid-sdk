// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * createSolidMcpServer — build an MCP server that exposes a Solid pod.
 *
 * The pod is surfaced two ways:
 *  - **Resources**: pod URLs map 1:1 to MCP resource URIs (the resource uri IS the
 *    pod url). A `list` callback browses the pod root's children. The read callback
 *    returns a container listing as JSON, an RDF resource as Turtle, or any other
 *    resource as text / base64 bytes. Every read is pod-scope-guarded.
 *  - **Tools**: `pod_list`, `pod_read`, `search`, `pod_write` (with `solid_*` aliases). All are
 *    pod-scope-guarded and use the injected PodPort. `solid_write`
 *    reflects the read-only default (returns `isError` when disabled, never throws
 *    out of the handler). Tool handlers catch errors → `{ isError: true, ... }`.
 */

import { isContainerUrl } from "@jeswr/guarded-fetch";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { normalizePodRoot, requirePodScopedUrl, type SolidMcpConfig } from "./auth.js";
import { registerChatTools } from "./chat-tools.js";
import { listContainer, RDF_MEDIA_TYPES, readRdf, readResource } from "./pod.js";
import { createFetchPodPort, type PodPort } from "./pod-port.js";
import { createPodToolRegistry, registerPodTools } from "./tools.js";

/** Server construction over a portable pod, or the existing fetch configuration. */
export type SolidMcpServerConfig =
  | SolidMcpConfig
  | {
      /** All pod data access goes through this injected capability. */
      pod: PodPort;
      /** Defaults to true; explicitly set false to permit write tools. */
      readOnly?: boolean;
    };

/**
 * Build an {@link McpServer} for the pod described by `config`. The config is
 * validated eagerly (podRoot must be an absolute http(s) container URL) so a
 * misconfiguration fails fast rather than at first request.
 */
export function createSolidMcpServer(config: SolidMcpServerConfig): McpServer {
  const pod = "pod" in config ? config.pod : createFetchPodPort(config);
  const podRoot = normalizePodRoot(pod.root);
  const cfg = { podRoot };

  const server = new McpServer(
    { name: "@jeswr/solid-mcp", version: "0.2.0" },
    { capabilities: { resources: {}, tools: {} } },
  );

  // ---- Resources: a template mapping every pod URL to an MCP resource ----
  // The resource URI scheme mirrors the pod's http(s) URLs 1:1. We register a
  // wildcard template over the pod's scheme+host so any in-pod URL is addressable;
  // the `list` callback enumerates the pod root's immediate children so a client
  // can discover what's there.
  const rootUrl = new URL(podRoot);
  const template = new ResourceTemplate(`${rootUrl.protocol}//${rootUrl.host}/{+path}`, {
    list: async () => {
      const children = await listContainer(pod, podRoot);
      return {
        resources: children.map((c) => ({
          uri: c.url,
          name: c.name,
          ...(c.mimeType ? { mimeType: c.mimeType } : {}),
        })),
      };
    },
  });

  server.registerResource(
    "solid-pod",
    template,
    {
      title: "Solid pod resource",
      description:
        "A resource in the Solid pod. Containers are returned as a JSON listing; RDF resources as Turtle; other resources as text or base64 bytes.",
    },
    async (uri: URL) => {
      const target = requirePodScopedUrl(cfg, uri.toString());
      if (isContainerUrl(target)) {
        const children = await listContainer(pod, target);
        return {
          contents: [
            { uri: target, mimeType: "application/json", text: JSON.stringify(children, null, 2) },
          ],
        };
      }
      // Peek at the content-type via the bytes path; render RDF as Turtle.
      const bytes = await readResource(pod, target);
      if (bytes.contentType && RDF_MEDIA_TYPES.has(bytes.contentType)) {
        const { turtle } = await readRdf(pod, target);
        return { contents: [{ uri: target, mimeType: "text/turtle", text: turtle }] };
      }
      if (bytes.text !== undefined) {
        return {
          contents: [
            {
              uri: target,
              ...(bytes.contentType ? { mimeType: bytes.contentType } : {}),
              text: bytes.text,
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: target,
            mimeType: bytes.contentType ?? "application/octet-stream",
            blob: bytes.base64 ?? "",
          },
        ],
      };
    },
  );

  registerPodTools(server, createPodToolRegistry(pod, config.readOnly !== false));
  // Chat ACL discovery requires the original authenticated fetch capability.
  if (!("pod" in config)) registerChatTools(server, { ...config, podRoot });
  return server;
}
