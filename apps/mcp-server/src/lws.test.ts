// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash } from "node:crypto";
import { createSessionVault, MemoryVaultStore } from "@jeswr/mcp-oauth";
import { expect, it } from "vitest";
import {
  LWS_AUTHORIZATION_SERVER,
  lwsStorage,
} from "../../../packages/mcp-oauth/test/lws-storage.js";
import { POD_ISSUER, POD_ROOT } from "../../../packages/mcp-oauth/test/pod-issuer.js";
import { navigation } from "../test/navigation.js";
import { createApp } from "./handler.js";

it("reads and lists private LWS storage through the default OAuth composition", async () => {
  const lws = lwsStorage();
  expect((await lws.fetch(`${POD_ROOT}note.txt`)).status).toBe(401);
  const origin = "https://mcp.example";
  const resource = `${origin}/mcp`;
  const redirect = "http://127.0.0.1:4321/callback";
  const verifier = "v".repeat(43);
  const app = await createApp({
    publicOrigin: origin,
    vault: createSessionVault({
      key: Buffer.alloc(32, 8).toString("base64"),
      store: new MemoryVaultStore(),
    }),
    upstreamFetch: lws.fetch,
    lwsAuthorizationServers: [LWS_AUTHORIZATION_SERVER],
  });
  const request = (path: string, init?: RequestInit) => new Request(`${origin}${path}`, init);
  const post = (path: string, fields: Record<string, string>, cookie = "") =>
    app(
      request(path, {
        method: "POST",
        headers: { origin, cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields),
      }),
    );
  const csrf = async (response: Response) => {
    expect(response.status).toBe(200);
    const value = (await response.text()).match(/name="csrf" value="([^"]+)"/)?.[1];
    expect(value).toBeTruthy();
    return value as string;
  };
  const registration = await app(
    request("/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: [redirect], token_endpoint_auth_method: "none" }),
    }),
  );
  expect(registration.status).toBe(201);
  const { client_id: clientId } = await registration.json();
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    resource,
    scope: "mcp",
    state: "mcp-state",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  const login = await app(request(`/auth/authorize?${query}`));
  const cookie = login.headers.getSetCookie()[0]?.split(";")[0] as string;
  const upstream = await post(
    "/auth/login",
    { csrf: await csrf(login), webid: POD_ISSUER },
    cookie,
  );
  const callback = lws.op.callback((await navigation(upstream)).href);
  const consent = await app(new Request(callback, { headers: { cookie } }));
  const approval = await post(
    "/auth/consent",
    { csrf: await csrf(consent), decision: "allow" },
    cookie,
  );
  const code = (await navigation(approval)).searchParams.get("code") as string;
  const token = await post("/auth/token", {
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: redirect,
    resource,
    code_verifier: verifier,
    code,
  });
  expect(token.status).toBe(200);
  const { access_token: accessToken } = await token.json();
  const call = (name: string, args: unknown) =>
    app(
      request("/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      }),
    );
  for (let n = 0; n < 2; n++) {
    const response = await call("pod_read", { url: `${POD_ROOT}note.txt` });
    expect(response.status).toBe(200);
    const result = (await response.json()).result;
    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toBe("private LWS content");
  }
  const listing = (await (await call("pod_list", { container: POD_ROOT })).json()).result;
  expect(listing.isError).not.toBe(true);
  expect(listing.content[0].text).toContain(`${POD_ROOT}note.txt`);
  expect(lws.exchanges).toHaveLength(1);
  expect(
    lws.requests.some((request) => request.headers.get("authorization")?.includes(accessToken)),
  ).toBe(false);
  expect((await post("/auth/revoke", { token: accessToken, client_id: clientId })).status).toBe(
    200,
  );
  expect((await call("pod_read", { url: `${POD_ROOT}note.txt` })).status).toBe(401);
});
