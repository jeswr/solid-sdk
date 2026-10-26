// AUTHORED-BY Codex GPT-6.1-Sol
import { vi } from "vitest";
import {
  type AuthorizationServerOptions,
  createAuthorizationServer,
  generateSigningKey,
  type PodSessionProvider,
} from "../src/index.js";
import { digest } from "../src/protocol.js";
import { createMemoryStores } from "../src/testing.js";

export const ISSUER = "https://mcp.example/auth";
export const RESOURCE = "https://mcp.example/mcp";
export const REDIRECT = "https://client.example/callback?existing=1";
export const SESSION = { id: "pod-session", webId: "https://alice.example/profile#me" };
export const VERIFIER = "a".repeat(43);

export function fixture(overrides: Partial<AuthorizationServerOptions> = {}) {
  let clock = 1_800_000_000;
  const stores = createMemoryStores();
  const key = generateSigningKey();
  const consent = vi.fn(async () => true);
  const metadataFetch = vi.fn<typeof fetch>(async () => {
    throw new Error("Unexpected network request");
  });
  const provider: PodSessionProvider = {
    begin: vi.fn(async () => ({
      authorizeUrl: "https://pod.example/authorize",
      state: "upstream-state",
    })),
    complete: vi.fn(async () => ({
      ...SESSION,
      access_token: "fixture-pod-token-never-passthrough",
    })),
    fetchFor: vi.fn(async () => metadataFetch),
    revoke: vi.fn(async () => {}),
  };
  const server = createAuthorizationServer({
    issuer: ISSUER,
    resource: RESOURCE,
    podSessions: provider,
    consent,
    metadataFetch,
    stores,
    signingKey: key,
    scopes: ["mcp", "read"],
    now: () => clock,
    ...overrides,
  });
  const form = (path: string, params: Record<string, string>) =>
    server.handle(
      new Request(`${ISSUER}/${path}`, {
        method: "POST",
        body: new URLSearchParams(params),
      }),
    );
  const authRequest = (clientId: string, changes: Record<string, string | undefined> = {}) => {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT,
      resource: RESOURCE,
      response_type: "code",
      state: "client-state",
      code_challenge: digest(VERIFIER),
      code_challenge_method: "S256",
      webid: SESSION.webId,
      scope: "mcp",
    });
    for (const [name, value] of Object.entries(changes)) {
      if (value === undefined) params.delete(name);
      else params.set(name, value);
    }
    return new Request(`${ISSUER}/authorize?${params}`);
  };
  const register = async (metadata = {}) => {
    const response = await server.handle(
      new Request(`${ISSUER}/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: [REDIRECT], ...metadata }),
      }),
    );
    if (response.status !== 201) throw new Error(`Fixture registration failed: ${response.status}`);
    return (await response.json()).client_id as string;
  };
  const code = async (clientId: string, changes = {}) => {
    const response = await server.authorize(authRequest(clientId, changes), SESSION);
    return new URL(response.headers.get("location") as string).searchParams.get("code") as string;
  };
  const exchange = (clientId: string, codeValue: string, changes = {}) =>
    form("token", {
      client_id: clientId,
      grant_type: "authorization_code",
      code: codeValue,
      redirect_uri: REDIRECT,
      resource: RESOURCE,
      code_verifier: VERIFIER,
      ...changes,
    });
  const refresh = (clientId: string, token: string, changes = {}) =>
    form("token", {
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: token,
      resource: RESOURCE,
      ...changes,
    });
  return {
    server,
    stores,
    key,
    consent,
    provider,
    metadataFetch,
    form,
    authRequest,
    register,
    code,
    exchange,
    refresh,
    now: () => clock,
    advance: (seconds: number) => {
      clock += seconds;
    },
  };
}
