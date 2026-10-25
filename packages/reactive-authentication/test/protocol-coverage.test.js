// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import { DataFactory, Parser } from "n3";
import { afterEach, test, vi } from "vitest";
import { authorizationCodeGrant } from "../src/authorizationCodeGrant.js";
import { parseChallenges } from "../src/challenge.js";
import { generateDPoPKey } from "../src/dpopNonce.js";
import {
  AutomaticCredentialBoundary,
  ClientCredentialsTokenProvider,
  ClientIdClientProvider,
  DPoPTokenProvider,
  DynamicRegistrationClientProvider,
  LwsTokenProvider,
  readIssuerHint,
  SessionFence,
  SolidUmaTokenProvider,
  trustUmaServers,
  WebIdIssuerProvider,
} from "../src/mod.js";
import { SimpleDataset } from "../src/SimpleDataset.js";
import { fetchTurtle, parseWebId, WebIdAgent } from "../src/webId.js";

afterEach(() => vi.unstubAllGlobals());
const signal = () => new AbortController().signal;
const typedRoot = () =>
  new Response(null, {
    status: 401,
    headers: { link: '<http://www.w3.org/ns/pim/space#Storage>; rel="type"' },
  });

test("automatic boundaries reuse verified roots, remove them and key undiscovered resources exactly", async () => {
  const boundary = new AutomaticCredentialBoundary();
  const root = "https://pod.example/alice/";
  assert.equal(
    await boundary.discover(root, typedRoot(), { method: "GET", signal: signal() }),
    true,
  );
  assert.equal(
    await boundary.discover(root, new Response(), { method: "GET", signal: signal() }),
    true,
  );
  assert.equal(
    await boundary.discover("https://pod.example/", typedRoot(), {
      method: "GET",
      signal: signal(),
    }),
    true,
  );
  assert.equal(await boundary.contextKey(new Request(`${root}a`)), root);
  assert.equal(
    await boundary.contextKey(new Request("https://other.example/a#fragment")),
    "https://other.example/a",
  );
  assert.equal(
    await boundary.contextKey(new Request("http://other.example/a")),
    "http://other.example/a",
  );
  assert.equal(boundary.delete(root), true);
  assert.equal(boundary.allows(`${root}a`), true);
  boundary.clear();
  assert.equal(boundary.allows(`${root}a`), false);
  assert.equal(
    await boundary.discover("invalid", new Response(), { method: "GET", signal: signal() }),
    false,
  );
  const headers = new AutomaticCredentialBoundary({ traversal: "headers-only" });
  assert.equal(
    await headers.discover("https://pod.example/", new Response(), {
      method: "GET",
      signal: signal(),
    }),
    false,
  );
});

test("write discovery probes can identify the target root and failures do not authorize it", async () => {
  const fetch = vi.fn(async () => typedRoot());
  const boundary = new AutomaticCredentialBoundary({ http: { fetch } });
  assert.equal(
    await boundary.discover("https://pod.example/alice/", new Response(null, { status: 401 }), {
      method: "PUT",
      signal: signal(),
    }),
    true,
  );
  assert.equal(fetch.mock.calls.length, 1);
  const missing = new AutomaticCredentialBoundary({
    http: {
      fetch: async () => {
        throw new Error("offline");
      },
    },
    maxProbes: 1,
  });
  assert.equal(
    await missing.discover("https://pod.example/a/", new Response(null, { status: 401 }), {
      method: "POST",
      signal: signal(),
    }),
    false,
  );
});

test("automatic boundaries evict the oldest verified root at their configured capacity", async () => {
  const boundary = new AutomaticCredentialBoundary({ maxRoots: 1 });
  for (const root of ["https://pod.example/a/", "https://pod.example/b/"]) {
    assert.equal(
      await boundary.discover(root, typedRoot(), { method: "GET", signal: signal() }),
      true,
    );
  }
  assert.deepEqual(boundary.roots, ["https://pod.example/b/"]);
  assert.equal(boundary.allows("https://pod.example/a/private"), false);
  assert.equal(boundary.allows("https://pod.example/b/private"), true);
});

test("client documents surface HTTP errors and dynamic registration omits unsupported refresh grants", async () => {
  const bad = new ClientIdClientProvider(new URL("https://app.example/id"), {
    fetch: async () => new Response(null, { status: 404 }),
  });
  await assert.rejects(bad.getClient({}, "https://app.example/callback", signal()), /404/);
  const fetch = vi.fn(async () => Response.json({ client_id: "registered" }, { status: 201 }));
  const client = await new DynamicRegistrationClientProvider({ fetch }).getClient(
    {
      issuer: "https://issuer.example/",
      registration_endpoint: "https://issuer.example/register",
      scopes_supported: [],
    },
    "https://app.example/callback",
    signal(),
  );
  assert.equal(client.client_id, "registered");
  assert.deepEqual(JSON.parse(fetch.mock.calls[0][1].body).grant_types, ["authorization_code"]);
});

test("provider routing handles missing and irrelevant challenges and invalidations", async () => {
  const as = { getAuthorizationServer: async () => ({ issuer: "https://issuer.example/" }) };
  const request = new Request("https://pod.example/a");
  const dpop = new DPoPTokenProvider("https://app.example/cb", {}, as, {});
  const fence = new SessionFence("cc", { broadcast: false });
  const cc = new ClientCredentialsTokenProvider(as, "c", "s", { fence });
  for (const p of [dpop, cc]) {
    assert.equal(await p.matches(request), true);
    assert.equal(await p.matches(request, { challenges: [{ scheme: "bearer" }] }), true);
    assert.equal(await p.matches(request, { challenges: [{ scheme: "dpop" }] }), true);
    assert.equal(await p.matches(request, { challenges: [{ scheme: "uma" }] }), false);
    await p.invalidate(request);
    await p.invalidate(new Request(request, { headers: { authorization: "DPoP unknown" } }));
  }
  const source = {
    type: "urn:example:credential",
    get: async () => ({ token: "subject" }),
    forget: async () => {},
  };
  const lws = new LwsTokenProvider(source);
  await lws.invalidate(request);
  await assert.rejects(lws.upgrade(request), /challenge/);
  await assert.rejects(
    lws.upgrade(request, {
      challenges: [
        { scheme: "bearer", params: { as_uri: "invalid", realm: "https://pod.example/" } },
      ],
    }),
    /challenge/,
  );
  assert.throws(
    () => new LwsTokenProvider(source, { metadataStore: createMemoryStore() }),
    /namespace/,
  );
  const uma = new SolidUmaTokenProvider("https://app.example/cb", {}, as, {});
  await uma.invalidate(request);
  await uma.invalidate(new Request(request, { headers: { authorization: "Bearer unknown" } }));
  await assert.rejects(uma.upgrade(request), /challenge/);
  assert.throws(
    () =>
      new SolidUmaTokenProvider(
        "https://app.example/cb",
        {},
        as,
        {},
        { metadataStore: createMemoryStore() },
      ),
    /namespace/,
  );
  const trust = trustUmaServers([new URL("https://uma.example/")]);
  assert.equal(await trust({ authorizationServer: new URL("https://uma.example/") }), true);
  assert.equal(await trust({ authorizationServer: new URL("https://evil.example/") }), false);
  fence.close();
});

test("code grants protect protocol fields and enforce PKCE and authorization metadata", async () => {
  const options = {
    authorizationServer: { issuer: "https://issuer.example/" },
    client: { client_id: "c" },
    redirectUri: "https://app.example/cb",
    scopes: [],
    codeProvider: {},
    signal: signal(),
  };
  await assert.rejects(
    authorizationCodeGrant({ ...options, parameters: { state: "override" } }),
    /cannot be overridden/,
  );
  await assert.rejects(
    authorizationCodeGrant({
      ...options,
      authorizationServer: {
        ...options.authorizationServer,
        code_challenge_methods_supported: ["plain"],
      },
      requireS256: true,
    }),
    /S256/,
  );
  await assert.rejects(authorizationCodeGrant(options), /authorization_endpoint/);
  let method;
  await assert.rejects(
    authorizationCodeGrant({
      ...options,
      authorizationServer: {
        ...options.authorizationServer,
        authorization_endpoint: "https://issuer.example/auth",
        code_challenge_methods_supported: ["plain"],
      },
      codeProvider: {
        getCode: async (url) => {
          method = url.searchParams.get("code_challenge_method");
          throw new Error("UI cancelled");
        },
      },
    }),
    /UI cancelled/,
  );
  assert.equal(method, "plain");
  await assert.rejects(
    generateDPoPKey({ dpop_signing_alg_values_supported: ["unsupported"] }),
    /No supported/,
  );
  assert.deepEqual(parseChallenges(",,,"), []);
  assert.equal(readIssuerHint("https://app.example/").issuer, undefined);
});

test("WebID parsing rejects failed or invalid RDF documents and ambiguous issuers", async () => {
  await assert.rejects(
    fetchTurtle(new URL("https://alice.example/#me"), undefined, {
      fetch: async () => new Response(null, { status: 403 }),
    }),
    /403/,
  );
  await assert.rejects(
    fetchTurtle(new URL("https://alice.example/#me"), undefined, {
      fetch: async () => new Response("not Turtle !!!"),
    }),
    /parsed as Turtle/,
  );
  assert.equal(parseWebId("invalid"), undefined);
  assert.equal(parseWebId("http://alice.example/"), undefined);
  assert.equal(parseWebId("http://alice.example/", true).href, "http://alice.example/");
  const ttl =
    "<https://alice.example/#me> <http://www.w3.org/ns/solid/terms#oidcIssuer> <https://issuer1.example/>, <https://issuer2.example/>; <http://www.w3.org/ns/pim/space#storage> <https://pod.example/> .";
  const provider = new WebIdIssuerProvider(async () => new URL("https://alice.example/#me"), {
    fetch: async () => new Response(ttl),
  });
  await assert.rejects(provider.getIssuer(new Request("https://pod.example/")), /several issuers/);
  const agent = new WebIdAgent(
    "https://alice.example/#me",
    new SimpleDataset(new Parser().parse(ttl)),
    DataFactory,
  );
  assert.deepEqual(
    [...agent.storages].map((url) => url.href),
    ["https://pod.example/"],
  );
});
