// AUTHORED-BY Claude Opus 5.5 — composed RFC 9728 discovery (MCP-01F)
// The resource server's 401 challenge must point at the URL the composed
// @jeswr/mcp-oauth authorization server actually serves, and an MCP SDK client
// must be able to discover protected-resource metadata through it.
import { createAuthorizationServer, type PodSessionProvider } from "@jeswr/mcp-oauth";
import {
  discoverOAuthProtectedResourceMetadata,
  extractWWWAuthenticateParams,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { createMcpHttpHandler } from "../src/http.js";

const ISSUER = "https://mcp.example/auth";

const podSessions: PodSessionProvider = {
  begin: async () => {
    throw new Error("not used");
  },
  complete: async () => {
    throw new Error("not used");
  },
  fetchFor: async () => {
    throw new Error("not used");
  },
  revoke: async () => {},
};

function compose(resource: string, explicit: boolean) {
  const oauth = createAuthorizationServer({
    issuer: ISSUER,
    resource,
    podSessions,
    consent: async () => false,
    scopes: ["mcp"],
  });
  const handler = createMcpHttpHandler({
    resourceUrl: resource,
    allowedOrigins: [],
    authenticate: () => null,
    server: () => new McpServer({ name: "discovery-test", version: "1.0.0" }),
    ...(explicit ? { resourceMetadataUrl: oauth.protectedResourceMetadataUrl() } : {}),
  });
  // Route every client request to the authorization server, as an app would mount it.
  const fetchFn = (input: string | URL, init?: RequestInit) =>
    oauth.handle(new Request(input, init));
  return { oauth, handler, fetchFn };
}

async function challenge(handler: ReturnType<typeof createMcpHttpHandler>, resource: string) {
  const response = await handler(
    new Request(resource, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
  );
  expect(response.status).toBe(401);
  return extractWWWAuthenticateParams(response).resourceMetadataUrl;
}

describe("composed RFC 9728 discovery with @jeswr/mcp-oauth", () => {
  it.each([
    ["https://mcp.example/mcp", false],
    ["https://mcp.example/mcp", true],
    ["https://mcp.example/mcp/", false],
    ["https://mcp.example/", false],
    ["https://mcp.example/tenant/a/mcp", false],
    ["https://mcp.example/tenant/a/mcp", true],
  ])("challenge for %s (explicit=%s) resolves to the served metadata", async (resource, explicit) => {
    const { oauth, handler, fetchFn } = compose(resource, explicit);
    const advertised = await challenge(handler, resource);
    expect(advertised?.href).toBe(oauth.protectedResourceMetadataUrl());

    const metadata = await discoverOAuthProtectedResourceMetadata(
      resource,
      { resourceMetadataUrl: advertised },
      fetchFn,
    );
    expect(metadata.resource).toBe(resource);
    expect(metadata.authorization_servers).toEqual([ISSUER]);
  });

  it("no longer advertises the path-appended URL the authorization server does not serve", async () => {
    const resource = "https://mcp.example/mcp";
    const { handler, fetchFn } = compose(resource, false);
    const advertised = await challenge(handler, resource);
    expect(advertised?.href).not.toBe(`${resource}/.well-known/oauth-protected-resource`);
    const legacy = await fetchFn(`${resource}/.well-known/oauth-protected-resource`);
    expect(legacy.status).toBe(404);
  });
});
