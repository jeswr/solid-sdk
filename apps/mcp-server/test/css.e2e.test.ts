// AUTHORED-BY Codex GPT-6.1-Sol

import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:https";
import { createSessionVault, MemoryVaultStore } from "@jeswr/mcp-oauth";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appFromEnvironment } from "../src/config.js";
import { createApp } from "../src/handler.js";
import { nodeHandler } from "../src/node-handler.js";
import { CSS, completeMcpAuthorization, cssAccount, MCP, startCss } from "./css.js";

let stopCss: (() => Promise<void>) | undefined;
let server: Server | undefined;
const clients: Client[] = [];
const upstreamHeaders: string[] = [];
const operations: string[] = [];
beforeAll(async () => {
  const css = await startCss();
  stopCss = css.stop;
  const vault = createSessionVault({
    key: Buffer.alloc(32, 9).toString("base64"),
    store: new MemoryVaultStore(),
  });
  const upstreamFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin !== new URL(CSS).origin)
      throw new Error("E2E transport only permits its local CSS");
    const header = request.headers.get("authorization");
    if (header) upstreamHeaders.push(header);
    const response = await fetch(request, { redirect: "manual" });
    // Only method, resource path and status: never credentials, query or response body.
    operations.push(
      `${request.method} ${new URL(request.url).pathname.split("/").slice(2).join("/")} ${response.status} etag=${response.headers.has("etag")}`,
    );
    return response;
  };
  const app = await createApp({ publicOrigin: MCP, vault, readOnly: false, upstreamFetch });
  server = createServer(css.tls, (request, response) => void nodeHandler(request, response, app));
  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject);
    server?.listen(3391, "127.0.0.1", resolve);
  });
});
afterAll(async () => {
  await Promise.allSettled(clients.map((client) => client.close()));
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
  await stopCss?.();
});

async function login(account: Awaited<ReturnType<typeof cssAccount>>) {
  let information: OAuthClientInformationMixed | undefined;
  let tokens: OAuthTokens | undefined;
  let verifier = "";
  let authorization: URL | undefined;
  const state = randomUUID();
  const provider: OAuthClientProvider = {
    redirectUrl: "http://127.0.0.1:3392/callback",
    clientMetadata: {
      client_name: "Local MCP SDK test",
      redirect_uris: ["http://127.0.0.1:3392/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    state: () => state,
    clientInformation: () => information,
    saveClientInformation: (value) => {
      information = value;
    },
    tokens: () => tokens,
    saveTokens: (value) => {
      tokens = value;
    },
    saveCodeVerifier: (value) => {
      verifier = value;
    },
    codeVerifier: () => verifier,
    redirectToAuthorization: (url) => {
      authorization = url;
    },
  };
  expect(await auth(provider, { serverUrl: `${MCP}/mcp`, scope: "mcp" })).toBe("REDIRECT");
  if (!authorization) throw new Error("SDK did not request authorization");
  const authUrl = authorization as URL;
  expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authUrl.searchParams.get("resource")).toBe(`${MCP}/mcp`);
  const redirect = await completeMcpAuthorization(authUrl, account);
  expect(redirect.origin + redirect.pathname).toBe(String(provider.redirectUrl));
  expect(redirect.searchParams.get("state")).toBe(state);
  expect(
    await auth(provider, {
      serverUrl: `${MCP}/mcp`,
      authorizationCode: redirect.searchParams.get("code") as string,
    }),
  ).toBe("AUTHORIZED");
  const currentTokens = await provider.tokens();
  if (!currentTokens || !information) throw new Error("Missing SDK OAuth credentials");
  const client = new Client({ name: "mcp-css-e2e", version: "1" });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${MCP}/mcp`), { authProvider: provider }),
  );
  return { client, tokens: currentTokens, information };
}

it("performs SDK DCR + PKCE + Solid login + consent and calls every tool on private local CSS", async () => {
  const account = await cssAccount();
  expect([401, 403]).toContain((await fetch(account.privateUrl)).status);
  const { client, tokens } = await login(account);
  expect(
    (await fetch(`${MCP}/mcp`, { headers: { authorization: `Bearer ${account.podToken}` } }))
      .status,
  ).toBe(401);
  const called = new Set<string>();
  const call = async (name: string, args: Record<string, unknown>, error = false) => {
    called.add(name);
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { text: string }[]).map((part) => part.text).join("\n");
    expect(
      result.isError === true,
      `${name}: ${text}; operations: ${operations.slice(-25).join(", ")}`,
    ).toBe(error);
    return text;
  };
  const json = async (name: string, args: Record<string, unknown>) =>
    JSON.parse(await call(name, args));
  const url = `${account.podRoot}private/mcp-note.txt`;
  for (const name of ["pod_write", "solid_write"])
    await call(name, { url, content: "roundtrip through MCP", contentType: "text/plain" });
  expect([401, 403]).toContain((await fetch(url)).status);
  for (const name of ["pod_read", "solid_read"])
    expect(await call(name, { url })).toBe("roundtrip through MCP");
  for (const name of ["pod_list", "solid_list"])
    expect(await call(name, { container: `${account.podRoot}private/` })).toContain("mcp-note.txt");
  expect((await json("fetch", { id: url })).text).toBe("roundtrip through MCP");
  expect(
    (await json("search", { query: "mcp-note" })).results.some(
      (item: { url: string }) => item.url === url,
    ),
  ).toBe(true);
  expect(
    await call("solid_search", { query: "mcp-note", scope: `${account.podRoot}private/` }),
  ).toContain("mcp-note.txt");
  const memory = await json("memory_remember", {
    text: "My email address",
    fact: { template: "email", value: "owner@example.org" },
    quote: "Use owner@example.org",
  });
  expect(memory.epistemic).toBe("SelfReportedExplicit");
  expect(await call("memory_recall", { purpose: "ServiceProvision" })).toContain(
    "owner@example.org",
  );
  expect(await json("profile_get", { purpose: "ServiceProvision" })).toEqual({
    name: "MCP test owner",
    emails: [],
    phones: [],
  });
  await call("address_get", { purpose: "ServiceProvision" });
  await call("health_query", { kind: "conditions", purpose: "ServiceProvision" }, true);
  await call("memory_forget", { id: memory.id, mode: "retract" });
  const deletable = await json("memory_remember", {
    text: "Temporary email",
    fact: { template: "email", value: "delete@example.org" },
    quote: "delete@example.org",
  });
  await call("memory_forget", { id: deletable.id, mode: "delete" });
  const conversation = {
    provider: "claude",
    conversationId: "mcp-e2e",
    title: "Local CSS chat",
    messages: [
      {
        id: "m1",
        role: "user",
        text: "Please remember my preferences",
        createdAt: "2026-10-30T12:00:00Z",
      },
    ],
  };
  await call("chat_save", conversation);
  expect(await call("chat_list", {})).toContain("Local CSS chat");
  expect(await call("chat_get", { provider: "claude", conversationId: "mcp-e2e" })).toContain(
    "Please remember my preferences",
  );
  expect(await call("chat_export", { provider: "claude", conversationId: "mcp-e2e" })).toContain(
    "Please remember my preferences",
  );
  // No shared-context document exists on the fresh pod, so context_read reports setup guidance.
  expect(await call("context_read", {})).toContain('"status":"not_found"');
  expect(called).toEqual(new Set((await client.listTools()).tools.map((tool) => tool.name)));
  // The composition preserves the tool package's scope and purpose boundaries.
  await call("fetch", { id: "http://169.254.169.254/latest/meta-data/" }, true);
  await call("memory_recall", { purpose: "Advertising" }, true);
  await call(
    "memory_remember",
    {
      text: "Injection",
      fact: {
        template: "condition",
        value: { id: 'https://example.org/> <https://evil.example/p> "injected"', name: "bad" },
      },
    },
    true,
  );
  expect(upstreamHeaders.length).toBeGreaterThan(0);
  expect(upstreamHeaders.every((header) => header.startsWith("DPoP "))).toBe(true);
  expect(upstreamHeaders.some((header) => header.includes(tokens.access_token))).toBe(false);
});

it("isolates two owners and revokes the bound upstream session on refresh reuse", async () => {
  const alice = await cssAccount();
  const bob = await cssAccount();
  const a = await login(alice);
  const b = await login(bob);
  const result = await b.client.callTool({
    name: "pod_read",
    arguments: { url: alice.privateUrl },
  });
  expect(result.isError).toBe(true);
  const post = (body: Record<string, string>) =>
    fetch(`${MCP}/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
  const refresh = {
    grant_type: "refresh_token",
    client_id: a.information.client_id,
    resource: `${MCP}/mcp`,
    refresh_token: a.tokens.refresh_token as string,
  };
  expect((await post({ ...refresh, resource: "https://other.example/mcp" })).status).toBe(400);
  expect((await post(refresh)).status).toBe(200);
  expect((await post(refresh)).status).toBe(400);
  const response = await fetch(`${MCP}/mcp`, {
    headers: { authorization: `Bearer ${a.tokens.access_token}` },
  });
  expect(response.status).toBe(401);
  expect(
    (await b.client.callTool({ name: "pod_read", arguments: { url: bob.privateUrl } })).isError,
  ).not.toBe(true);
});

it("reads private local CSS through single-user client credentials and a separate MCP bearer", async () => {
  const account = await cssAccount();
  expect([401, 403]).toContain((await fetch(account.privateUrl)).status);
  const bearer = randomBytes(32).toString("base64url");
  const env = {
    MCP_MODE: "single-user",
    MCP_PUBLIC_ORIGIN: MCP,
    MCP_ACCESS_TOKEN: bearer,
    SOLID_MCP_ISSUER: account.credentials.issuer,
    SOLID_MCP_CLIENT_ID: account.credentials.id,
    SOLID_MCP_CLIENT_SECRET: account.credentials.secret,
    SOLID_MCP_POD_ROOT: account.podRoot,
    SOLID_MCP_WEBID: account.webId,
  };
  await expect(appFromEnvironment(env)).rejects.toThrow();
  const app = await appFromEnvironment({ ...env, MCP_ALLOW_LOOPBACK: "true" });
  const client = new Client({ name: "single-user-css-e2e", version: "1" });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${MCP}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${bearer}` } },
      fetch: async (input, init) => app(new Request(input, init)),
    }),
  );
  const result = await client.callTool({
    name: "pod_read",
    arguments: { url: account.privateUrl },
  });
  expect(result.isError).not.toBe(true);
  expect((result.content as { text: string }[])[0]?.text).toBe("local CSS private fixture");
});
