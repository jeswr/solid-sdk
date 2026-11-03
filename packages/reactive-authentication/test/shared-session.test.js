// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  CachingClientProvider,
  DPoPTokenProvider,
  DynamicRegistrationClientProvider,
  OidcIdTokenSource,
  SessionFence,
  SolidUmaTokenProvider,
  XASProvider,
} from "../src/mod.js";
import { insecure } from "./helpers/http.js";
import { automaticCodeProvider, startOpenIdProvider } from "./helpers/openid.js";
import { startUma } from "./helpers/uma.js";

test("Solid, UMA and LWS sources reuse one session and reject a different fence", async () => {
  const op = await startOpenIdProvider({
    subject: "https://id.example/alice",
    webId: "https://id.example/alice",
  });
  const umaServer = await startUma(op);
  try {
    const code = automaticCodeProvider();
    const as = new XASProvider({ getIssuer: async () => new URL(op.issuer) }, insecure);
    const client = new CachingClientProvider(new DynamicRegistrationClientProvider(insecure));
    const fence = new SessionFence("shared-session", { broadcast: false });
    const options = { http: insecure, fence, context: async () => "shared" };
    const callback = "https://app.example/callback";
    const solid = new DPoPTokenProvider(callback, code, as, client, undefined, options);
    const request = new Request(`${umaServer.url}/uma/shared`);
    await solid.upgrade(request);
    const uma = new SolidUmaTokenProvider(callback, code, as, client, {
      ...options,
      session: solid.session,
    });
    const { challengeContext } = await import("../src/challenge.js");
    const { transport } = await import("./helpers/http.js");
    const upgraded = await uma.upgrade(request, challengeContext(await transport(request)));
    assert.equal((await transport(upgraded)).status, 200);
    const metadata = await as.getAuthorizationServer(request);
    const source = new OidcIdTokenSource(metadata, callback, code, client, {
      ...options,
      session: solid.session,
      context: "shared",
    });
    const credential = await source.getCredential({
      authorizationServer: new URL(op.issuer),
      resource: new URL(umaServer.url),
      signal: new AbortController().signal,
    });
    assert.equal(credential.tokenType, "urn:ietf:params:oauth:token-type:id_token");
    assert.equal((await source.identity()).subject, "https://id.example/alice");
    assert.equal(code.calls, 1);
    assert.throws(
      () => new SolidUmaTokenProvider(callback, code, as, client, { session: solid.session }),
      /same SessionFence/,
    );
    const other = new SessionFence("other-session", { broadcast: false });
    assert.throws(
      () =>
        new OidcIdTokenSource(metadata, callback, code, client, {
          fence: other,
          session: solid.session,
        }),
      /same SessionFence/,
    );
    await source.forget();
    assert.equal(await solid.identity(request), undefined);
  } finally {
    await umaServer.close();
    await op.close();
  }
});
