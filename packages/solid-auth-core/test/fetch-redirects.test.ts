// AUTHORED-BY Codex GPT-6.1-Sol

import { once } from "node:events";
import { createServer } from "node:http";
import * as DPoP from "dpop";
import * as oauth from "oauth4webapi";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSolidAuth, type LiveSession, WebIdDPoPTokenProvider } from "../src/controller.js";
import { proactiveAuthenticatedFetch } from "../src/proactive-fetch.js";

const POD = "https://pod.example";
const SECOND = "https://second.example";
const FOREIGN = "https://foreign.example";
const ISSUER = "https://issuer.example";
const WEBID = `${POD}/profile/card#me`;
const CLIENT = "https://app.example/client";
const TOKEN = "synthetic-access-token";
type Wrapper = "controller" | "proactive";

/** Exercise real OAuth/DPoP code, stubbing only the OP's transport and popup. */
async function controllerFetch(base: typeof fetch, origins: string[], patchGlobalFetch = false) {
  let nonce = "";
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
  const auth = createSolidAuth({
    callbackUri: "https://app.example/callback",
    clientId: CLIENT,
    allowedOrigins: origins,
    allowInsecureLoopback: true,
    patchGlobalFetch,
    profileFetch: async () =>
      new Response(`<${WEBID}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${ISSUER}>.`, {
        headers: { "Content-Type": "text/turtle" },
      }),
    authFlow: {
      getCode: async (url) => {
        nonce = url.searchParams.get("nonce") ?? "";
        return `https://app.example/callback?code=code&state=${url.searchParams.get("state")}`;
      },
    },
    publicFetch: async (input, init) => {
      const request = new Request(input, init);
      const href = request.url;
      if (href === `${ISSUER}/.well-known/openid-configuration`) {
        return json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/authorize`,
          token_endpoint: `${ISSUER}/token`,
          jwks_uri: `${ISSUER}/jwks`,
          id_token_signing_alg_values_supported: ["ES256"],
        });
      }
      if (href === `${ISSUER}/token`) {
        const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
        const now = Math.floor(Date.now() / 1000);
        return json({
          access_token: TOKEN,
          token_type: "DPoP",
          expires_in: 3600,
          // oauth4webapi validates these claims without verifying this test ID token.
          id_token: `${b64({ alg: "ES256" })}.${b64({
            iss: ISSUER,
            sub: WEBID,
            webid: WEBID,
            aud: CLIENT,
            exp: now + 3600,
            iat: now,
            nonce,
          })}.c2lnbmF0dXJl`,
        });
      }
      return base(request);
    },
  });
  await auth.login(WEBID);
  return auth.authenticatedFetch;
}

async function wrappedFetch(kind: Wrapper, base: typeof fetch, origins = [POD, SECOND]) {
  if (kind === "controller") return controllerFetch(base, origins);
  const dpopKey = await DPoP.generateKeyPair("ES256");
  const client: oauth.Client = { client_id: CLIENT };
  const session: LiveSession = {
    generation: 1,
    issuer: new URL(ISSUER),
    webId: WEBID,
    accessToken: TOKEN,
    dpopKey,
    dpopHandle: oauth.DPoP(client, dpopKey),
    authorizationServer: { issuer: ISSUER },
    client,
    allowedOrigins: new Set(origins),
  };
  const state = {
    provider: new WebIdDPoPTokenProvider(
      () => session,
      async () => true,
    ),
    allowedOrigins: session.allowedOrigins,
  };
  return ((input, init) => proactiveAuthenticatedFetch(state, base, input, init)) as typeof fetch;
}

/** Verify the signature and token binding, as well as decoding the proof claims. */
async function proofOf(proof: string | null | undefined) {
  if (!proof) throw new Error("Expected a DPoP proof");
  const [header, payload, signature] = proof.split(".");
  const jwk = JSON.parse(Buffer.from(header, "base64url").toString()).jwk;
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  expect(
    await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      Buffer.from(signature, "base64url"),
      new TextEncoder().encode(`${header}.${payload}`),
    ),
  ).toBe(true);
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  expect(claims.ath).toBe(
    Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))).toString(
      "base64url",
    ),
  );
  return claims;
}

for (const kind of ["controller", "proactive"] as const) {
  describe(`${kind} credentialed redirects (injected transport)`, () => {
    for (const [status, method, nextMethod] of [
      [301, "POST", "GET"],
      [302, "POST", "GET"],
      [303, "PATCH", "GET"],
      [303, "HEAD", "HEAD"],
      [307, "POST", "POST"],
      [308, "PUT", "PUT"],
      [301, "PUT", "PUT"],
      [302, "PATCH", "PATCH"],
    ] as const) {
      it(`${status} ${method} follows with ${nextMethod} and a fresh bound proof`, async () => {
        const sent: { request: Request; body: string }[] = [];
        const wrapped = await wrappedFetch(kind, async (input, init) => {
          const request = new Request(input, init);
          expect(request.redirect).toBe("manual");
          sent.push({ request, body: await request.text() });
          return sent.length === 1
            ? new Response("redirect", { status, headers: { Location: "./final?q=1#part" } })
            : new Response("done");
        });
        const hasBody = method !== "HEAD";
        expect(
          await (
            await wrapped(`${POD}/start`, {
              method,
              ...(hasBody ? { body: "ABC", headers: { "Content-Type": "text/plain" } } : {}),
              redirect: "follow",
            })
          ).text(),
        ).toBe("done");
        expect(sent).toHaveLength(2);
        expect(sent[1].request.url).toBe(`${POD}/final?q=1#part`);
        expect(sent[1].request.method).toBe(nextMethod);
        expect(sent[1].body).toBe(nextMethod === "GET" || !hasBody ? "" : "ABC");
        if (nextMethod === "GET") expect(sent[1].request.headers.has("Content-Type")).toBe(false);
        const proofs = await Promise.all(
          sent.map(({ request }) => proofOf(request.headers.get("DPoP"))),
        );
        expect(proofs[0]).toMatchObject({ htu: `${POD}/start`, htm: method });
        expect(proofs[1]).toMatchObject({ htu: `${POD}/final`, htm: nextMethod });
        expect(proofs[1].jti).not.toBe(proofs[0].jti);
        for (const { request } of sent) {
          expect(request.headers.get("Authorization")).toBe(`DPoP ${TOKEN}`);
        }
      });
    }

    it("returns a foreign redirect response unchanged, including its readable body", async () => {
      const redirect = new Response("caller decides", {
        status: 302,
        headers: { Location: `${FOREIGN}/steal`, "X-Original": "kept" },
      });
      let calls = 0;
      const wrapped = await wrappedFetch(kind, async () => {
        calls++;
        return redirect;
      });
      const response = await wrapped(`${POD}/start`, { redirect: "follow" });
      expect(response).toBe(redirect);
      expect(response.headers.get("Location")).toBe(`${FOREIGN}/steal`);
      expect(response.headers.get("X-Original")).toBe("kept");
      expect(await response.text()).toBe("caller decides");
      expect(calls).toBe(1);
    });

    it("caps a loop at 20 followed hops", async () => {
      let calls = 0;
      const wrapped = await wrappedFetch(kind, async () => {
        calls++;
        return new Response(null, { status: 302, headers: { Location: "/again" } });
      });
      await expect(wrapped(`${POD}/start`)).rejects.toThrow(TypeError);
      expect(calls).toBe(21);
    });

    it("allows exactly 20 hops and stops at a redirect without Location", async () => {
      let calls = 0;
      const last = new Response("no location", { status: 302 });
      const wrapped = await wrappedFetch(kind, async () => {
        calls++;
        return calls === 21
          ? last
          : new Response(null, { status: 308, headers: { Location: "/again" } });
      });
      expect(await wrapped(`${POD}/start`, { redirect: "error" })).toBe(last);
      expect(calls).toBe(21);
    });

    it("checks an allowlisted hop before refusing its foreign redirect", async () => {
      const sent: Request[] = [];
      const wrapped = await wrappedFetch(kind, async (input, init) => {
        sent.push(new Request(input, init));
        return new Response("redirect", {
          status: 302,
          headers: { Location: sent.length === 1 ? `${SECOND}/middle` : `${FOREIGN}/end` },
        });
      });
      expect((await wrapped(`${POD}/start`)).headers.get("Location")).toBe(`${FOREIGN}/end`);
      expect(sent.map((request) => request.url)).toEqual([`${POD}/start`, `${SECOND}/middle`]);
      const first = await proofOf(sent[0].headers.get("DPoP"));
      const next = await proofOf(sent[1].headers.get("DPoP"));
      expect(next).toMatchObject({ htu: `${SECOND}/middle`, htm: "GET" });
      expect(next.jti).not.toBe(first.jti);
    });

    for (const bodyKind of ["bytes", "blob", "params", "form"] as const) {
      it(`replays a buffered ${bodyKind} body without changing its content type or bytes`, async () => {
        const form = new FormData();
        form.set("key", "value");
        const bodies = {
          bytes: new Uint8Array([0, 1, 255]),
          blob: new Blob(["payload"], { type: "text/custom" }),
          params: new URLSearchParams({ key: "value" }),
          form,
        };
        const sent: { bytes: number[]; type: string | null }[] = [];
        const wrapped = await wrappedFetch(kind, async (input, init) => {
          const request = new Request(input, init);
          sent.push({
            bytes: [...new Uint8Array(await request.arrayBuffer())],
            type: request.headers.get("Content-Type"),
          });
          return sent.length === 1
            ? new Response(null, { status: 307, headers: { Location: "/final" } })
            : new Response("done");
        });
        await wrapped(`${POD}/start`, { method: "POST", body: bodies[bodyKind] });
        expect(sent).toHaveLength(2);
        expect(sent[1]).toEqual(sent[0]);
        expect(sent[1].bytes.length).toBeGreaterThan(0);
      });
    }

    it("can discard a streaming POST body on 303", async () => {
      const sent: Request[] = [];
      const wrapped = await wrappedFetch(kind, async (input, init) => {
        const request = new Request(input, init);
        sent.push(request);
        await request.text();
        return sent.length === 1
          ? new Response(null, { status: 303, headers: { Location: "/final" } })
          : new Response("done");
      });
      const init = {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("ABC"));
            controller.close();
          },
        }),
        duplex: "half",
      };
      await wrapped(`${POD}/start`, init);
      expect(sent).toHaveLength(2);
      expect(sent[1].method).toBe("GET");
      expect(sent[1].body).toBeNull();
      expect(sent[1].headers.has("Content-Type")).toBe(false);
    });

    for (const asRequest of [false, true]) {
      for (const status of [307, 308]) {
        it(`returns ${status} unfollowed for ${asRequest ? "Request" : "ReadableStream"} bodies`, async () => {
          let calls = 0;
          const redirect = new Response("unfollowed", { status, headers: { Location: "/final" } });
          const wrapped = await wrappedFetch(kind, async (input, init) => {
            const request = new Request(input, init);
            expect(request.redirect).toBe("manual");
            expect(await request.text()).toBe("ABC");
            calls++;
            return redirect;
          });
          const init = {
            method: "POST",
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("ABC"));
                controller.close();
              },
            }),
            duplex: "half",
          };
          const response = asRequest
            ? await wrapped(new Request(`${POD}/start`, { method: "POST", body: "ABC" }))
            : await wrapped(`${POD}/start`, init);
          expect(response).toBe(redirect);
          expect(calls).toBe(1);
        });
      }
    }

    it("returns an opaqueredirect as-is without reading Location", async () => {
      // Even if an injected transport exposes redirect details on this type,
      // the wrapper must leave them untouched instead of trying to follow.
      const opaque = new Response(null, { status: 302, headers: { Location: "/hidden" } });
      Object.defineProperty(opaque, "type", { value: "opaqueredirect" });
      let calls = 0;
      const wrapped = await wrappedFetch(kind, async () => {
        calls++;
        return opaque;
      });
      expect(await wrapped(`${POD}/start`)).toBe(opaque);
      expect(calls).toBe(1);
    });

    it("keeps the caller's redirect policy on public requests", async () => {
      const policies: RequestRedirect[] = [];
      const wrapped = await wrappedFetch(kind, async (input, init) => {
        const request = new Request(input, init);
        policies.push(request.redirect);
        expect(request.headers.has("Authorization")).toBe(false);
        expect(request.headers.has("DPoP")).toBe(false);
        return new Response("public");
      });
      await wrapped(`${FOREIGN}/public`, { redirect: "follow" });
      await wrapped(`${FOREIGN}/public`, { redirect: "error" });
      expect(policies).toEqual(["follow", "error"]);
    });
  });
}

describe("controller redirect nonce scoping", () => {
  it("retries and caches a second-origin nonce only for that checked hop", async () => {
    const sent: Request[] = [];
    const wrapped = await controllerFetch(
      async (input, init) => {
        const request = new Request(input, init);
        sent.push(request);
        if (sent.length === 1) {
          return new Response(null, { status: 302, headers: { Location: `${SECOND}/final` } });
        }
        if (sent.length === 2) {
          return new Response(null, {
            status: 401,
            headers: {
              "WWW-Authenticate": 'DPoP error="use_dpop_nonce"',
              "DPoP-Nonce": "second-nonce",
            },
          });
        }
        return new Response("done");
      },
      [POD, SECOND],
    );
    expect((await wrapped(`${POD}/start`)).status).toBe(200);
    await wrapped(`${POD}/other`);
    await wrapped(`${SECOND}/other`);
    const proofs = await Promise.all(sent.map((request) => proofOf(request.headers.get("DPoP"))));
    expect(proofs.map((proof) => proof.nonce)).toEqual([
      undefined,
      undefined,
      "second-nonce",
      undefined,
      "second-nonce",
    ]);
    expect(proofs[2]).toMatchObject({ htu: `${SECOND}/final`, htm: "GET" });
    expect(proofs[2].jti).not.toBe(proofs[1].jti);
  });

  it("refuses a native-followed foreign response's nonce for the pod origin", async () => {
    const sent: Request[] = [];
    const wrapped = await controllerFetch(
      async (input, init) => {
        sent.push(new Request(input, init));
        const response = new Response("transport followed unexpectedly", {
          headers: { "DPoP-Nonce": "foreign-nonce" },
        });
        Object.defineProperty(response, "url", { value: `${FOREIGN}/final` });
        return response;
      },
      [POD],
    );
    await wrapped(`${POD}/start`);
    await wrapped(`${POD}/other`);
    expect((await proofOf(sent[1].headers.get("DPoP"))).nonce).toBeUndefined();
  });

  it("continues the loop when the nonce retry itself redirects", async () => {
    const sent: Request[] = [];
    const wrapped = await controllerFetch(
      async (input, init) => {
        sent.push(new Request(input, init));
        if (sent.length === 1) {
          return new Response(null, {
            status: 401,
            headers: {
              "WWW-Authenticate": 'DPoP error="use_dpop_nonce"',
              "DPoP-Nonce": "pod-nonce",
            },
          });
        }
        return sent.length === 2
          ? new Response(null, { status: 302, headers: { Location: `${SECOND}/final` } })
          : new Response("done", { headers: { "DPoP-Nonce": "second-nonce" } });
      },
      [POD, SECOND],
    );
    expect((await wrapped(`${POD}/start`)).status).toBe(200);
    await wrapped(`${POD}/other`);
    await wrapped(`${SECOND}/other`);
    const proofs = await Promise.all(sent.map((request) => proofOf(request.headers.get("DPoP"))));
    expect(proofs.map((proof) => proof.nonce)).toEqual([
      undefined,
      "pod-nonce",
      undefined,
      "pod-nonce",
      "second-nonce",
    ]);
  });

  it("applies the credentialed redirect policy to the patched global fetch", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    try {
      await controllerFetch(
        async (input, init) => {
          const request = new Request(input, init);
          expect(request.redirect).toBe("manual");
          calls++;
          return new Response(null, { status: 302, headers: { Location: `${FOREIGN}/end` } });
        },
        [POD],
        true,
      );
      expect((await globalThis.fetch(`${POD}/start`, { redirect: "follow" })).status).toBe(302);
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("credentialed redirects over loopback HTTP", () => {
  const received: {
    path?: string;
    method?: string;
    body: string;
    auth?: string;
    proof?: string;
  }[] = [];
  const foreignReceived: { auth?: string; proof?: string }[] = [];
  let destination = "/final";
  let status = 307;
  let origin: string;
  let second: string;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    received.push({
      path: request.url,
      method: request.method,
      body: Buffer.concat(chunks).toString(),
      auth: request.headers.authorization,
      proof: request.headers.dpop as string | undefined,
    });
    response.writeHead(request.url === "/start" ? status : 200, { Location: destination });
    response.end("ok");
  });
  const foreign = createServer((request, response) => {
    foreignReceived.push({
      auth: request.headers.authorization,
      proof: request.headers.dpop as string | undefined,
    });
    response.writeHead(200, { "DPoP-Nonce": "foreign-nonce" });
    response.end("foreign");
  });
  beforeAll(async () => {
    const start = async (instance: typeof server) => {
      instance.listen(0, "127.0.0.1");
      await once(instance, "listening");
      const address = instance.address();
      if (!address || typeof address === "string") throw new Error("Expected a TCP address");
      return `http://127.0.0.1:${address.port}`;
    };
    origin = await start(server);
    second = await start(foreign);
  });
  afterAll(async () => {
    for (const instance of [server, foreign]) {
      instance.closeAllConnections();
      if (instance.listening) {
        await new Promise<void>((resolve, reject) =>
          instance.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  });

  for (const kind of ["controller", "proactive"] as const) {
    it(`${kind}: same-origin 307 POST replays bytes with a fresh proof`, async () => {
      received.length = 0;
      status = 307;
      destination = "/final";
      const wrapped = await wrappedFetch(kind, fetch, [origin]);
      expect((await wrapped(`${origin}/start`, { method: "POST", body: "ABC" })).status).toBe(200);
      expect(
        received.map(({ path, method, body, auth }) => ({ path, method, body, auth })),
      ).toEqual(
        ["/start", "/final"].map((path) => ({
          path,
          method: "POST",
          body: "ABC",
          auth: `DPoP ${TOKEN}`,
        })),
      );
      const proofs = await Promise.all(received.map(({ proof }) => proofOf(proof)));
      expect(proofs[0]).toMatchObject({ htu: `${origin}/start`, htm: "POST" });
      expect(proofs[1]).toMatchObject({ htu: `${origin}/final`, htm: "POST" });
      expect(proofs[1].jti).not.toBe(proofs[0].jti);
    });

    it(`${kind}: foreign 302 is not followed and cannot leak headers or poison the pod nonce`, async () => {
      foreignReceived.length = 0;
      received.length = 0;
      status = 302;
      destination = `${second}/final`;
      const wrapped = await wrappedFetch(kind, fetch, [origin]);
      const response = await wrapped(`${origin}/start`, { redirect: "follow" });
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(destination);
      expect(await response.text()).toBe("ok");
      expect(foreignReceived).toEqual([]);
      // Prove the destination is live, and that explicit public fetch stays public.
      await wrapped(destination);
      expect(foreignReceived).toEqual([{ auth: undefined, proof: undefined }]);
      await wrapped(`${origin}/other`);
      expect((await proofOf(received[1].proof)).nonce).toBeUndefined();
    });

    it(`${kind}: an allowlisted second origin receives a newly bound proof`, async () => {
      received.length = 0;
      foreignReceived.length = 0;
      status = 302;
      destination = `${second}/final`;
      const wrapped = await wrappedFetch(kind, fetch, [origin, second]);
      expect((await wrapped(`${origin}/start`)).status).toBe(200);
      expect(foreignReceived).toHaveLength(1);
      expect(foreignReceived[0].auth).toBe(`DPoP ${TOKEN}`);
      const firstProof = await proofOf(received[0].proof);
      const nextProof = await proofOf(foreignReceived[0].proof);
      expect(nextProof).toMatchObject({ htu: destination, htm: "GET" });
      expect(nextProof.jti).not.toBe(firstProof.jti);
    });
  }
});
