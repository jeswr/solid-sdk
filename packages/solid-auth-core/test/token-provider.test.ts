// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { once } from "node:events";
import { createServer } from "node:http";
import * as DPoP from "dpop";
import * as oauth from "oauth4webapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LiveSession, WebIdDPoPTokenProvider } from "../src/controller.js";
import { isProviderOAuthRequest, proactiveAuthenticatedFetch } from "../src/proactive-fetch.js";

import { FOREIGN, POD, spoofedRequests } from "./request-fixtures.js";

const TOKEN = "synthetic-access-token";

async function fixture() {
  const dpopKey = await DPoP.generateKeyPair("ES256");
  const client: oauth.Client = { client_id: "https://app.example/client" };
  const session: LiveSession = {
    generation: 1,
    issuer: new URL("https://issuer.example/"),
    webId: "https://pod.example/profile/card#me",
    accessToken: TOKEN,
    dpopKey,
    dpopHandle: oauth.DPoP(client, dpopKey),
    authorizationServer: { issuer: "https://issuer.example/" },
    client,
    allowedOrigins: new Set([new URL(POD).origin]),
  };
  const refresh = vi.fn(async () => true);
  const provider = new WebIdDPoPTokenProvider(() => session, refresh);
  return { session, refresh, provider };
}

/** Decode and verify the real proof, so target/method assertions cover the emitted JWT. */
async function proofOf(request: Request, session: LiveSession) {
  const proof = request.headers.get("DPoP");
  if (!proof) throw new Error("Expected a DPoP proof");
  const [header, payload, signature] = proof.split(".");
  expect(
    await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      session.dpopKey.publicKey,
      Buffer.from(signature, "base64url"),
      new TextEncoder().encode(`${header}.${payload}`),
    ),
  ).toBe(true);
  return JSON.parse(Buffer.from(payload, "base64url").toString());
}

describe("WebIdDPoPTokenProvider — owned request target (sst-m040)", () => {
  let setup: Awaited<ReturnType<typeof fixture>>;
  beforeEach(async () => {
    setup = await fixture();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  for (const [name, makeRequest] of spoofedRequests) {
    for (const force of [false, true]) {
      it(`keeps ${name} credential-free, forceRefresh=${force}`, async () => {
        setup.session.expiresAt = 0;
        const request = makeRequest();
        const upgraded = await setup.provider.upgrade(makeRequest(), force);
        const sent = new Request(upgraded);
        expect(sent.url).toBe(FOREIGN);
        expect(sent.headers.get("Authorization")).toBeNull();
        expect(sent.headers.get("DPoP")).toBeNull();
        expect(await setup.provider.matches(request)).toBe(false);
        expect(setup.refresh).not.toHaveBeenCalled();
      });
    }

    it(`refuses a nonce from ${name}`, async () => {
      expect(
        setup.provider.rememberNonce(
          new Response(null, { headers: { "DPoP-Nonce": "foreign-nonce" } }),
          makeRequest(),
        ),
      ).toBe(false);
      const sent = await setup.provider.upgrade(new Request(POD));
      expect((await proofOf(sent, setup.session)).nonce).toBeUndefined();
    });

    it(`keeps ${name} public on a 401 through the proactive wrapper`, async () => {
      const sent: Request[] = [];
      const base: typeof fetch = async (input, init) => {
        sent.push(new Request(input, init));
        return new Response(null, { status: 401, headers: { "DPoP-Nonce": "foreign-nonce" } });
      };
      const upgrade = vi.spyOn(setup.provider, "upgrade");
      await proactiveAuthenticatedFetch(
        { provider: setup.provider, allowedOrigins: setup.session.allowedOrigins },
        base,
        makeRequest(),
      );
      expect(sent).toHaveLength(1);
      expect(sent[0].url).toBe(FOREIGN);
      expect(sent[0].headers.has("Authorization")).toBe(false);
      expect(sent[0].headers.has("DPoP")).toBe(false);
      expect(upgrade).not.toHaveBeenCalled();
      expect(setup.refresh).not.toHaveBeenCalled();
    });
  }

  it("rejects Request-like objects without reading their spoofed url getter", async () => {
    const url = vi.fn(() => POD);
    const request = {
      get url() {
        return url();
      },
      method: "GET",
      headers: new Headers(),
      toString: () => FOREIGN,
    } as unknown as Request;
    expect(await setup.provider.matches(request)).toBe(false);
    expect(await setup.provider.upgrade(request, true)).toBe(request);
    expect(request.headers.has("Authorization")).toBe(false);
    expect(request.headers.has("DPoP")).toBe(false);
    expect(
      setup.provider.rememberNonce(
        new Response(null, {
          headers: { "DPoP-Nonce": "spoofed-nonce" },
        }),
        request,
      ),
    ).toBe(false);
    expect(url).not.toHaveBeenCalled();
    expect(setup.refresh).not.toHaveBeenCalled();
  });

  it("does not accept an object inheriting Request.prototype as a native request", async () => {
    const request = Object.create(Request.prototype);
    Object.defineProperty(request, "url", { value: POD });
    expect(await setup.provider.matches(request)).toBe(false);
    expect(await setup.provider.upgrade(request)).toBe(request);
  });

  it("preserves normal allowed requests and signs the actual target and method", async () => {
    const abort = new AbortController();
    const request = new Request(`${POD}?version=1#fragment`, {
      method: "PUT",
      headers: { "Content-Type": "text/plain", "X-Caller": "original" },
      body: "original body",
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      mode: "same-origin",
      referrer: "https://app.example/",
      referrerPolicy: "no-referrer",
      integrity: "sha256-synthetic",
      keepalive: true,
      signal: abort.signal,
    });
    const expected = request.clone();
    expect(await setup.provider.matches(request)).toBe(true);
    expect(request.bodyUsed).toBe(false); // matches must not consume an upload
    const upgraded = await setup.provider.upgrade(request);
    expect(upgraded.url).toBe(`${POD}?version=1#fragment`);
    expect(upgraded.headers.get("Authorization")).toBe(`DPoP ${TOKEN}`);
    expect(upgraded.headers.get("X-Caller")).toBe("original");
    expect(upgraded.headers.get("Content-Type")).toBe("text/plain");
    for (const key of [
      "method",
      "redirect",
      "credentials",
      "cache",
      "mode",
      "referrer",
      "referrerPolicy",
      "integrity",
      "keepalive",
    ] as const) {
      expect(upgraded[key]).toBe(expected[key]);
    }
    expect(await proofOf(upgraded, setup.session)).toMatchObject({ htu: POD, htm: "PUT" });
    expect(await upgraded.text()).toBe("original body");
    expect(await expected.text()).toBe("original body");
    abort.abort();
    expect(upgraded.signal.aborted).toBe(true);
  });

  it("leaves normal foreign requests unauthenticated", async () => {
    const request = new Request(FOREIGN);
    expect(await setup.provider.matches(request)).toBe(false);
    const upgraded = await setup.provider.upgrade(request);
    expect(upgraded.url).toBe(FOREIGN);
    expect(upgraded.headers.has("Authorization")).toBe(false);
    expect(upgraded.headers.has("DPoP")).toBe(false);
  });

  for (const status of [307, 308]) {
    it(`makes a direct upgraded POST manual on a same-origin ${status} redirect`, async () => {
      const received: { url?: string; method?: string; body: string; auth?: string }[] = [];
      const server = createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        received.push({
          url: request.url,
          method: request.method,
          body: Buffer.concat(chunks).toString(),
          auth: request.headers.authorization,
        });
        response.writeHead(request.url === "/start" ? status : 200, { Location: "/final" });
        response.end("ok");
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Expected a TCP address");
        const origin = `http://127.0.0.1:${address.port}`;
        setup.session.allowedOrigins = new Set([origin]);
        const upgraded = await setup.provider.upgrade(
          new Request(`${origin}/start`, { method: "POST", body: "ABC" }),
        );
        const response = await fetch(upgraded);
        expect(upgraded.redirect).toBe("manual");
        expect(response.status).toBe(status);
        expect(await response.text()).toBe("ok");
        expect(response.url).toBe(`${origin}/start`);
        expect(received).toEqual(
          ["/start"].map((url) => ({
            url,
            method: "POST",
            body: "ABC",
            auth: `DPoP ${TOKEN}`,
          })),
        );
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    });
  }

  for (const force of [false, true]) {
    it(`keeps a no-cors POST uncredentialed without refreshing, forceRefresh=${force}`, async () => {
      setup.session.expiresAt = 0;
      const request = new Request(POD, { method: "POST", mode: "no-cors", body: "no-cors body" });
      expect(await setup.provider.matches(request)).toBe(false);
      const upgraded = await setup.provider.upgrade(request, force);
      expect(upgraded).toBe(request);
      const sent = new Request(upgraded);
      expect(sent.url).toBe(POD);
      expect(sent.method).toBe("POST");
      expect(sent.mode).toBe("no-cors");
      expect(sent.redirect).toBe("follow");
      expect(sent.headers.has("Authorization")).toBe(false);
      expect(sent.headers.has("DPoP")).toBe(false);
      expect(await sent.text()).toBe("no-cors body");
      expect(setup.refresh).not.toHaveBeenCalled();
    });
  }

  it("preserves no-cors POST and abort propagation through the proactive wrapper", async () => {
    const abort = new AbortController();
    let delivered!: Request;
    const response = await proactiveAuthenticatedFetch(
      { provider: setup.provider, allowedOrigins: setup.session.allowedOrigins },
      async (input, init) => {
        delivered = new Request(input, init);
        expect(delivered.url).toBe(POD);
        expect(delivered.method).toBe("POST");
        expect(delivered.mode).toBe("no-cors");
        expect(await delivered.text()).toBe("no-cors body");
        expect(delivered.redirect).toBe("follow");
        expect(delivered.headers.has("Authorization")).toBe(false);
        expect(delivered.headers.has("DPoP")).toBe(false);
        return new Response("ok");
      },
      POD,
      { method: "POST", mode: "no-cors", body: "no-cors body", signal: abort.signal },
    );
    expect(await response.text()).toBe("ok");
    expect(delivered.signal.aborted).toBe(false);
    abort.abort("caller cancelled");
    expect(delivered.signal.aborted).toBe(true);
    expect(delivered.signal.reason).toBe("caller cancelled");
  });

  it("uses the actual scheme even when url is shadowed with an HTTPS pod URL", async () => {
    const request = new Request("http://pod.example/private/note");
    Object.defineProperty(request, "url", { value: POD });
    expect(await setup.provider.matches(request)).toBe(false);
    const sent = new Request(await setup.provider.upgrade(request));
    expect(sent.url).toBe("http://pod.example/private/note");
    expect(sent.headers.has("Authorization")).toBe(false);
    expect(sent.headers.has("DPoP")).toBe(false);
  });

  it("does not let a foreign request poison the pod's cached nonce", async () => {
    const request = new Request(FOREIGN);
    Object.defineProperty(request, "url", { value: POD });
    expect(
      setup.provider.rememberNonce(
        new Response(null, {
          headers: { "DPoP-Nonce": "foreign-nonce" },
        }),
        request,
      ),
    ).toBe(false);
    const sent = await setup.provider.upgrade(new Request(POD));
    expect((await proofOf(sent, setup.session)).nonce).toBeUndefined();
  });

  it("classifies OAuth infrastructure by the native target", () => {
    const issuers = new Set(["https://issuer.example"]);
    const resource = new Request(POD);
    Object.defineProperty(resource, "url", {
      value: "https://issuer.example/.well-known/openid-configuration",
    });
    expect(isProviderOAuthRequest(resource, issuers)).toBe(false);
    const discovery = new Request("https://issuer.example/.well-known/openid-configuration");
    Object.defineProperty(discovery, "url", { value: POD });
    expect(isProviderOAuthRequest(discovery, issuers)).toBe(true);
  });

  for (const force of [false, true]) {
    it(`uses the native URL across refresh, forceRefresh=${force}`, async () => {
      setup.session.expiresAt = 0;
      const request = new Request(POD, { method: "POST", body: "original" });
      const url = vi.fn(() => FOREIGN);
      Object.defineProperty(request, "url", { configurable: true, get: url });
      setup.provider.rememberNonce(
        new Response(null, { headers: { "DPoP-Nonce": "pod-nonce" } }),
        request,
      );
      setup.refresh.mockImplementationOnce(async () => {
        Object.defineProperty(request, "url", { value: FOREIGN });
        return true;
      });
      const sent = await setup.provider.upgrade(request, force);
      expect(setup.refresh).toHaveBeenCalledOnce();
      expect(url).not.toHaveBeenCalled();
      expect(sent.url).toBe(POD);
      expect(sent.headers.get("Authorization")).toBe(`DPoP ${TOKEN}`);
      expect(await proofOf(sent, setup.session)).toMatchObject({
        htu: POD,
        htm: "POST",
        nonce: "pod-nonce",
      });
      expect(await sent.text()).toBe("original");
    });
  }

  it("strips both credentials if construction changes the checked destination", async () => {
    const request = new Request(POD);
    const NativeRequest = Request;
    vi.stubGlobal(
      "Request",
      class extends NativeRequest {
        constructor(_input: RequestInfo | URL, init?: RequestInit) {
          super(FOREIGN, init);
        }
      },
    );
    const sent = await setup.provider.upgrade(request);
    expect(sent.url).toBe(FOREIGN);
    expect(sent.headers.has("Authorization")).toBe(false);
    expect(sent.headers.has("DPoP")).toBe(false);
  });

  it("uses the captured platform getter even if the prototype getter is replaced later", async () => {
    const url = vi.spyOn(Request.prototype, "url", "get").mockReturnValue(POD);
    const request = new Request(FOREIGN);
    expect(await setup.provider.matches(request)).toBe(false);
    expect(await setup.provider.upgrade(request, true)).toBe(request);
    expect(url).not.toHaveBeenCalled();
  });

  it("rejects the other realm's real Request brand", async () => {
    const makeRequest = spoofedRequests[4][1];
    const request = makeRequest();
    expect(request).not.toBeInstanceOf(Request);
    const getter = Object.getOwnPropertyDescriptor(Request.prototype, "url")?.get;
    if (!getter) throw new Error("Expected the platform URL getter");
    expect(() => Reflect.apply(getter, request, [])).toThrow();
    expect(await setup.provider.upgrade(request, true)).toBe(request);
  });
});
