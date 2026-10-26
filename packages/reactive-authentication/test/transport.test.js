// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { DataFactory, Writer } from "n3";
import { test } from "vitest";
import { discoverLwsAuthorizationServer } from "../src/lws/tokenExchange.js";
import { ClientIdClientProvider } from "../src/mod.js";
import { secureFetch } from "../src/transport.js";
import { issuersFromWebId } from "../src/webId.js";
import { insecure, serve, transport } from "./helpers/http.js";

const issuer = "https://metadata.example/";
const webId = `${issuer}profile#me`;
const clientId = `${issuer}client.json`;
const redirectUri = "https://app.example/callback";

for (const document of ["LWS metadata", "WebID profile", "client document"]) {
  test(`${document} rejects a redirect before loading insecure trust metadata`, async () => {
    const writer = new Writer();
    writer.addQuad(
      DataFactory.namedNode(webId),
      DataFactory.namedNode("http://www.w3.org/ns/solid/terms#oidcIssuer"),
      DataFactory.namedNode(issuer),
    );
    const turtle = await new Promise((resolve, reject) => {
      writer.end((error, result) => (error ? reject(error) : resolve(result)));
    });
    const server = await serve((request, { url }) => {
      if (new URL(request.url).pathname !== "/insecure")
        return new Response(null, { status: 302, headers: { location: `${url}/insecure` } });
      if (document === "WebID profile")
        return new Response(turtle, { headers: { "content-type": "text/turtle" } });
      return Response.json(
        document === "client document"
          ? { client_id: clientId, redirect_uris: [redirectUri] }
          : { issuer, token_endpoint: `${issuer}token` },
      );
    });
    try {
      // Route the initial HTTPS URL to a loopback fixture. Native fetch then handles any redirect;
      // the HTTP Location must never be followed, even when its document would otherwise validate.
      const http = {
        fetch: (url, init) => transport(new URL(new URL(url).pathname, server.url), init),
      };
      const signal = new AbortController().signal;
      const load = () => {
        if (document === "LWS metadata")
          return discoverLwsAuthorizationServer(new URL(issuer), signal, http);
        if (document === "WebID profile") return issuersFromWebId(new URL(webId), signal, http);
        return new ClientIdClientProvider(new URL(clientId), http).getClient(
          {},
          redirectUri,
          signal,
        );
      };
      await assert.rejects(load(), TypeError);
      assert.equal(server.requests.length, 1, "the redirect target was never contacted");
      assert.notEqual(new URL(server.requests[0].url).pathname, "/insecure");
    } finally {
      await server.close();
    }
  });
}

test("secure transport rejects automatic redirects and preserves manual redirect inspection", async () => {
  const server = await serve((request, { url }) =>
    new URL(request.url).pathname === "/redirect"
      ? new Response(null, { status: 307, headers: { location: `${url}/target` } })
      : new Response("untrusted"),
  );
  try {
    const url = new URL(`${server.url}/redirect`);
    for (const redirect of [undefined, "follow", "error"]) {
      await assert.rejects(secureFetch(url, { redirect }, insecure), TypeError);
    }
    const signal = new AbortController().signal;
    const response = await secureFetch(
      url,
      { method: "HEAD", redirect: "manual", signal, headers: { accept: "text/turtle" } },
      insecure,
    );
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), `${server.url}/target`);
    assert.equal(server.requests.length, 4);
    assert.ok(server.requests.every((request) => new URL(request.url).pathname === "/redirect"));
    assert.equal(server.requests.at(-1).method, "HEAD");
    assert.equal(server.requests.at(-1).headers.get("accept"), "text/turtle");
    await response.body?.cancel();
  } finally {
    await server.close();
  }
});

test("client document follows HTTPS redirects and validates the configured client identifier", async () => {
  const requests = [];
  const http = {
    fetch: async (url, init) => {
      requests.push({ url: new URL(url).href, init });
      if (requests.length === 1)
        return new Response(null, { status: 303, headers: { location: "/clients/app.json" } });
      return Response.json({ client_id: clientId, redirect_uris: [redirectUri] });
    },
  };
  const signal = new AbortController().signal;
  const client = await new ClientIdClientProvider(new URL(clientId), http).getClient(
    {},
    redirectUri,
    signal,
  );
  assert.equal(client.client_id, clientId);
  assert.deepEqual(
    requests.map(({ url }) => url),
    [clientId, `${issuer}clients/app.json`],
  );
  for (const { init } of requests) {
    assert.equal(init.redirect, "manual");
    assert.equal(init.credentials, "omit");
    assert.equal(init.signal, signal);
  }

  requests.length = 0;
  const moved = {
    fetch: async (url) => {
      requests.push({ url: new URL(url).href });
      if (requests.length === 1)
        return new Response(null, { status: 301, headers: { location: "/clients/app.json" } });
      return Response.json({
        client_id: `${issuer}clients/app.json`,
        redirect_uris: [redirectUri],
      });
    },
  };
  await assert.rejects(
    new ClientIdClientProvider(new URL(clientId), moved).getClient({}, redirectUri, signal),
    /client_id does not match/,
  );
});
