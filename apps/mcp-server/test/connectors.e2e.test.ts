// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:https";
import {
  createAuthorizationServer,
  createPodSessionProvider,
  createSessionVault,
  generateSigningKey,
  MemoryVaultStore,
} from "@jeswr/mcp-oauth";
import { createMcpHttpHandler } from "@jeswr/solid-mcp/http";
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/handler.js";
import { nodeHandler } from "../src/node-handler.js";
import { createVaultOAuthStores } from "../src/persistence.js";
import {
  CookieJar,
  CSS,
  completeMcpAuthorization,
  cssAccount,
  MCP,
  mcpForm,
  startCss,
} from "./css.js";
import { navigation } from "./navigation.js";

const RESOURCE = `${MCP}/mcp`;
const OTHER_RESOURCE = `${MCP}/other-mcp`;
const DOCUMENT_ORIGIN = "https://127.0.0.1:3392";
const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const CHATGPT_CALLBACK = "https://chatgpt.com/connector_platform_oauth_redirect";
const CLIENT_DOCUMENT = `${DOCUMENT_ORIGIN}/claude.json`;
const clientMetadata = (name: string, redirect: string) => ({
  client_name: name,
  redirect_uris: [redirect],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
});
const servers: Server[] = [];
const clients: Client[] = [];
let stopCss: (() => Promise<void>) | undefined;
let readOnly = false;
let documentReads = 0;
let upstreamRequests = 0;
let upstreamCredentials = 0;
const mcpTokens = new Set<string>();

beforeAll(async () => {
  const networkFetch = globalThis.fetch;
  const origins = new Set([new URL(CSS).origin, MCP, DOCUMENT_ORIGIN]);
  // This covers SDK discovery, browser navigation and all injected server transports.
  // CSS runs separately and dereferences only this harness's public Solid client ID.
  vi.stubGlobal("fetch", ((input, init) => {
    const request = new Request(input, init);
    if (!origins.has(new URL(request.url).origin))
      throw new Error("Connector harness refused a non-local network request");
    return networkFetch(request, {
      redirect: "manual",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
    });
  }) satisfies typeof fetch);
  const css = await startCss();
  stopCss = css.stop;
  const documentServer = createServer(css.tls, (request, response) => {
    if (request.method !== "GET" || request.url !== "/claude.json") {
      response.writeHead(404).end();
      return;
    }
    documentReads += 1;
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(
      JSON.stringify({
        client_id: CLIENT_DOCUMENT,
        ...clientMetadata("Claude", CLAUDE_CALLBACK),
      }),
    );
  });
  servers.push(documentServer);
  await listen(documentServer, 3392);
  const vault = createSessionVault({
    key: Buffer.alloc(32, 19).toString("base64"),
    store: new MemoryVaultStore(),
  });
  const signingKey = generateSigningKey();
  const upstreamFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin !== new URL(CSS).origin)
      throw new Error("Upstream transport escaped local CSS");
    upstreamRequests += 1;
    const authorization = request.headers.get("authorization");
    if (authorization) {
      // Never print credentials, including in assertion diagnostics.
      if (!authorization.startsWith("DPoP ") || mcpTokens.has(authorization.slice(5)))
        throw new Error("MCP credentials reached the pod transport");
      upstreamCredentials += 1;
    }
    return fetch(request);
  };
  const podSessions = createPodSessionProvider({
    clientId: `${MCP}/client-id.jsonld`,
    redirectUri: `${MCP}/auth/callback`,
    vault,
    fetch: upstreamFetch,
  });
  const options = {
    publicOrigin: MCP,
    vault,
    signingKey,
    podSessions,
    upstreamFetch,
    metadataFetch: ((input, init) => {
      if (String(input) !== CLIENT_DOCUMENT) throw new Error("Untrusted client document");
      return fetch(input, init);
    }) satisfies typeof fetch,
  };
  const writableApp = await createApp({ ...options, readOnly: false });
  const readOnlyApp = await createApp(options);
  // Same issuer, signing key, grant store and broker: rejection at the second resource
  // must come from its audience binding, rather than an unrelated signing key.
  const otherAs = createAuthorizationServer({
    issuer: `${MCP}/auth`,
    resource: OTHER_RESOURCE,
    signingKey,
    stores: createVaultOAuthStores(vault, `${MCP}/auth`),
    podSessions,
    consent: async () => false,
  });
  const otherResource = createMcpHttpHandler({
    resourceUrl: OTHER_RESOURCE,
    allowedOrigins: [],
    authenticate: (request) =>
      otherAs.verifyAccessToken(
        request.headers.get("authorization")?.slice(7) ?? "",
        OTHER_RESOURCE,
      ),
    server: () => {
      throw new Error("Wrong-audience bearer must not construct an MCP server");
    },
  });
  const server = createServer(css.tls, (request, response) => {
    void nodeHandler(request, response, (webRequest) =>
      new URL(webRequest.url).pathname === "/other-mcp"
        ? otherResource(webRequest)
        : (readOnly ? readOnlyApp : writableApp)(webRequest),
    );
  });
  servers.push(server);
  await listen(server, 3391);
});

afterAll(async () => {
  await Promise.allSettled(clients.map((client) => client.close()));
  for (const server of servers.reverse()) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await stopCss?.();
  vi.unstubAllGlobals();
});

async function listen(server: Server, port: number) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

function rpc(token?: string, url = RESOURCE, origin?: string) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "connector", version: "1" },
      },
    }),
  });
}

async function discovery() {
  const challenge = await rpc();
  expect(challenge.status).toBe(401);
  const header = challenge.headers.get("www-authenticate");
  expect(header).toMatch(/^Bearer resource_metadata="https:\/\/[^"]+"$/);
  const resourceMetadataUrl = header?.match(/resource_metadata="([^"]+)"/)?.[1];
  if (!resourceMetadataUrl) throw new Error("Missing RFC 9728 challenge");
  const resource = await discoverOAuthProtectedResourceMetadata(RESOURCE, { resourceMetadataUrl });
  expect(resource.resource).toBe(RESOURCE);
  expect(resource.bearer_methods_supported).toEqual(["header"]);
  expect(resource.authorization_servers).toHaveLength(1);
  const issuer = resource.authorization_servers?.[0];
  if (!issuer) throw new Error("Resource did not identify its AS");
  // The SDK applies RFC 8414's well-known insertion to the discovered issuer.
  const metadata = await discoverAuthorizationServerMetadata(issuer);
  if (!metadata) throw new Error("AS discovery failed");
  expect(metadata.issuer).toBe(issuer);
  expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
  expect(metadata.token_endpoint_auth_methods_supported).toEqual(["none"]);
  return metadata;
}
type Metadata = Awaited<ReturnType<typeof discovery>>;

async function register(metadata: Metadata, name: string, redirect: string) {
  // This AS advertises both modes. A missing advertisement is an acceptance failure,
  // rather than an implicit skip or an attempt at a guessed registration path.
  expect(metadata.registration_endpoint).toEqual(expect.any(String));
  const response = await fetch(metadata.registration_endpoint as string, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(clientMetadata(name, redirect)),
  });
  expect(response.status).toBe(201);
  const client = (await response.json()) as { client_id: string };
  expect(client).toMatchObject(clientMetadata(name, redirect));
  expect(client).not.toHaveProperty("client_secret");
  expect(client.client_id).toEqual(expect.any(String));
  return client.client_id as string;
}

function authorization(metadata: Metadata, clientId: string, redirect: string) {
  const verifier = randomBytes(32).toString("base64url");
  const url = new URL(metadata.authorization_endpoint);
  const state = randomUUID();
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    state,
    scope: "mcp",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource: RESOURCE,
  }).toString();
  return { url, verifier, state };
}

function tokenRequest(metadata: Metadata, fields: Record<string, string>) {
  return fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

async function login(
  metadata: Metadata,
  clientId: string,
  redirectUri: string,
  account: Awaited<ReturnType<typeof cssAccount>>,
) {
  const flow = authorization(metadata, clientId, redirectUri);
  const redirect = await completeMcpAuthorization(flow.url, account);
  expect(redirect.origin + redirect.pathname).toBe(redirectUri);
  expect(redirect.searchParams.get("state")).toBe(flow.state);
  expect(redirect.searchParams.get("iss")).toBe(metadata.issuer);
  expect(redirect.searchParams.has("error")).toBe(false);
  const code = redirect.searchParams.get("code");
  if (!code) throw new Error("Client callback contains no authorization code");
  const exchange = {
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: flow.verifier,
    resource: RESOURCE,
  };
  // Failed validation must not consume the code; the exact exchange still succeeds.
  await oauthError(
    await tokenRequest(metadata, { ...exchange, redirect_uri: `${redirectUri}/wrong` }),
    "invalid_grant",
  );
  await oauthError(
    await tokenRequest(metadata, { ...exchange, resource: OTHER_RESOURCE }),
    "invalid_target",
  );
  const response = await tokenRequest(metadata, exchange);
  expect(response.status).toBe(200);
  const tokens = (await response.json()) as OAuthTokens;
  expect(tokens.token_type).toBe("Bearer");
  expect(typeof tokens.refresh_token).toBe("string");
  mcpTokens.add(tokens.access_token);
  const client = new Client({ name: "connector-acceptance", version: "1" });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(RESOURCE), {
      requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } },
    }),
  );
  expect(client.getServerVersion()?.name).toBe("@jeswr/solid-mcp");
  expect((await client.listTools()).tools.length).toBeGreaterThan(0);
  return { client, tokens };
}

async function oauthError(response: Response, error: string, status = 400) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error });
}

async function text(client: Client, name: string, args: Record<string, unknown>, error = false) {
  const result = await client.callTool({ name, arguments: args });
  // ChatGPT requires precisely one text content item, even for search/fetch.
  expect(result.isError === true, `${name} error flag`).toBe(error);
  expect(result.content).toEqual([{ type: "text", text: expect.any(String) }]);
  return (result.content as { type: "text"; text: string }[])[0]?.text as string;
}
async function json(client: Client, name: string, args: Record<string, unknown>) {
  return JSON.parse(await text(client, name, args));
}
async function seed(
  account: Awaited<ReturnType<typeof cssAccount>>,
  path: string,
  body: string,
  contentType = "text/markdown",
) {
  const url = new URL(path, account.podRoot).href;
  const response = await account.fetcher(url, {
    method: "PUT",
    headers: { "content-type": contentType },
    body,
  });
  expect(response.ok).toBe(true);
  expect([401, 403]).toContain((await fetch(url)).status);
  return url;
}

const conversation = (provider: "claude" | "chatgpt") => ({
  provider,
  conversationId: "connector-session",
  title: "Orchard planning with my assistant",
  messages: [
    {
      id: "user-1",
      role: "user",
      text: "Please help plan my orchard.",
      createdAt: "2026-11-01T10:00:00.000Z",
    },
    {
      id: "assistant-1",
      role: "assistant",
      text: "We can start with apple trees.",
      createdAt: "2026-11-01T10:00:01.000Z",
    },
  ],
});

async function security(
  metadata: Metadata,
  clientId: string,
  redirect: string,
  account: Awaited<ReturnType<typeof cssAccount>>,
  tokens: OAuthTokens,
) {
  const before = upstreamRequests;
  expect((await rpc(tokens.access_token, OTHER_RESOURCE)).status).toBe(401);
  expect((await rpc(account.podToken)).status).toBe(401);
  expect((await rpc(tokens.access_token, RESOURCE, "https://foreign.example")).status).toBe(403);
  expect(upstreamRequests).toBe(before);
  expect((await rpc(tokens.access_token)).status).toBe(200);
  const plain = authorization(metadata, clientId, redirect);
  plain.url.searchParams.set("code_challenge_method", "plain");
  plain.url.searchParams.set("code_challenge", plain.verifier);
  const jar = new CookieJar();
  const post = await mcpForm(await fetch(plain.url), jar);
  const attempts = upstreamRequests;
  const refused = await post({ webid: account.webId });
  // Authorization errors use the registered callback, intercepted without fetching it.
  expect(refused.status).toBe(200);
  const destination = await navigation(refused);
  expect(destination.origin + destination.pathname).toBe(redirect);
  expect(destination.searchParams.get("error")).toBe("invalid_request");
  expect(destination.searchParams.get("state")).toBe(plain.state);
  expect(destination.searchParams.has("code")).toBe(false);
  expect(upstreamRequests).toBe(attempts);
}

async function rotate(metadata: Metadata, clientId: string, tokens: OAuthTokens) {
  const refresh = {
    grant_type: "refresh_token",
    client_id: clientId,
    resource: RESOURCE,
    refresh_token: tokens.refresh_token as string,
  };
  const response = await tokenRequest(metadata, refresh);
  expect(response.status).toBe(200);
  const rotated = (await response.json()) as OAuthTokens;
  expect(typeof rotated.refresh_token).toBe("string");
  // Boolean assertions keep rotating credentials out of failure diagnostics.
  expect(rotated.refresh_token !== tokens.refresh_token).toBe(true);
  mcpTokens.add(rotated.access_token);
  expect((await rpc(rotated.access_token)).status).toBe(200);
  await oauthError(await tokenRequest(metadata, refresh), "invalid_grant");
  expect((await rpc(tokens.access_token)).status).toBe(401);
  expect((await rpc(rotated.access_token)).status).toBe(401);
  await oauthError(
    await tokenRequest(metadata, { ...refresh, refresh_token: rotated.refresh_token as string }),
    "invalid_grant",
  );
}

async function claudeSession(client: Client, account: Awaited<ReturnType<typeof cssAccount>>) {
  expect(await json(client, "context_read", {})).toMatchObject({ status: "not_found" });
  const context = await seed(
    account,
    "agent/context/shared-context.md",
    "Prefer concise replies.\nCard: 4111 1111 1111 1111\n",
  );
  expect(await json(client, "context_read", {})).toMatchObject({
    status: "ok",
    url: context,
    redactedCardNumbers: 1,
    text: "Prefer concise replies.\nCard: [card number removed]\n",
  });
  const chat = conversation("claude");
  expect(await json(client, "chat_save", chat)).toMatchObject({ saved: 2, skipped: 0 });
  expect((await json(client, "chat_list", {})).conversations).toEqual([
    expect.objectContaining({
      title: chat.title,
      conversationId: chat.conversationId,
      provider: "claude",
    }),
  ]);
  expect(
    (
      await json(client, "chat_get", {
        provider: chat.provider,
        conversationId: chat.conversationId,
      })
    ).messages,
  ).toEqual(chat.messages);
  const exported = await json(client, "chat_export", {
    provider: chat.provider,
    conversationId: chat.conversationId,
  });
  for (const message of chat.messages) expect(exported.markdown).toContain(message.text);
  const preference = await json(client, "memory_remember", {
    text: "I prefer concise replies",
    quote: "I prefer concise replies",
    fact: { template: "preference", value: { propertyID: "reply-style", value: "concise" } },
  });
  expect(preference.epistemic).toBe("SelfReportedExplicit");
  expect((await json(client, "memory_recall", { purpose: "ServiceProvision" })).facts).toEqual([
    expect.objectContaining({
      id: preference.id,
      text: "I prefer concise replies",
      belief: "definitely",
    }),
  ]);
  expect(await json(client, "profile_get", { purpose: "ServiceProvision" })).toEqual({
    name: "MCP test owner",
    emails: [],
    phones: [],
  });
  await json(client, "memory_remember", {
    text: "My home address",
    quote: "I live in Oxford",
    fact: {
      template: "address",
      value: {
        id: "urn:connector:home",
        locality: "Oxford",
        country: "GB",
        street: "1 Orchard Lane",
        home: true,
      },
    },
  });
  expect((await json(client, "address_get", { purpose: "ServiceProvision" })).addresses).toEqual([
    expect.objectContaining({
      id: "urn:connector:home",
      locality: "Oxford",
      country: "GB",
      street: "1 Orchard Lane",
    }),
  ]);
  expect(
    await text(client, "health_query", { kind: "conditions", purpose: "ServiceProvision" }, true),
  ).toBe("purpose denied: MedicalHealth");
  const root = (await json(client, "pod_list", { container: account.podRoot })) as {
    url: string;
  }[];
  expect(root.some((entry) => entry.url === `${account.podRoot}agent/`)).toBe(true);
  // Current root lists the private/ ancestor, but never personal pkg resources.
  expect(root.some((entry) => entry.url === `${account.podRoot}private/`)).toBe(true);
  const privateChildren = (await json(client, "pod_list", {
    container: `${account.podRoot}private/`,
  })) as { url: string }[];
  expect(
    privateChildren.some((entry) => entry.url.startsWith(`${account.podRoot}private/pkg`)),
  ).toBe(false);
  expect(root.some((entry) => entry.url.startsWith(`${account.podRoot}private/pkg`))).toBe(false);
  // sst-5ax.38 will reserve agent/context too. Pin today's exposure explicitly.
  expect(
    (await json(client, "pod_list", { container: `${account.podRoot}agent/context/` })).some(
      (entry: { url: string }) => entry.url === context,
    ),
  ).toBe(true);
  expect(
    await text(client, "pod_read", { url: `${account.podRoot}private/pkg/mcp-policy.ttl` }, true),
  ).toBe("Personal data requires a purpose-limited tool");
  readOnly = true;
  try {
    const target = `${account.podRoot}private/must-not-exist.txt`;
    expect(
      await text(
        client,
        "pod_write",
        { url: target, content: "forbidden", contentType: "text/plain" },
        true,
      ),
    ).toContain("read-only");
    expect((await account.fetcher(target)).status).toBe(404);
  } finally {
    readOnly = false;
  }
}

for (const mode of ["Client ID Metadata Document", "RFC 7591 DCR"] as const) {
  describe(`Claude custom connector (${mode})`, () => {
    it("discovers from the 401, completes PKCE/Solid consent, runs a session and revokes refresh reuse", async () => {
      const metadata = await discovery();
      const before = documentReads;
      expect(metadata.client_id_metadata_document_supported).toBe(true);
      const clientId =
        mode === "Client ID Metadata Document"
          ? CLIENT_DOCUMENT
          : await register(metadata, "Claude", CLAUDE_CALLBACK);
      const account = await cssAccount();
      const { client, tokens } = await login(metadata, clientId, CLAUDE_CALLBACK, account);
      if (mode === "Client ID Metadata Document") expect(documentReads).toBeGreaterThan(before);
      else expect(documentReads).toBe(before);
      await claudeSession(client, account);
      await security(metadata, clientId, CLAUDE_CALLBACK, account, tokens);
      await rotate(metadata, clientId, tokens);
      expect(upstreamCredentials).toBeGreaterThan(0);
    });
  });
}

it.todo("sst-5ax.38: agent/context wall hides agent internals from generic pod tools and listings");

describe("ChatGPT developer-mode connector / app", () => {
  it("registers the exact callback, enforces public-client metadata and returns search/fetch shapes", async () => {
    const metadata = await discovery();
    const registration = metadata.registration_endpoint as string;
    for (const [data, error] of [
      [clientMetadata("ChatGPT", "http://foreign.example/callback"), "invalid_redirect_uri"],
      [
        {
          ...clientMetadata("ChatGPT", CHATGPT_CALLBACK),
          token_endpoint_auth_method: "client_secret_post",
        },
        "invalid_client_metadata",
      ],
    ] as const) {
      await oauthError(
        await fetch(registration, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data),
        }),
        error,
      );
    }
    const clientId = await register(metadata, "ChatGPT", CHATGPT_CALLBACK);
    const account = await cssAccount();
    const { client, tokens } = await login(metadata, clientId, CHATGPT_CALLBACK, account);
    const tools = (await client.listTools()).tools;
    for (const [name, argument] of [
      ["search", "query"],
      ["fetch", "id"],
    ] as const) {
      const tool = tools.find((item) => item.name === name);
      expect(tool?.inputSchema.type).toBe("object");
      expect(tool?.inputSchema.required).toEqual([argument]);
      expect(tool?.inputSchema.properties).toEqual({
        [argument]: expect.objectContaining({ type: "string" }),
      });
    }
    const writes = new Set([
      "pod_write",
      "solid_write",
      "memory_remember",
      "memory_forget",
      "chat_save",
    ]);
    for (const name of writes) expect(tools.some((tool) => tool.name === name)).toBe(true);
    for (const tool of tools)
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(!writes.has(tool.name));
    const chat = conversation("chatgpt");
    const saved = await json(client, "chat_save", chat);
    // Generic notes are deliberately outside protected PKG memory. A filename match
    // on Markdown exercises portable note discovery without weakening purpose checks.
    const note = await seed(
      account,
      "private/memory/orchard-memory-note.md",
      "Orchard memory note: I like apple trees.",
    );
    await json(client, "memory_remember", {
      text: "Protected canary never enters generic search",
      quote: "I prefer canaries",
      fact: { template: "preference", value: { propertyID: "bird", value: "canary" } },
    });
    const search = await json(client, "search", { query: "orchard" });
    expect(Object.keys(search)).toEqual(["results"]);
    expect(Array.isArray(search.results)).toBe(true);
    expect(search.results.length).toBeGreaterThanOrEqual(2);
    expect(search.results.some((result: { url: string }) => result.url === note)).toBe(true);
    expect(search.results.some((result: { url: string }) => result.url.startsWith(saved.url))).toBe(
      true,
    );
    let foundTitle = false;
    for (const result of search.results) {
      expect(Object.keys(result).sort()).toEqual(["id", "title", "url"]);
      expect(result).toEqual({
        id: expect.any(String),
        title: expect.any(String),
        url: expect.any(String),
      });
      expect(result.id).toBe(result.url);
      const fetched = await json(client, "fetch", { id: result.id });
      expect(Object.keys(fetched).sort()).toEqual(["id", "metadata", "text", "title", "url"]);
      expect(fetched).toEqual({
        id: result.id,
        title: expect.any(String),
        text: expect.any(String),
        url: result.url,
        metadata: expect.objectContaining({ contentType: expect.any(String), truncated: false }),
      });
      expect(
        Object.keys(fetched.metadata).every((key) =>
          ["contentType", "truncated", "etag"].includes(key),
        ),
      ).toBe(true);
      if (fetched.metadata.etag !== undefined) expect(typeof fetched.metadata.etag).toBe("string");
      if (result.url === note)
        expect(fetched.text).toBe("Orchard memory note: I like apple trees.");
      foundTitle ||= fetched.text.includes(chat.title);
    }
    expect(foundTitle).toBe(true);
    expect(await json(client, "search", { query: "canary" })).toEqual({ results: [] });
    await security(metadata, clientId, CHATGPT_CALLBACK, account, tokens);
    await rotate(metadata, clientId, tokens);
  });
});
