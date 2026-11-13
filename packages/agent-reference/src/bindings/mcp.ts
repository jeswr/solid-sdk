// AUTHORED-BY Codex GPT-6
/** biome-ignore-all lint/style/useNamingConvention: MCP requires the _meta member. */
/** MCP revision 2026-07-28 subset. No initialize exchange and no session identifier. */
import { z } from "zod";
import { canonicalJson } from "../core/canonical.js";
import { type SigningKey, signCompact } from "../mechanisms/jws.js";
import {
  type ByteMessage,
  byteCopySchema,
  bytesOf,
  CarriageError,
  copyOf,
  envelopeBytes,
  envelopeJson,
  type HttpExchange,
  oneCopy,
} from "./bytes.js";
export const MCP_REVISION = "2026-07-28";
export const MCP_BINDING = `mcp-tool/${MCP_REVISION}`;
export const MCP_TOOL = "answerable_exchange";
const meta = {
  "io.modelcontextprotocol/protocolVersion": MCP_REVISION,
  "io.modelcontextprotocol/clientCapabilities": {},
};
const messageSchema = {
  type: "object",
  properties: {
    bytes: { type: "string", contentEncoding: "base64" },
    mediaType: { type: "string" },
  },
  required: ["bytes", "mediaType"],
  additionalProperties: false,
};
export function exchangeTool(
  description = "Exchange one signed Answerable message. Tool metadata grants no authority.",
) {
  return {
    name: MCP_TOOL,
    title: "Exchange a signed message",
    description,
    inputSchema: messageSchema,
    outputSchema: messageSchema,
  };
}
export interface ChannelToken {
  readonly value: string;
  readonly issuer: string;
  readonly resource: string;
}
/** Fictional authorization server; grant and token requests both bind RFC 8707 resource. */
export class FictionalAuthorizationServer {
  private next = 0;
  private readonly tokens = new Map<string, ChannelToken>();
  constructor(
    readonly issuer: string,
    readonly resource: string,
    private readonly key: SigningKey,
  ) {}
  authorize(request: { resource: string }): { iss: string; resource: string; code: string } {
    if (request.resource !== this.resource)
      throw new CarriageError(
        "not-authorised",
        "The channel authorization names another resource.",
      );
    const code = `fictional-code-${++this.next}`;
    this.codes.add(code);
    return { iss: this.issuer, resource: this.resource, code };
  }
  private readonly codes = new Set<string>();
  async token(request: { resource: string; code: string; iss: string }): Promise<ChannelToken> {
    if (
      request.resource !== this.resource ||
      request.iss !== this.issuer ||
      !this.codes.delete(request.code)
    )
      throw new CarriageError(
        "not-authorised",
        "The resource or authorization issuer does not match.",
      );
    const token = {
      value: await signCompact(this.key, "answerable-channel-token+jws", {
        iss: this.issuer,
        aud: this.resource,
        jti: `channel-${++this.next}`,
      }),
      resource: this.resource,
      issuer: this.issuer,
    };
    this.tokens.set(token.value, token);
    return token;
  }
  accepts(value: string, resource: string): boolean {
    return resource === this.resource && this.tokens.get(value)?.resource === resource;
  }
  metadata() {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/authorize`,
      token_endpoint: `${this.issuer}/token`,
    };
  }
  get resourceMetadataUrl(): string {
    return `${this.resource}/metadata`;
  }
  protectedMetadataResponse(): HttpExchange {
    return {
      method: "GET",
      path: new URL(this.resourceMetadataUrl).pathname,
      headers: { "Content-Type": "application/json" },
      body: envelopeBytes(this.protectedResourceMetadata()),
    };
  }
  protectedResourceMetadata() {
    return { resource: this.resource, authorization_servers: [this.issuer] };
  }
}
export class McpAuthorizationError extends CarriageError {
  readonly status = 401;
  readonly headers: Readonly<Record<string, string>>;
  constructor(server: FictionalAuthorizationServer) {
    super("not-authorised", "The tool server refused the channel credential.");
    this.headers = {
      "WWW-Authenticate": `Bearer resource_metadata="${server.resourceMetadataUrl}"`,
    };
  }
}
export function channelCredential(token: ChannelToken, destination: string): string {
  if (token.resource !== destination)
    throw new CarriageError(
      "not-authorised",
      "A channel token cannot be passed to another server.",
    );
  return `Bearer ${token.value}`;
}
export function mcpRequest(
  method: "server/discover" | "tools/list" | "tools/call",
  id: string,
  path: string,
  token: ChannelToken,
  destination: string,
  message?: ByteMessage,
): HttpExchange {
  return {
    method: "POST",
    path,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": MCP_REVISION,
      "Mcp-Method": method,
      ...(method === "tools/call" ? { "Mcp-Name": MCP_TOOL } : {}),
      Authorization: channelCredential(token, destination),
    },
    body: envelopeBytes({
      jsonrpc: "2.0",
      id,
      method,
      params: {
        _meta: meta,
        ...(method === "tools/call"
          ? { name: MCP_TOOL, arguments: message ? copyOf(message) : undefined }
          : {}),
      },
    }),
  };
}
export class McpProtocolError extends Error {
  constructor(
    readonly status: number,
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}
const requestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.object({
    _meta: z.object({
      "io.modelcontextprotocol/protocolVersion": z.string(),
      "io.modelcontextprotocol/clientCapabilities": z.object({}),
    }),
    name: z.string().optional(),
    arguments: z.unknown().optional(),
  }),
});
export function readMcpRequest(
  http: HttpExchange,
  server: FictionalAuthorizationServer,
): { id: string | number; method: string; message?: ByteMessage } {
  const request = requestSchema.parse(envelopeJson(http.body));
  if (
    http.method !== "POST" ||
    http.headers["Content-Type"] !== "application/json" ||
    request.method !== http.headers["Mcp-Method"] ||
    request.params._meta["io.modelcontextprotocol/protocolVersion"] !==
      http.headers["MCP-Protocol-Version"] ||
    (request.method === "tools/call" && request.params.name !== http.headers["Mcp-Name"])
  )
    throw new McpProtocolError(400, -32020, "MCP HTTP headers and request metadata differ.");
  if (http.headers["MCP-Protocol-Version"] !== MCP_REVISION)
    throw new McpProtocolError(400, -32022, "Unsupported MCP protocol version.");
  if (
    !http.headers.Accept?.includes("application/json") ||
    !http.headers.Accept.includes("text/event-stream") ||
    http.headers["Mcp-Session-Id"]
  )
    throw new McpProtocolError(400, -32020, "MCP transport headers are invalid.");
  const token = http.headers.Authorization?.replace(/^Bearer /, "") ?? "";
  if (!server.accepts(token, server.resource)) throw new McpAuthorizationError(server);
  if (!["server/discover", "tools/list", "tools/call"].includes(request.method))
    throw new McpProtocolError(404, -32601, "Unknown MCP method.");
  if (request.method === "tools/call" && request.params.name !== MCP_TOOL)
    throw new McpProtocolError(404, -32601, "Unknown MCP tool.");
  return {
    id: request.id,
    method: request.method,
    ...(request.method === "tools/call" ? { message: bytesOf(request.params.arguments) } : {}),
  };
}
/** Minimal discover shape is a local choice: the research did not confirm its schema. */
export function mcpDiscovery(id: string | number) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: MCP_REVISION,
      capabilities: { tools: {} },
      serverInfo: { name: "Fictional signed-message carrier", version: "1.0" },
    },
  };
}
export function mcpToolList(id: string | number, description?: string) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      resultType: "complete",
      tools: [exchangeTool(description)],
      ttlMs: 0,
      cacheScope: "private",
    },
  };
}
export function mcpResponse(
  message: ByteMessage,
  id: string,
  requestedResource?: string,
): HttpExchange {
  const structuredContent = copyOf(message);
  return {
    method: "POST",
    path: "/mcp",
    headers: { "Content-Type": "application/json" },
    body: envelopeBytes({
      jsonrpc: "2.0",
      id,
      result: {
        resultType: "complete",
        structuredContent,
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        isError: false,
        ...(requestedResource ? { _meta: { requestedTokenResource: requestedResource } } : {}),
      },
    }),
  };
}
const resultSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  result: z.object({
    resultType: z.literal("complete"),
    structuredContent: byteCopySchema,
    content: z.array(z.object({ type: z.literal("text"), text: z.string().max(1_000_000) })),
    isError: z.boolean(),
    _meta: z.object({ requestedTokenResource: z.string() }).optional(),
  }),
});
export function readMcpResult(http: HttpExchange, token?: ChannelToken): { message: ByteMessage } {
  const { result } = resultSchema.parse(envelopeJson(http.body));
  // The output schema defines the text as a serialized second copy, never as instructions.
  const copies = [
    bytesOf(result.structuredContent),
    ...result.content.map((part) => bytesOf(envelopeJson(new TextEncoder().encode(part.text)))),
  ];
  const message = oneCopy(copies);
  if (result._meta) {
    if (!token) throw new CarriageError("not-authorised", "The channel credential is unavailable.");
    channelCredential(token, result._meta.requestedTokenResource);
  }
  return { message };
}

/** Discovery is untrusted. Keep only the schema-bound tool; discard descriptions and annotations. */
export function readMcpToolList(input: unknown): { name: string; droppedDescriptions: string[] } {
  const value = z
    .object({
      result: z.object({
        resultType: z.literal("complete"),
        tools: z
          .array(
            z.object({
              name: z.string(),
              inputSchema: z.unknown(),
              outputSchema: z.unknown(),
              description: z.string().optional(),
            }),
          )
          .length(1),
      }),
    })
    .parse(input);
  const tool = value.result.tools[0];
  if (
    !tool ||
    tool.name !== MCP_TOOL ||
    canonicalJson(tool.inputSchema) !== canonicalJson(messageSchema) ||
    canonicalJson(tool.outputSchema) !== canonicalJson(messageSchema)
  )
    throw new CarriageError("malformed", "The MCP exchange tool has an incompatible schema.");
  return { name: tool.name, droppedDescriptions: tool.description ? [tool.description] : [] };
}
export function readMcpDiscovery(input: unknown): void {
  z.object({
    result: z.object({
      protocolVersion: z.literal(MCP_REVISION),
      capabilities: z.object({ tools: z.object({}) }),
      serverInfo: z.object({ name: z.string(), version: z.string() }),
    }),
  }).parse(input);
}
