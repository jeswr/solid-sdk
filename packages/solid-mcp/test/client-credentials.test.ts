// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, it, vi } from "vitest";
import { scopedFetch } from "../src/auth.js";
import { createCliFetch } from "../src/client-credentials.js";
import { ISSUER, mockCss, POD, proofOf, TOKEN } from "./fixtures/css.mjs";

const config = {
  podRoot: POD,
  readOnly: true,
  clientId: "fixture-id",
  clientSecret: "fixture-secret",
  oidcIssuer: ISSUER,
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("CSS client credentials", () => {
  it("reuses one token, signs real DPoP proofs and preserves Request bodies/headers", async () => {
    const css = mockCss();
    const fetch = await createCliFetch(config, css.fetch);
    await fetch(`${POD}note?query=1#fragment`);
    await fetch(
      new Request(`${POD}write`, {
        method: "PUT",
        body: "hello fixture",
        headers: { "if-none-match": "*" },
      }),
    );
    expect(css.stats).toMatchObject({ tokens: 1, discoveries: 1, reads: 2, writes: 1 });
    expect(new Set(css.proofs.map((p) => p.jti)).size).toBe(3);
    expect(css.proofs[0].jwk).toEqual(css.proofs[2].jwk);
  });
  it("renews once for concurrent requests after expiry using the same key", async () => {
    const css = mockCss();
    const fetch = await createCliFetch(config, css.fetch);
    const now = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now + 61_000);
    await Promise.all([fetch(`${POD}note`), fetch(`${POD}note`)]);
    expect(css.stats.tokens).toBe(2);
    expect(css.stats.discoveries).toBe(1);
    expect(css.proofs[0].jwk).toEqual(css.proofs[1].jwk);
  });
  it("keeps an in-flight proof and header bound to the same token during renewal", async () => {
    const css = mockCss();
    const sent: string[] = [];
    const fetch = await createCliFetch(config, async (input, init) => {
      const request = new Request(input, init);
      if (request.url.startsWith(POD)) {
        const token = request.url === `${POD}in-flight` ? "fixture-token-1" : "fixture-token-2";
        expect(request.headers.get("authorization")).toBe(`DPoP ${token}`);
        proofOf(request, token);
        sent.push(token);
        return new Response("ok");
      }
      const response = await css.fetch(input, init);
      if (request.url === TOKEN)
        return Response.json({ ...(await response.json()), expires_in: 1 });
      return response;
    });
    const now = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    const signing = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const sign = globalThis.crypto.subtle.sign.bind(globalThis.crypto.subtle);
    vi.spyOn(globalThis.crypto.subtle, "sign").mockImplementationOnce(async (...args) => {
      signing.resolve();
      await resume.promise;
      return sign(...args);
    });

    const inFlight = fetch(`${POD}in-flight`);
    await signing.promise;
    try {
      vi.setSystemTime(now + 2_000);
      expect((await fetch(`${POD}renewed`)).ok).toBe(true);
      expect(css.stats.tokens).toBe(2);
    } finally {
      resume.resolve();
    }
    expect((await inFlight).ok).toBe(true);
    expect((await fetch(`${POD}later`)).ok).toBe(true);
    expect(sent).toEqual(["fixture-token-2", "fixture-token-1", "fixture-token-2"]);
    expect(css.stats.tokens).toBe(2);
    expect(css.proofs[0].jwk).toEqual(css.proofs[1].jwk);
  });
  it("supports an explicit token endpoint without discovery", async () => {
    const css = mockCss();
    const { oidcIssuer: _, ...rest } = config;
    await createCliFetch({ ...rest, tokenUrl: TOKEN }, css.fetch);
    expect(css.stats).toMatchObject({ tokens: 1, discoveries: 0 });
  });
  it.each([
    "http://127.0.0.1:9090/internal",
    "http://localhost:9090/internal",
    "http://[::1]:9090/internal",
  ])("refuses a public issuer advertising loopback token endpoint %s before POST", async (endpoint) => {
    const raw = vi.fn(async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "POST")
        return Response.json({ access_token: "fixture", token_type: "DPoP" });
      return Response.json({ issuer: ISSUER, token_endpoint: endpoint });
    });
    await expect(createCliFetch(config, raw)).rejects.toThrow(/login failed/);
    expect(raw).toHaveBeenCalledTimes(1);
    expect(raw.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
  });
  it.each([
    "issuer",
    "tokenUrl",
  ])("supports explicitly configured HTTP loopback %s", async (kind) => {
    const issuer = "http://127.0.0.1:3000/";
    const endpoint = `${issuer}token`;
    const raw = vi.fn(async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "POST") {
        expect(request.url).toBe(endpoint);
        expect(request.headers.get("authorization")).toMatch(/^Basic /);
        proofOf(request);
        return Response.json({ access_token: "fixture", token_type: "DPoP" });
      }
      return Response.json({ issuer, token_endpoint: endpoint });
    });
    await createCliFetch(
      {
        ...config,
        ...(kind === "tokenUrl" ? { tokenUrl: endpoint } : { oidcIssuer: issuer }),
      },
      raw,
    );
    expect(raw).toHaveBeenCalledTimes(kind === "issuer" ? 2 : 1);
  });
  it.each(["discovery", "token"])("caps streamed %s JSON at 1 MiB before parsing", async (kind) => {
    const cancel = vi.fn();
    let pulls = 0;
    const json =
      kind === "discovery"
        ? { issuer: ISSUER, token_endpoint: TOKEN }
        : { access_token: "fixture", token_type: "DPoP" };
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (pulls === 0) controller.enqueue(new TextEncoder().encode(JSON.stringify(json)));
            else if (pulls <= 32) controller.enqueue(new Uint8Array(64 * 1024).fill(32));
            else controller.close();
            pulls++;
          },
          cancel,
        },
        { highWaterMark: 0 },
      ),
      // A dishonest length must not bypass the streamed limit.
      { headers: { "content-length": "1" } },
    );
    const raw = vi.fn(async (_input, init) =>
      kind === "discovery" && init?.method === "POST"
        ? Response.json({ access_token: "fixture", token_type: "DPoP" })
        : response,
    );
    await expect(
      createCliFetch({ ...config, ...(kind === "token" ? { tokenUrl: TOKEN } : {}) }, raw),
    ).rejects.toThrow(/login failed/);
    expect(raw).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(pulls).toBeLessThan(33);
  });
  it("propagates the discovery deadline signal and cancels an unfinished JSON body", async () => {
    vi.useFakeTimers();
    const started = Promise.withResolvers<void>();
    const cancel = vi.fn();
    let signal: AbortSignal | null | undefined;
    const raw: typeof fetch = async (_input, init) => {
      signal = init?.signal;
      return new Response(new ReadableStream({ start: () => started.resolve(), cancel }));
    };
    const rejected = expect(createCliFetch(config, raw)).rejects.toThrow(/login failed/);
    await started.promise;
    await vi.advanceTimersByTimeAsync(30_001);
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("retries AS and resource nonce challenges with newly signed proofs", async () => {
    const css = mockCss();
    let tokenAttempts = 0;
    let resourceAttempts = 0;
    const fetch = await createCliFetch(config, async (input, init) => {
      const request = new Request(input, init);
      if (request.url === TOKEN) {
        const proof = proofOf(request);
        if (++tokenAttempts === 1)
          return new Response(null, { status: 400, headers: { "DPoP-Nonce": "as-nonce" } });
        expect(proof.nonce).toBe("as-nonce");
      }
      if (request.url === `${POD}note`) {
        const proof = proofOf(request, "fixture-token-1");
        if (++resourceAttempts === 1)
          return new Response(null, { status: 401, headers: { "DPoP-Nonce": "rs-nonce" } });
        expect(proof.nonce).toBe("rs-nonce");
      }
      return css.fetch(input, init);
    });
    expect((await fetch(`${POD}note`)).ok).toBe(true);
    expect([tokenAttempts, resourceAttempts]).toEqual([2, 2]);
  });
  it("retries both concurrent resource challenges and caches the nonce for later calls", async () => {
    const css = mockCss();
    const urls = [`${POD}first`, `${POD}second`];
    const nonces = new Map<string, unknown[]>();
    const jtis = new Set<string>();
    let releaseChallenges!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      releaseChallenges = resolve;
    });
    const fetch = await createCliFetch(config, async (input, init) => {
      const request = new Request(input, init);
      if (request.url.startsWith(POD)) {
        const proof = proofOf(request, "fixture-token-1");
        const sent = nonces.get(request.url) ?? [];
        sent.push(proof.nonce);
        nonces.set(request.url, sent);
        jtis.add(proof.jti);
        if (urls.includes(request.url) && sent.length === 1) {
          if (nonces.size === 2) releaseChallenges();
          await bothStarted;
          return new Response(null, { status: 401, headers: { "DPoP-Nonce": "rs-nonce" } });
        }
        expect(proof.nonce).toBe("rs-nonce");
      }
      return css.fetch(input, init);
    });

    const responses = await Promise.all(urls.map((url) => fetch(url)));
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(urls.map((url) => nonces.get(url))).toEqual([
      [undefined, "rs-nonce"],
      [undefined, "rs-nonce"],
    ]);
    expect((await fetch(`${POD}later`)).ok).toBe(true);
    expect(nonces.get(`${POD}later`)).toEqual(["rs-nonce"]);
    expect(jtis.size).toBe(5);
    expect(css.stats).toMatchObject({ tokens: 1, discoveries: 1, reads: 3 });
  });
  it("never sends pod credentials to an off-pod profile or follows an escaping redirect", async () => {
    const css = mockCss();
    const fetch = await createCliFetch(config, css.fetch);
    await fetch("https://profile.example/me", {
      headers: { authorization: "DPoP fixture-token-1", dpop: "fixture" },
    });
    await expect(scopedFetch({ ...config, fetch })(`${POD}redirect`)).rejects.toThrow(
      /pod-scope violation/,
    );
  });
  it.each([
    { issuer: "https://wrong.example/", token_endpoint: TOKEN },
    { issuer: ISSUER, token_endpoint: "http://insecure.example/token" },
    { issuer: ISSUER, token_endpoint: TOKEN, authorization_endpoint: "http://127.0.0.1/auth" },
    { issuer: ISSUER, token_endpoint: TOKEN, registration_endpoint: "http://127.0.0.1/register" },
    { issuer: ISSUER, token_endpoint: TOKEN, jwks_uri: "http://127.0.0.1/jwks" },
    { issuer: ISSUER, token_endpoint: "https://user:fixture@issuer.example/token" },
    { issuer: ISSUER },
  ])("refuses invalid discovery metadata %j", async (metadata) => {
    const raw = vi.fn(async () => Response.json(metadata));
    await expect(createCliFetch(config, raw)).rejects.toThrow(/login failed/);
    expect(raw).toHaveBeenCalledTimes(1);
  });
  it.each([
    { access_token: "fixture", token_type: "Bearer" },
    { token_type: "DPoP" },
    { access_token: "fixture\n", token_type: "DPoP" },
    { access_token: "fixture", token_type: "DPoP", expires_in: -1 },
    { access_token: "fixture", token_type: "DPoP", expires_in: "60" },
  ])("refuses malformed token responses %j", async (token) => {
    await expect(
      createCliFetch({ ...config, tokenUrl: TOKEN }, async () => Response.json(token)),
    ).rejects.toThrow(/login failed/);
  });
  it("does not disclose server errors or follow token redirects", async () => {
    const raw = vi.fn(async (_input, init) => {
      expect(init.redirect).toBe("manual");
      return new Response("fixture-secret", {
        status: 302,
        headers: { location: "https://foreign.example/" },
      });
    });
    await expect(createCliFetch({ ...config, tokenUrl: TOKEN }, raw)).rejects.toThrow(
      "CSS client-credentials login failed; check issuer, endpoint and credentials.",
    );
    expect(raw).toHaveBeenCalledTimes(1);
  });
  it("preserves anonymous fetch when no credentials are configured", async () => {
    const raw = vi.fn();
    expect(await createCliFetch({ podRoot: POD, readOnly: true }, raw)).toBe(raw);
  });

  it("fails closed when discovery returns an HTTP error", async () => {
    const raw = vi.fn(async () => new Response("fixture-secret", { status: 503 }));
    await expect(createCliFetch(config, raw)).rejects.toThrow(
      "CSS client-credentials login failed; check issuer, endpoint and credentials.",
    );
    expect(raw).toHaveBeenCalledTimes(1);
  });
});
