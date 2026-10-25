// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { jwtVerify } from "jose";
import * as oauth from "oauth4webapi";
import { afterAll, afterEach, beforeAll, test, vi } from "vitest";
import { challengeContext } from "../src/challenge.js";
import { discoverLwsAuthorizationServer, exchangeToken } from "../src/lws/tokenExchange.js";
import {
  DynamicRegistrationClientProvider,
  OidcIdTokenSource,
  OidcSession,
  SolidUmaTokenProvider,
  XASProvider,
} from "../src/mod.js";
import { insecure, transport } from "./helpers/http.js";
import { automaticCodeProvider, startOpenIdProvider } from "./helpers/openid.js";
import { callback } from "./helpers/solid.js";
import { startUma } from "./helpers/uma.js";

// Forward every OAuth operation to the real implementation. A single malformed
// library result below exercises our own guard against new/unsupported token types.
vi.mock("oauth4webapi", { spy: true });
let op, uma;
beforeAll(async () => {
  op = await startOpenIdProvider({
    subject: "https://alice.example/#me",
    webId: "https://alice.example/#me",
  });
  uma = await startUma(op);
});
afterAll(async () => {
  await uma.close();
  await op.close();
});
afterEach(() => vi.restoreAllMocks());

test("LWS issuer paths follow RFC 8414 and DPoP exchange responses are refused", async () => {
  const signal = new AbortController().signal;
  const issuer = new URL("https://issuer.example/tenant/");
  const as = await discoverLwsAuthorizationServer(issuer, signal, {
    fetch: async (url) => {
      assert.equal(url.href, "https://issuer.example/.well-known/lws-configuration/tenant");
      return Response.json({ issuer: issuer.href, token_endpoint: "https://issuer.example/token" });
    },
  });
  await assert.rejects(
    exchangeToken(
      as,
      { token: "subject", tokenType: "urn:example:token", clientId: "client" },
      new URL("https://pod.example/"),
      signal,
      { fetch: async () => Response.json({ access_token: "access", token_type: "DPoP" }) },
    ),
    /expected Bearer/,
  );
});

test("UMA rejects an unsupported token type even if the OAuth library returns one", async () => {
  const provider = new SolidUmaTokenProvider(
    callback,
    automaticCodeProvider(),
    new XASProvider({ getIssuer: async () => new URL(op.issuer) }, insecure),
    new DynamicRegistrationClientProvider(insecure),
    { http: insecure },
  );
  const request = new Request(`${uma.url}/uma/private`);
  const challenge = challengeContext(await transport(request));
  vi.mocked(oauth.processGenericTokenEndpointResponse).mockResolvedValueOnce({
    access_token: "unsupported",
    token_type: "mac",
  });
  await assert.rejects(provider.upgrade(request, challenge), /Unsupported RPT token_type mac/);
  await provider.forget();
});

test("an ID credential retains a validated signed token when its cache expiry metadata is unavailable", async () => {
  const metadata = await (await transport(`${op.issuer}.well-known/openid-configuration`)).json();
  const source = new OidcIdTokenSource(
    metadata,
    callback,
    automaticCodeProvider(),
    new DynamicRegistrationClientProvider(insecure),
    { http: insecure },
  );
  // Fault injection affects only optional cache metadata, after a real code grant
  // and claim validation. Signature, audience, issuer and expiry remain in the JWT.
  const get = OidcSession.prototype.get;
  vi.spyOn(OidcSession.prototype, "get").mockImplementationOnce(async function (...args) {
    const entry = await get.apply(this, args);
    delete entry.idTokenExpiresAt;
    return entry;
  });
  const credential = await source.getCredential({
    authorizationServer: new URL("https://as.example/"),
    resource: new URL("https://pod.example/"),
    signal: new AbortController().signal,
  });
  const { payload } = await jwtVerify(credential.token, op.jwks, {
    issuer: op.issuer,
    audience: credential.clientId,
  });
  assert.equal(payload.sub, "https://alice.example/#me");
  assert.equal("expiresAt" in credential, false);
  await source.forget();
});
