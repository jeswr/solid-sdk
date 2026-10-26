// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { afterAll as after, beforeAll as before, test } from "vitest";
import { SignedXml } from "xml-crypto";
import {
  CredentialBoundary,
  createControlledIdentifierDocument,
  DidKeySource,
  DynamicRegistrationClientProvider,
  didKeyFromPublicKey,
  LwsTokenProvider,
  OidcIdTokenSource,
  ReactiveFetchManager,
  SamlAssertionSource,
  SelfIssuedJwtSource,
  SessionFence,
  TokenType,
  trustAuthorizationServers,
  trustBindings,
  XASProvider,
} from "../src/mod.js";
import { insecure, serve, transport } from "./helpers/http.js";
import { jwkFromDidKey, startLws, TYPES } from "./helpers/lws.js";
import { automaticCodeProvider, startOpenIdProvider } from "./helpers/openid.js";
import { callback } from "./helpers/solid.js";

const idp = (() => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    entityId: "https://idp.example/saml",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKey: publicKey.export({ type: "spki", format: "pem" }),
  };
})();

let op, lws, cid;
const cidDocuments = {};
before(async () => {
  op = await startOpenIdProvider({
    subject: "https://id.example/alice#me",
    webId: "https://id.example/alice#me",
  });
  lws = await startLws({ op, idp });
  cid = await serve((request) => {
    const document = cidDocuments[new URL(request.url).pathname];
    return document ? Response.json(document) : new Response(null, { status: 404 });
  });
});
after(async () => {
  await cid.close();
  await lws.close();
  await op.close();
});

function lwsManager(source, options = {}) {
  const provider = new LwsTokenProvider(source, { http: insecure, ...options });
  const boundary = new CredentialBoundary([`${lws.url}/root/`, `${lws.url}/other/`], {
    allowInsecureHttp: true,
  });
  return {
    provider,
    manager: new ReactiveFetchManager({
      providers: [provider],
      boundary,
      fence: source.fence,
      fetch: transport,
    }),
  };
}

/** A signed SAML 2.0 assertion from the test IdP (what an established SAML stack would hand the app). */
function signedAssertion({
  audience,
  nameId = "https://id.example/alice",
  recipient = "https://app.example/saml",
  tamper,
} = {}) {
  const notOnOrAfter = new Date(Date.now() + 300_000).toISOString();
  const now = new Date().toISOString();
  const xml =
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_a${crypto.randomUUID()}" Version="2.0" IssueInstant="${now}">` +
    `<saml:Issuer>${idp.entityId}</saml:Issuer>` +
    `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">${nameId}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}" Recipient="${recipient}"/></saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${now}" NotOnOrAfter="${notOnOrAfter}"><saml:AudienceRestriction><saml:Audience>${recipient}</saml:Audience><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
    `</saml:Assertion>`;
  const signer = new SignedXml({
    privateKey: idp.privateKey,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });
  signer.addReference({
    xpath: "/*[local-name(.)='Assertion']",
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
  });
  signer.computeSignature(xml, {
    location: {
      reference: "/*[local-name(.)='Assertion']/*[local-name(.)='Issuer']",
      action: "after",
    },
  });
  const signed = signer.getSignedXml();
  return {
    xml: tamper ? signed.replace(nameId, "https://id.example/mallory") : signed,
    clientId: recipient,
  };
}

test("LWS OpenID suite: ID token from the OpenID provider exchanged for a realm-bound Bearer token", async () => {
  const openIdProvider = await new XASProvider(
    { getIssuer: async () => new URL(op.issuer) },
    insecure,
  ).getAuthorizationServer(new Request("https://unused.example/"));
  const code = automaticCodeProvider();
  const fence = new SessionFence("lws-openid", { broadcast: false });
  const source = new OidcIdTokenSource(
    openIdProvider,
    callback,
    code,
    new DynamicRegistrationClientProvider(insecure),
    { http: insecure, fence },
  );
  const { manager } = lwsManager(source, { fence });

  const response = await manager.fetch(`${lws.url}/root/doc`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "hello https://id.example/alice#me");
  const exchange = lws.stats.exchanges.at(-1);
  assert.equal(exchange.subject_token_type, TokenType.idToken);
  assert.equal(exchange.resource, `${lws.url}/storage_1`, "resource is the realm");
  assert.equal(
    exchange.client_id,
    decodeJwt(exchange.subject_token).azp,
    "azp is the LWS client identifier",
  );
  assert.equal((await source.identity()).webId, "https://id.example/alice#me");

  // The access token is cached per (AS, realm, credential); a second resource needs no exchange.
  const exchanges = lws.stats.exchanges.length;
  assert.equal((await manager.fetch(`${lws.url}/root/other`)).status, 200);
  assert.equal(lws.stats.exchanges.length, exchanges);
  assert.equal(code.calls, 1);
  fence.close();
});

test("LWS OIDC requires one explicit fence for its source and provider", () => {
  const fence = new SessionFence("lws-explicit-fence", { broadcast: false });
  const other = new SessionFence(fence.namespace, { broadcast: false });
  const sourceWith = (options) =>
    new OidcIdTokenSource({ issuer: op.issuer }, callback, {}, {}, options);
  try {
    for (const options of [undefined, null, {}, { fence: null }, { http: insecure }]) {
      assert.throws(() => sourceWith(options), /requires.*SessionFence/);
    }
    const source = sourceWith({ fence });
    assert.equal(source.fence, fence);
    assert.throws(() => new LwsTokenProvider(source), /share.*SessionFence/);
    assert.throws(() => new LwsTokenProvider(source, { fence: other }), /share.*SessionFence/);
    assert.doesNotThrow(() => new LwsTokenProvider(source, { fence }));
  } finally {
    fence.close();
    other.close();
  }
});

test("LWS manager logs out and logs in again with its provider and OIDC source sharing one fence", async () => {
  const namespace = `lws-login-${crypto.randomUUID()}`;
  const fence = new SessionFence(namespace, { broadcast: false });
  const code = automaticCodeProvider();
  const metadata = await new XASProvider(
    { getIssuer: async () => new URL(op.issuer) },
    insecure,
  ).getAuthorizationServer(new Request("https://unused.example/"));
  const source = new OidcIdTokenSource(
    metadata,
    callback,
    code,
    new DynamicRegistrationClientProvider(insecure),
    { http: insecure, fence },
  );
  const provider = new LwsTokenProvider(source, { http: insecure, fence });
  const manager = new ReactiveFetchManager({
    providers: [provider],
    boundary: new CredentialBoundary([`${lws.url}/root/`], { allowInsecureHttp: true }),
    fence,
    fetch: transport,
  });
  const url = `${lws.url}/root/logout-login`;
  const exchanges = lws.stats.exchanges.length;
  const grants = op.stats.token.length;
  let previousToken;
  try {
    assert.equal((await transport(url)).status, 401, "the resource requires authentication");
    for (let session = 0; session < 3; session++) {
      const response = await manager.fetch(url);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "hello https://id.example/alice#me");
      assert.equal((await source.identity()).subject, "https://id.example/alice#me");
      assert.equal(code.calls, session + 1);
      assert.equal(op.stats.token.length - grants, session + 1);
      assert.equal(lws.stats.exchanges.length - exchanges, session + 1);
      const token = lws.stats.exchanges.at(-1).subject_token;
      assert.notEqual(token, previousToken, "logout discarded the old OIDC credential");
      previousToken = token;
      assert.equal((await manager.fetch(url)).status, 200);
      assert.equal(lws.stats.exchanges.length - exchanges, session + 1, "cached until logout");

      const generation = await fence.generation();
      const signal = fence.signal;
      await manager.logout();
      assert.ok((await fence.generation()) > generation);
      assert.equal(signal.aborted, true);
      assert.equal(await source.identity(), undefined);
    }
  } finally {
    fence.close();
  }
});

test("LWS preserves its captured generation when a peer logs out before OIDC credential acquisition", async () => {
  const namespace = `lws-generation-${crypto.randomUUID()}`;
  const generations = createMemoryStore();
  const started = Promise.withResolvers();
  const gate = Promise.withResolvers();
  let pauseRead = false;
  const fence = new SessionFence(namespace, {
    broadcast: false,
    store: {
      ...generations,
      getItem: async (key) => {
        const value = await generations.getItem(key);
        if (pauseRead) {
          pauseRead = false;
          started.resolve();
          await gate.promise; // Let validation return its pre-logout generation.
        }
        return value;
      },
    },
  });
  const peer = new SessionFence(namespace, { store: generations, broadcast: false });
  const memory = createMemoryStore();
  const durable = createMemoryStore();
  const metadata = createMemoryStore();
  const writes = [];
  const persisted = [];
  const code = automaticCodeProvider();
  const openIdProvider = await new XASProvider(
    { getIssuer: async () => new URL(op.issuer) },
    insecure,
  ).getAuthorizationServer(new Request("https://unused.example/"));
  const source = new OidcIdTokenSource(
    openIdProvider,
    callback,
    code,
    new DynamicRegistrationClientProvider(insecure),
    {
      http: insecure,
      namespace,
      fence,
      cache: {
        ...memory,
        setItem: async (key, value) => {
          writes.push(value);
          await memory.setItem(key, value);
        },
      },
      sessionStore: {
        ...durable,
        setItem: async (key, value) => {
          persisted.push(value);
          await durable.setItem(key, value);
        },
      },
    },
  );
  const { manager } = lwsManager(source, {
    namespace,
    fence,
    metadataStore: {
      ...metadata,
      setItem: async (key, value) => {
        await metadata.setItem(key, value);
        pauseRead = true; // Pause validation immediately before the credential-source call.
      },
    },
  });
  const exchanges = lws.stats.exchanges.length;
  const grants = op.stats.token.length;
  const pending = manager.fetch(`${lws.url}/root/peer-logout`);
  const rejected = assert.rejects(pending, { name: "SessionSupersededError" });
  try {
    await started.promise;
    await peer.supersede();
    assert.equal(fence.signal.aborted, false, "no broadcast masks the generation race");
    gate.resolve();
    await rejected;
    assert.deepEqual(
      {
        logins: code.calls,
        grants: op.stats.token.length - grants,
        exchanges: lws.stats.exchanges.length - exchanges,
        cacheGenerations: writes.map((entry) => entry.generation),
        durableGenerations: persisted.map((entry) => entry.generation),
      },
      { logins: 0, grants: 0, exchanges: 0, cacheGenerations: [], durableGenerations: [] },
      "the superseded exchange cannot authorize, disclose claims or commit credentials",
    );
    assert.equal(await source.identity(), undefined);
    assert.equal((await manager.fetch(`${lws.url}/root/peer-logout`)).status, 200);
    assert.equal(code.calls, 1, "a fresh LWS operation can log in after logout");
    assert.equal(writes.at(-1).generation, 1);
    assert.equal(persisted.at(-1).generation, 1);
  } finally {
    gate.resolve();
    await Promise.allSettled([pending, rejected]);
    fence.close();
    peer.close();
  }
});

test("LWS controlled-identifier suite: self-issued JWT whose kid selects the published verification method", async () => {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  const subject = `${cid.url}/agent`;
  const { document, keyId } = await createControlledIdentifierDocument(subject, keys.publicKey);
  cidDocuments["/agent"] = document;
  const { manager } = lwsManager(
    new SelfIssuedJwtSource({ subject, privateKey: keys.privateKey, algorithm: "ES256", keyId }),
  );

  assert.equal((await manager.fetch(`${lws.url}/root/a`)).status, 200);
  const token = lws.stats.exchanges.at(-1).subject_token;
  const claims = decodeJwt(token);
  assert.equal(claims.sub, subject);
  assert.equal(claims.iss, subject);
  assert.equal(claims.client_id, subject);
  assert.deepEqual(claims.aud, [`${lws.url}/`]);
  assert.ok(claims.exp - claims.iat <= 300 && claims.jti);
  assert.equal(decodeProtectedHeader(token).kid, `${subject}#key-1`);
  assert.equal(lws.stats.accepted.at(-1).sub, subject);
});

test("LWS controlled-identifier suite: a key not published for authentication is rejected by the verifier", async () => {
  const published = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  const subject = `${cid.url}/imposter`;
  const { document, keyId } = await createControlledIdentifierDocument(
    subject,
    published.publicKey,
  );
  cidDocuments["/imposter"] = document;
  const { manager } = lwsManager(
    new SelfIssuedJwtSource({ subject, privateKey: other.privateKey, algorithm: "ES256", keyId }),
  );
  await assert.rejects(manager.fetch(`${lws.url}/root/a`), (e) => e.error === "invalid_grant");
  assert.match(lws.stats.rejected.at(-1), /signature/);
});

test("LWS did:key suite: identifiers derived from Ed25519 and P-256 keys verify independently", async () => {
  for (const algorithm of ["Ed25519", "P-256"]) {
    const source = await DidKeySource.generate(algorithm);
    assert.match(source.did, algorithm === "Ed25519" ? /^did:key:z6Mk/ : /^did:key:zDn/);
    const { manager } = lwsManager(source);
    assert.equal((await manager.fetch(`${lws.url}/root/k`)).status, 200, algorithm);
    const claims = decodeJwt(lws.stats.exchanges.at(-1).subject_token);
    assert.equal(claims.sub, source.did);
    assert.equal(claims.client_id, source.did);
    assert.equal(lws.stats.accepted.at(-1).sub, source.did);
  }
});

test("did:key encoding matches the did:key specification test vector", async () => {
  // did:key spec (w3c-ccg) Ed25519 example: public key bytes and identifier.
  const jwk = jwkFromDidKey("did:key:z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, true, ["verify"]);
  assert.equal(
    await didKeyFromPublicKey(key),
    "did:key:z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp",
  );
  // The P-256 identifier from the LWS did:key suite example round-trips through SEC1 compression.
  const p256 = jwkFromDidKey("did:key:zDnaerx9CtbPJ1q36T5Ln5wYt3MQYeGRG5ehnPAmxcf5mDZpv");
  const ecKey = await crypto.subtle.importKey(
    "jwk",
    p256,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );
  assert.equal(
    await didKeyFromPublicKey(ecKey),
    "did:key:zDnaerx9CtbPJ1q36T5Ln5wYt3MQYeGRG5ehnPAmxcf5mDZpv",
  );
});

test("LWS SAML suite: a signed assertion is transported base64url-encoded and validated by the AS", async () => {
  const source = new SamlAssertionSource({
    id: "idp.example/alice",
    obtainAssertion: async ({ authorizationServer }) =>
      signedAssertion({ audience: authorizationServer.href }),
  });
  const { manager } = lwsManager(source);
  assert.equal((await manager.fetch(`${lws.url}/root/s`)).status, 200);
  const exchange = lws.stats.exchanges.at(-1);
  assert.equal(exchange.subject_token_type, TYPES.saml2);
  assert.equal(exchange.client_id, "https://app.example/saml");
  assert.equal(lws.stats.accepted.at(-1).sub, "https://id.example/alice");
});

test("LWS SAML suite: tampered assertions and wrong audiences are rejected by the AS, not trusted by the client", async () => {
  for (const assertion of [
    signedAssertion({ audience: `${lws.url}/`, tamper: true }),
    signedAssertion({ audience: "https://other-as.example/" }),
  ]) {
    const { manager } = lwsManager(
      new SamlAssertionSource({ id: crypto.randomUUID(), obtainAssertion: async () => assertion }),
    );
    await assert.rejects(manager.fetch(`${lws.url}/root/s`), (e) => e.error === "invalid_grant");
  }
  assert.match(lws.stats.rejected.at(-2), /signature|digest/i);
  assert.match(lws.stats.rejected.at(-1), /audience/);
  await assert.rejects(
    new SamlAssertionSource({
      id: "x",
      obtainAssertion: async () => ({ xml: "<Response/>", clientId: "c" }),
    }).getCredential({
      authorizationServer: new URL("https://as.example"),
      resource: new URL("https://s.example"),
      signal: AbortSignal.timeout(1000),
    }),
    /Assertion/,
  );
});

test("realm containment is verified before any credential is disclosed", async () => {
  const source = await DidKeySource.generate();
  const { manager } = lwsManager(source);
  const exchanges = lws.stats.exchanges.length;
  // /other/ is inside the application's boundary, but not in the challenge's realm (StorageRoot is /root/).
  await assert.rejects(manager.fetch(`${lws.url}/other/x`), /not contained in realm/);
  assert.equal(lws.stats.exchanges.length, exchanges);
});

test("an authorization server named by a challenge is not trusted by default across origins", async () => {
  const evil = await serve(() => new Response(null, { status: 500 }));
  const lws2 = await startLws({ op, idp, asUri: () => `${evil.url}/` });
  try {
    const source = await DidKeySource.generate();
    const provider = new LwsTokenProvider(source, { http: insecure });
    const boundary = new CredentialBoundary([`${lws2.url}/root/`], { allowInsecureHttp: true });
    const manager = new ReactiveFetchManager({ providers: [provider], boundary, fetch: transport });
    await assert.rejects(manager.fetch(`${lws2.url}/root/x`), /not trusted/);
    assert.equal(evil.requests.length, 0, "no discovery or credential sent to the untrusted AS");

    // An explicitly listed AS is contacted for realms on the resource's origin.
    await assert.rejects(
      new ReactiveFetchManager({
        providers: [
          new LwsTokenProvider(source, {
            http: insecure,
            trustAuthorizationServer: trustAuthorizationServers([`${evil.url}/`]),
          }),
        ],
        boundary,
        fetch: transport,
      }).fetch(`${lws2.url}/root/x`),
    );
    assert.ok(evil.requests.length > 0);
    evil.requests.length = 0;

    const allowing = new LwsTokenProvider(source, {
      http: insecure,
      trustAuthorizationServer: trustBindings([
        { authorizationServer: `${evil.url}/`, realm: `${lws2.url}/storage_1` },
      ]),
    });
    const m2 = new ReactiveFetchManager({ providers: [allowing], boundary, fetch: transport });
    await assert.rejects(m2.fetch(`${lws2.url}/root/x`));
    assert.ok(evil.requests.length > 0, "explicitly trusted AS is contacted");
  } finally {
    await lws2.close();
    await evil.close();
  }
});

test("unsupported subject token types are refused before sending the credential", async () => {
  const lws2 = await startLws({ op, idp, subjectTokenTypes: [TYPES.saml2] });
  try {
    const provider = new LwsTokenProvider(await DidKeySource.generate(), { http: insecure });
    const boundary = new CredentialBoundary([`${lws2.url}/root/`], { allowInsecureHttp: true });
    const manager = new ReactiveFetchManager({ providers: [provider], boundary, fetch: transport });
    await assert.rejects(manager.fetch(`${lws2.url}/root/x`), /does not support/);
    assert.equal(lws2.stats.exchanges.length, 0);
  } finally {
    await lws2.close();
  }
});

test("a rejected LWS access token is exchanged again once", async () => {
  const source = await DidKeySource.generate();
  const { manager, provider } = lwsManager(source);
  assert.equal((await manager.fetch(`${lws.url}/root/r`)).status, 200);
  const exchanges = lws.stats.exchanges.length;
  await provider.invalidate(
    new Request("https://x/", { headers: { authorization: "Bearer unrelated" } }),
  );
  assert.equal((await manager.fetch(`${lws.url}/root/r`)).status, 200);
  assert.equal(lws.stats.exchanges.length, exchanges, "unrelated invalidation keeps the cache");
  await manager.logout();
  assert.equal((await manager.fetch(`${lws.url}/root/r`)).status, 200);
  assert.equal(lws.stats.exchanges.length, exchanges + 1, "logout forgets the access token");
});

test("extension: any protocol can plug in through TokenProvider (custom challenge scheme)", async () => {
  const server = await serve((request) =>
    request.headers.get("authorization") === "Custom secret"
      ? new Response("custom ok")
      : new Response(null, { status: 401, headers: { "www-authenticate": 'Custom realm="demo"' } }),
  );
  try {
    const custom = {
      async matches(_, challenge) {
        return challenge?.challenges.some((c) => c.scheme === "custom") ?? false;
      },
      async upgrade(request) {
        const headers = new Headers(request.headers);
        headers.set("Authorization", "Custom secret");
        return new Request(request, { headers });
      },
    };
    const { provider: lwsProvider } = lwsManager(await DidKeySource.generate());
    const manager = new ReactiveFetchManager({
      providers: [lwsProvider, custom],
      boundary: new CredentialBoundary([`${server.url}/`], { allowInsecureHttp: true }),
      fetch: transport,
    });
    assert.equal(await (await manager.fetch(`${server.url}/x`)).text(), "custom ok");
  } finally {
    await server.close();
  }
});

/** A credential source that records whether it was ever asked, optionally blocking until released. */
function recordingSource(inner, gate) {
  return {
    id: inner.id,
    calls: 0,
    async getCredential(request) {
      this.calls++;
      if (gate) await gate.promise;
      return await inner.getCredential(request);
    },
  };
}

test("review-3 #1: a foreign realm whose description claims the local StorageRoot cannot attract credentials", async () => {
  const foreign = await serve((request, { url }) =>
    new URL(request.url).pathname === "/storage"
      ? Response.json({
          id: `${url}/storage`,
          type: "Storage",
          service: [{ type: "StorageRoot", serviceEndpoint: `${resource.url}/` }],
        })
      : Response.json({ issuer: `${url}/`, token_endpoint: `${url}/token` }),
  );
  const resource = await serve((request, { url }) =>
    request.headers.has("authorization")
      ? new Response("leaked")
      : new Response(null, {
          status: 401,
          headers: {
            "www-authenticate": `Bearer as_uri="${foreign.url}/", realm="${foreign.url}/storage"`,
          },
        }),
  );
  try {
    const source = recordingSource(await DidKeySource.generate());
    const provider = new LwsTokenProvider(source, { http: insecure });
    const manager = new ReactiveFetchManager({
      providers: [provider],
      boundary: new CredentialBoundary([`${resource.url}/`], { allowInsecureHttp: true }),
      fetch: transport,
    });
    await assert.rejects(manager.fetch(`${resource.url}/doc`), /not trusted/);
    assert.equal(source.calls, 0, "credential never acquired");
    assert.equal(foreign.requests.length, 0, "the foreign realm and AS were never contacted");
  } finally {
    await resource.close();
    await foreign.close();
  }
});

test("review-3 #2: logout through a shared fence invalidates other instances' cached LWS tokens", async () => {
  const [fenceA, fenceB] = (await import("./helpers/solid.js")).sharedFences();
  const source = await DidKeySource.generate();
  const a = lwsManager(source, { fence: fenceA });
  const b = lwsManager(source, { fence: fenceB });
  assert.equal((await b.manager.fetch(`${lws.url}/root/f`)).status, 200);
  const exchanges = lws.stats.exchanges.length;
  assert.equal((await b.manager.fetch(`${lws.url}/root/f`)).status, 200);
  assert.equal(lws.stats.exchanges.length, exchanges, "cached before logout");

  await a.provider.forget();
  assert.equal((await b.manager.fetch(`${lws.url}/root/f`)).status, 200);
  assert.equal(lws.stats.exchanges.length, exchanges + 1, "pre-logout token not reused");
  fenceA.close();
  fenceB.close();
});

test("review-3 #2: forget() during an LWS exchange prevents the late token from being cached or attached", async () => {
  const gate = Promise.withResolvers();
  const source = recordingSource(await DidKeySource.generate(), gate);
  const { manager, provider } = lwsManager(source);
  const pending = manager.fetch(`${lws.url}/root/p`);
  while (source.calls === 0) await new Promise((r) => setTimeout(r, 5));
  await provider.forget();
  gate.resolve();
  await assert.rejects(
    pending,
    (e) => e.name === "SessionSupersededError" || e.name === "AbortError",
  );
  const exchanges = lws.stats.exchanges.length;
  assert.equal((await manager.fetch(`${lws.url}/root/p`)).status, 200);
  assert.equal(
    lws.stats.exchanges.length,
    exchanges + 1,
    "nothing was cached by the superseded exchange",
  );
});

test("review-3 #4: the LWS OpenID suite refuses ID tokens without a URI subject", async () => {
  const opaque = await startOpenIdProvider({ subject: "opaque-123" });
  const fence = new SessionFence("lws-claims", { broadcast: false });
  try {
    const metadata = await new XASProvider(
      { getIssuer: async () => new URL(opaque.issuer) },
      insecure,
    ).getAuthorizationServer(new Request("https://unused.example/"));
    const source = new OidcIdTokenSource(
      metadata,
      callback,
      automaticCodeProvider(),
      new DynamicRegistrationClientProvider(insecure),
      { http: insecure, fence },
    );
    const exchanges = lws.stats.exchanges.length;
    await assert.rejects(
      lwsManager(source, { fence }).manager.fetch(`${lws.url}/root/o`),
      /sub is not a URI/,
    );
    assert.equal(lws.stats.exchanges.length, exchanges);
    const strict = new OidcIdTokenSource(
      metadata,
      callback,
      automaticCodeProvider(),
      new DynamicRegistrationClientProvider(insecure),
      { http: insecure, fence, requireAudience: true },
    );
    opaque.setSubject("https://id.example/bob");
    await assert.rejects(
      lwsManager(strict, { fence }).manager.fetch(`${lws.url}/root/o`),
      /audience/,
    );
  } finally {
    fence.close();
    await opaque.close();
  }
});

test("review-3 #4: self-issued inputs and did:key key pairs are validated", async () => {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  const base = {
    privateKey: keys.privateKey,
    algorithm: "ES256",
    keyId: "https://id.example/agent#k",
  };
  assert.throws(() => new SelfIssuedJwtSource({ ...base, subject: "agent" }), /absolute URI/);
  assert.throws(
    () => new SelfIssuedJwtSource({ ...base, subject: "https://id.example/agent#frag" }),
    /absolute URI/,
  );
  assert.throws(
    () => new SelfIssuedJwtSource({ ...base, subject: "https://id.example/agent", keyId: "" }),
    /kid/,
  );
  for (const lifetimeSeconds of [0, -5, NaN, Infinity]) {
    assert.throws(
      () =>
        new SelfIssuedJwtSource({ ...base, subject: "https://id.example/agent", lifetimeSeconds }),
      RangeError,
    );
  }
  assert.throws(
    () =>
      new SelfIssuedJwtSource({
        ...base,
        subject: "https://id.example/agent",
        privateKey: keys.publicKey,
      }),
    /private/,
  );

  const other = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
  const mine = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
  await assert.rejects(
    DidKeySource.fromKeyPair({ publicKey: mine.publicKey, privateKey: other.privateKey }),
    /does not correspond/,
  );
  assert.match((await DidKeySource.fromKeyPair(mine)).did, /^did:key:z6Mk/);
});

test("review-3 #5: LWS stores are injectable; failed token writes leave nothing usable", async () => {
  const { createMemoryStore } = await import("@key-value-kit/storage/memory");
  assert.throws(
    () => new LwsTokenProvider(recordingSource({ id: "x" }), { tokenStore: createMemoryStore() }),
    /namespace/,
  );
  const tokenStore = createMemoryStore();
  const metadataStore = createMemoryStore();
  const source = await DidKeySource.generate();
  assert.throws(
    () => new LwsTokenProvider(source, { namespace: "app", tokenStore }),
    /SessionFence/,
  );
  const { manager } = lwsManager(source, {
    namespace: "app",
    tokenStore,
    metadataStore,
    fence: (await import("./helpers/solid.js")).sharedFences()[0],
  });
  const write = tokenStore.setItem;
  tokenStore.setItem = async () => {
    throw new Error("quota");
  };
  await assert.rejects(manager.fetch(`${lws.url}/root/q`), /quota/);
  tokenStore.setItem = write;
  const exchanges = lws.stats.exchanges.length;
  assert.equal((await manager.fetch(`${lws.url}/root/q`)).status, 200);
  assert.equal(lws.stats.exchanges.length, exchanges + 1);
  assert.equal(
    (await metadataStore.getItem(`${lws.url}/`)).issuer,
    `${lws.url}/`,
    "metadata cached in the injected store",
  );
});

test("final-check #2: a stale invalidation never removes a renewed LWS token", async () => {
  const source = await DidKeySource.generate();
  const { manager, provider } = lwsManager(source);
  assert.equal((await manager.fetch(`${lws.url}/root/s1`)).status, 200);
  const first = lws.stats.accepted.at(-1);
  const oldToken = lws.server.requests.at(-1).headers.get("authorization");
  await provider.invalidate(
    new Request(`${lws.url}/root/s1`, { headers: { authorization: oldToken } }),
  );
  assert.equal((await manager.fetch(`${lws.url}/root/s1`)).status, 200); // renewed
  const exchanges = lws.stats.exchanges.length;
  const newToken = lws.server.requests.at(-1).headers.get("authorization");
  assert.notEqual(newToken, oldToken);
  await provider.invalidate(
    new Request(`${lws.url}/root/s1`, { headers: { authorization: oldToken } }),
  ); // late 401 for the old token
  assert.equal((await manager.fetch(`${lws.url}/root/s1`)).status, 200);
  assert.equal(lws.stats.exchanges.length, exchanges, "replacement kept: no extra exchange");
  assert.equal(lws.server.requests.at(-1).headers.get("authorization"), newToken);
  assert.ok(first);
});

test("final-check #1: two instances sharing a store and fence: logout wins over a pending exchange", async () => {
  const { createMemoryStore } = await import("@key-value-kit/storage/memory");
  const [fenceA, fenceB] = (await import("./helpers/solid.js")).sharedFences();
  const tokenStore = createMemoryStore();
  const inner = await DidKeySource.generate();
  const gate = Promise.withResolvers();
  const blocked = recordingSource(inner, gate);
  const a = lwsManager(inner, { namespace: "shared", tokenStore, fence: fenceA });
  const b = lwsManager(blocked, { namespace: "shared", tokenStore, fence: fenceB });
  const pending = b.manager.fetch(`${lws.url}/root/two`);
  while (blocked.calls === 0) await new Promise((r) => setTimeout(r, 5));
  await a.provider.forget();
  gate.resolve();
  await assert.rejects(
    pending,
    (e) => e.name === "SessionSupersededError" || e.name === "AbortError",
  );
  const exchanges = lws.stats.exchanges.length;
  assert.equal((await a.manager.fetch(`${lws.url}/root/two`)).status, 200);
  assert.equal(
    lws.stats.exchanges.length,
    exchanges + 1,
    "B's late token was not written to the shared store",
  );
  fenceA.close();
  fenceB.close();
});

test("follow-through #2: OIDC credential source IDs separate accounts sharing an LWS token store", async () => {
  const { createMemoryStore } = await import("@key-value-kit/storage/memory");
  const metadata = await new XASProvider(
    { getIssuer: async () => new URL(op.issuer) },
    insecure,
  ).getAuthorizationServer(new Request("https://unused.example/"));
  const [fence] = (await import("./helpers/solid.js")).sharedFences();
  const source = (account) =>
    new OidcIdTokenSource(
      metadata,
      callback,
      automaticCodeProvider(),
      new DynamicRegistrationClientProvider(insecure),
      { http: insecure, account, fence },
    );
  const [alice, bob] = [source("alice"), source("bob")];
  assert.notEqual(alice.id, bob.id);
  assert.equal(alice.id.includes("eyJ"), false, "no tokens in identifiers");

  const shared = { namespace: "shared", tokenStore: createMemoryStore(), fence };
  assert.equal((await lwsManager(alice, shared).manager.fetch(`${lws.url}/root/acct`)).status, 200);
  const exchanges = lws.stats.exchanges.length;
  assert.equal((await lwsManager(bob, shared).manager.fetch(`${lws.url}/root/acct`)).status, 200);
  assert.equal(lws.stats.exchanges.length, exchanges + 1, "bob did not reuse alice's access token");
  fence.close();
});
