// AUTHORED-BY Codex GPT-6.1-Sol
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loopbackFetch } from "./loopbackMock.js";

vi.mock("node:http", async () => ({
  createServer: (await import("./loopbackMock.js")).createServer,
}));

import {
  acquireToken,
  authedFetch,
  cliLogin,
  discoverProvider,
  exchangeCode,
  type FetchLike,
  generateSessionKeyPair,
  rdfFetchFor,
  refreshSession,
  startLoopbackListener,
} from "../src/index.js";

const issuer = "https://issuer.example/";
const metadata = {
  issuer,
  authorization_endpoint: `${issuer}authorize`,
  token_endpoint: `${issuer}token`,
  registration_endpoint: `${issuer}register`,
  jwks_uri: `${issuer}jwks`,
};
const creds = { issuer, id: "client", secret: "SECRET" };
const client = { client_id: "client", redirect_uris: ["http://127.0.0.1/callback"] };
const json = (body: unknown) => new Response(JSON.stringify(body));
const token = () => json({ access_token: "access", refresh_token: "REFRESH", token_type: "DPoP" });
let keyPair: Awaited<ReturnType<typeof generateSessionKeyPair>>;
beforeAll(async () => {
  keyPair = await generateSessionKeyPair();
});

function code(fetchImpl: FetchLike, options = {}) {
  return exchangeCode({
    meta: metadata,
    client,
    redirectUri: client.redirect_uris[0] as string,
    code: "CODE",
    codeVerifier: "VERIFIER",
    keyPair,
    fetchImpl,
    ...options,
  });
}

async function promptly<T>(promise: Promise<T>): Promise<T | "pending"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<"pending">((resolve) => {
        timer = setTimeout(() => resolve("pending"), 200);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe("discovery transport and issuer binding (finding 1)", () => {
  it.each([
    "http://public.example/",
    "http://localhost:3000/",
    "ftp://issuer.example/",
  ])("client credentials reject insecure issuer %s before fetching", async (badIssuer) => {
    const fetchImpl = vi.fn(async () => json(metadata));
    await expect(
      acquireToken({ ...creds, issuer: badIssuer }, keyPair, fetchImpl),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "https://other.example/",
    "https://issuer.example",
  ])("client credentials require exact discovery issuer %s", async (discoveredIssuer) => {
    const fetchImpl: FetchLike = async (url) =>
      url.includes(".well-known") ? json({ ...metadata, issuer: discoveredIssuer }) : token();
    await expect(acquireToken(creds, keyPair, fetchImpl)).rejects.toThrow(/issuer/i);
  });

  for (const flow of ["credentials", "code"] as const) {
    it.each([
      "token_endpoint",
      "authorization_endpoint",
      "registration_endpoint",
      "jwks_uri",
    ])(`${flow} rejects insecure discovered %s`, async (endpoint) => {
      const fetchImpl: FetchLike = async (url) =>
        url.includes(".well-known")
          ? json({ ...metadata, [endpoint]: "http://localhost:3000/collect" })
          : token();
      const result =
        flow === "credentials"
          ? acquireToken(creds, keyPair, fetchImpl)
          : discoverProvider(issuer, fetchImpl);
      await expect(result).rejects.toThrow(/https|insecure|loopback/i);
    });
    it(`${flow} allows HTTP loopback only with development opt-in`, async () => {
      const local = "http://127.0.0.1:3000/";
      const fetchImpl: FetchLike = async (url) =>
        url.includes(".well-known")
          ? json({ ...metadata, issuer: local, token_endpoint: `${local}token` })
          : token();
      const result =
        flow === "credentials"
          ? acquireToken(
              { ...creds, issuer: local, allowInsecureLoopback: true },
              keyPair,
              fetchImpl,
            )
          : discoverProvider(local, fetchImpl, { allowInsecureLoopback: true });
      await expect(result).resolves.toBeDefined();
    });
  }

  it("auth-code discovery rejects loopback without explicit opt-in", async () => {
    const local = "http://localhost:3000/";
    await expect(
      discoverProvider(local, async () => json({ ...metadata, issuer: local })),
    ).rejects.toThrow(/https|insecure|loopback/i);
  });
});

for (const flow of ["credentials", "code", "refresh"] as const) {
  describe(`${flow} token security`, () => {
    async function run(fetchImpl: FetchLike, options = {}) {
      if (flow === "code") return code(fetchImpl, options);
      if (flow === "refresh") {
        const session = await code(async () => token());
        return refreshSession(session, fetchImpl, options);
      }
      return acquireToken({ ...creds, ...options }, keyPair, async (url, init) =>
        url.includes(".well-known") ? json(metadata) : fetchImpl(url, init),
      );
    }

    it("forces manual token redirects and rejects 307 (finding 2)", async () => {
      let redirect: unknown;
      const result = run(async (_url, init) => {
        redirect = init?.redirect;
        return new Response(null, {
          status: 307,
          headers: { location: "https://attacker.example/" },
        });
      });
      await expect(result).rejects.toThrow(/307/);
      expect(redirect).toBe("manual");
    });

    it.each([
      undefined,
      "Bearer",
      "",
      123,
    ])("rejects token_type %s (finding 6)", async (tokenType) => {
      await expect(
        run(async () => json({ access_token: "unbound", token_type: tokenType })),
      ).rejects.toThrow(/DPoP|token_type/);
    });
    it("accepts case-insensitive DPoP token_type", async () => {
      await expect(
        run(async () => json({ access_token: "bound", token_type: "dPoP" })),
      ).resolves.toBeDefined();
    });

    it("starts nonce-response cancellation without waiting (finding 4)", async () => {
      const cancel = vi.fn(() => new Promise<void>(() => {}));
      let hits = 0;
      const result = await promptly(
        run(async () => {
          if (++hits === 1)
            return new Response(new ReadableStream({ cancel }), {
              status: 400,
              headers: { "DPoP-Nonce": "nonce" },
            });
          expect(cancel).toHaveBeenCalledOnce();
          return token();
        }),
      );
      expect(result).not.toBe("pending");
      expect(hits).toBe(2);
    });

    it.each([200, 400])("caps streamed token body at status %s (finding 3)", async (status) => {
      const cancel = vi.fn();
      const result = await promptly(
        run(
          async () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new Uint8Array(1024 * 1024 + 1));
                },
                cancel,
              }),
              { status },
            ),
        ).then(
          () => "accepted",
          () => "rejected",
        ),
      );
      expect(result).toBe("rejected");
      expect(cancel).toHaveBeenCalledOnce();
    });

    it.each(["transport", "body"])("bounds token %s with a deadline (finding 3)", async (phase) => {
      let signal: AbortSignal | undefined;
      const result = await promptly(
        run(
          async (_url, init) => {
            signal = init?.signal;
            return phase === "transport"
              ? new Promise<Response>(() => {})
              : new Response(new ReadableStream());
          },
          { requestTimeoutMs: 20 },
        ).then(
          () => "accepted",
          () => "rejected",
        ),
      );
      expect(result).toBe("rejected");
      expect(signal?.aborted).toBe(true);
    });

    it.each([
      { error: "invalid_grant", suffix: ": invalid_grant" },
      { error: "SECRET", suffix: "" },
      { error: "invalid_grant\nSECRET", suffix: "" },
      { error: "x".repeat(1000), suffix: "" },
    ])("sanitizes token error $error (finding 8)", async ({ error, suffix }) => {
      await expect(
        run(
          async () =>
            new Response(JSON.stringify({ error, error_description: "SECRET VERIFIER REFRESH" }), {
              status: 400,
            }),
        ),
      ).rejects.toThrow(new Error(`Token request failed (400)${suffix}`));
    });
    it("does not expose raw or malformed token error bodies (finding 8)", async () => {
      await expect(
        run(async () => new Response("SECRET VERIFIER REFRESH", { status: 502 })),
      ).rejects.toThrow(new Error("Token request failed (502)"));
    });
    it("preserves error HTTP status when its body stalls (findings 3 and 8)", async () => {
      await expect(
        run(async () => new Response(new ReadableStream(), { status: 400 }), {
          requestTimeoutMs: 20,
        }),
      ).rejects.toThrow(new Error("Token request failed (400)"));
    });
  });
}

describe("discovery response budgets (finding 3)", () => {
  for (const flow of ["credentials", "code"] as const) {
    function run(fetchImpl: FetchLike) {
      return flow === "credentials"
        ? acquireToken({ ...creds, requestTimeoutMs: 20 }, keyPair, fetchImpl)
        : discoverProvider(issuer, fetchImpl, { requestTimeoutMs: 20 });
    }
    it(`${flow} caps discovery while streaming`, async () => {
      const cancel = vi.fn();
      const result = await promptly(
        run(
          async () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new Uint8Array(1024 * 1024 + 1));
                },
                cancel,
              }),
            ),
        ).then(
          () => "accepted",
          () => "rejected",
        ),
      );
      expect(result).toBe("rejected");
      expect(cancel).toHaveBeenCalledOnce();
    });
    it.each(["transport", "body"])(`${flow} bounds discovery %s with a deadline`, async (phase) => {
      const result = await promptly(
        run(async () =>
          phase === "transport"
            ? new Promise<Response>(() => {})
            : new Response(new ReadableStream()),
        ).then(
          () => "accepted",
          () => "rejected",
        ),
      );
      expect(result).toBe("rejected");
    });
  }
});

describe("resource transport (findings 2 and 4)", () => {
  it.each([
    undefined,
    "follow",
    "manual",
    "error",
  ] as const)("rdfFetchFor never follows redirects, caller policy %s", async (redirect) => {
    const session = { keyPair, accessToken: "access", expiresAt: Date.now() + 60_000 };
    let seen: unknown;
    const fetchImpl: FetchLike = async (_url, init) => {
      seen = init?.redirect;
      return new Response(null, { status: 302 });
    };
    const fetch = rdfFetchFor(session, undefined, fetchImpl);
    const result = fetch("https://pod.example/", redirect ? { redirect } : {});
    if (redirect === "error") await expect(result).rejects.toThrow(/redirect/i);
    else expect((await result).status).toBe(302);
    expect(seen).toBe("manual");
  });
  it("cancels a discarded resource nonce response without waiting", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    let hits = 0;
    const result = await promptly(
      authedFetch(
        { keyPair, accessToken: "access", expiresAt: Infinity },
        undefined,
        "PUT",
        "https://pod.example/",
        { body: "private" },
        async () => {
          if (++hits === 1)
            return new Response(new ReadableStream({ cancel }), {
              status: 401,
              headers: { "DPoP-Nonce": "nonce" },
            });
          expect(cancel).toHaveBeenCalledOnce();
          return new Response("ok");
        },
      ),
    );
    expect(result).not.toBe("pending");
    expect(hits).toBe(2);
  });
});

describe("loopback callback (finding 7)", () => {
  it("completed callbacks also return the constant plain-text error page", async () => {
    const listener = await startLoopbackListener("/callback", "expected");
    try {
      await loopbackFetch(`${listener.redirectUri}?state=expected&code=valid`);
      const response = await loopbackFetch(`${listener.redirectUri}?error=SECRET`);
      expect(response.status).toBe(409);
      expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
      expect(await response.text()).toBe("Login failed. You can close this tab.");
    } finally {
      await listener.close();
    }
  });
  it("returns constant plain text without reflecting OAuth parameters", async () => {
    const listener = await startLoopbackListener("/callback", "expected");
    try {
      const result = listener.waitForCode().catch((error: Error) => error.message);
      const response = await loopbackFetch(
        `${listener.redirectUri}?state=expected&error=${encodeURIComponent("<script>SECRET</script>")}`,
      );
      expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
      expect(await response.text()).toBe("Login failed. You can close this tab.");
      expect(await result).not.toContain("SECRET");
    } finally {
      await listener.close();
    }
  });
  it.each([
    "",
    "state=wrong&",
    "state=expected&state=wrong&",
  ])("ignores uncorrelated callbacks: %s", async (params) => {
    const listener = await startLoopbackListener("/callback", "expected");
    try {
      const result = listener.waitForCode();
      const response = await loopbackFetch(`${listener.redirectUri}?${params}error=access_denied`);
      expect(response.status).toBe(400);
      await loopbackFetch(`${listener.redirectUri}?state=expected&code=valid`);
      await expect(result).resolves.toEqual({ code: "valid", state: "expected" });
    } finally {
      await listener.close();
    }
  });
  it("cliLogin validates error state before completing login", async () => {
    const result = await cliLogin({
      issuer,
      clientId: client.client_id,
      fetchImpl: async (url) => (url.includes(".well-known") ? json(metadata) : token()),
      openBrowser: async (url) => {
        const authorization = new URL(url);
        const callback = authorization.searchParams.get("redirect_uri");
        await loopbackFetch(`${callback}?state=wrong&error=access_denied`);
        await loopbackFetch(
          `${callback}?state=${authorization.searchParams.get("state")}&code=valid`,
        );
      },
    });
    expect(result.accessToken).toBe("access");
  });
});
