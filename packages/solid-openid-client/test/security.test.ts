// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { createSolidOidcClient } from "../src/index.js";
import { createMockOp } from "./mockOp.js";

async function login(resourceFetch?: typeof globalThis.fetch, maxReplayBodyBytes = 8) {
  const issuer = "https://op.example/";
  const clientId = "https://app.example/client.jsonld";
  const redirectUri = "https://app.example/callback";
  const op = await createMockOp({ issuer, clientId, webId: "https://alice.example/#me" });
  const client = await createSolidOidcClient({
    issuer,
    clientId,
    redirectUri,
    maxReplayBodyBytes,
    fetch: (input, init) =>
      String(input).includes("/resource") && resourceFetch
        ? resourceFetch(input, init)
        : op.fetch(input, init),
  });
  const { url, state } = await client.authorizationUrl();
  const callback = op.authorize(url);
  await client.handleCallback({ params: { code: callback.code, state: callback.state } }, state);
  return { client, op };
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

describe("credentialed resource redirects (finding 2)", () => {
  it.each([
    "follow",
    "manual",
    "error",
  ] as const)("forces manual transport for %s", async (redirect) => {
    const transport = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 307 }),
    );
    const { client } = await login(transport);
    const result = client.fetch(new Request("https://op.example/resource", { redirect }));
    if (redirect === "error") await expect(result).rejects.toThrow(/redirect/i);
    else expect((await result).status).toBe(307);
    expect(transport.mock.calls[0]?.[1]?.redirect).toBe("manual");
    expect(transport).toHaveBeenCalledOnce();
  });
});

it("nonce retries start cancellation without awaiting it (finding 4)", async () => {
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  let hits = 0;
  const { client } = await login(async () => {
    if (++hits === 1)
      return new Response(new ReadableStream({ cancel }), {
        status: 401,
        headers: { "DPoP-Nonce": "nonce" },
      });
    expect(cancel).toHaveBeenCalledOnce();
    return new Response("ok");
  });
  expect(await promptly(client.fetch("https://op.example/resource"))).not.toBe("pending");
  expect(hits).toBe(2);
});

describe("bounded upload cancellation (finding 5)", () => {
  it.each([
    "Request",
    "init",
  ])("rejects unfinished oversized %s without awaiting cancel", async (input) => {
    const transport = vi.fn(async () => new Response("ok"));
    const { client } = await login(transport);
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(9));
      },
      cancel,
    });
    const init = { method: "PUT", body, duplex: "half" };
    const request = new Request("https://op.example/resource", init);
    const result = input === "Request" ? client.fetch(request) : client.fetch(request.url, init);
    expect(
      await promptly(
        result.then(
          () => "accepted",
          () => "rejected",
        ),
      ),
    ).toBe("rejected");
    expect(cancel).toHaveBeenCalledOnce();
    expect(transport).not.toHaveBeenCalled();
    if (input === "Request") expect(request.bodyUsed).toBe(true);
  });
  it.each(["Request", "init"])("aborts unfinished %s without awaiting cancel", async (input) => {
    const { client } = await login();
    const controller = new AbortController();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ cancel });
    const init = { method: "PUT", body, signal: controller.signal, duplex: "half" };
    const request = new Request("https://op.example/resource", init);
    const result = input === "Request" ? client.fetch(request) : client.fetch(request.url, init);
    controller.abort(new Error("stop upload"));
    expect(
      await promptly(
        result.then(
          () => "accepted",
          (err: Error) => err.message,
        ),
      ),
    ).toBe("stop upload");
    expect(cancel).toHaveBeenCalledOnce();
  });
});

it("init.headers replaces Request headers and removes cookies (finding 9)", async () => {
  const { client, op } = await login();
  await client.fetch(
    new Request("https://op.example/resource", {
      headers: { cookie: "APP_SECRET", "x-old": "old" },
    }),
    { headers: { "x-new": "new" } },
  );
  const headers = op.captured.at(-1)?.headers;
  expect(headers?.cookie).toBeUndefined();
  expect(headers?.["x-old"]).toBeUndefined();
  expect(headers?.["x-new"]).toBe("new");
  expect(headers?.authorization).toMatch(/^DPoP /);
  expect(headers?.dpop).toBeTruthy();
});

describe("OIDC response budgets (finding 3)", () => {
  it("propagates a raised deadline to upstream discovery and token requests", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      const issuer = "https://op.example/";
      const clientId = "https://app.example/client.jsonld";
      const op = await createMockOp({ issuer, clientId, webId: "https://alice.example/#me" });
      const client = await createSolidOidcClient({
        issuer,
        clientId,
        redirectUri: "https://app.example/callback",
        fetch: op.fetch,
        requestTimeoutMs: 60_000,
      });
      const { url, state } = await client.authorizationUrl();
      const callback = op.authorize(url);
      await client.handleCallback(
        { params: { code: callback.code, state: callback.state } },
        state,
      );
      expect(timeout).toHaveBeenCalledWith(60_000);
      expect(timeout.mock.calls.every(([milliseconds]) => milliseconds === 60_000)).toBe(true);
    } finally {
      timeout.mockRestore();
    }
  });
  for (const flow of ["discovery", "code", "refresh"] as const) {
    it.each([
      "overflow",
      "transport",
      "body",
    ])(`${flow} bounds %s before upstream parsing`, async (phase) => {
      const issuer = "https://op.example/";
      const clientId = "https://app.example/client.jsonld";
      const op = await createMockOp({ issuer, clientId, webId: "https://alice.example/#me" });
      const cancel = vi.fn(() => new Promise<void>(() => {}));
      let hostile = flow === "discovery";
      const options = {
        issuer,
        clientId,
        redirectUri: "https://app.example/callback",
        requestTimeoutMs: 20,
        fetch: async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
          if (hostile) {
            if (phase === "transport") return new Promise<Response>(() => {});
            return new Response(
              new ReadableStream({
                start(controller) {
                  if (phase === "overflow") controller.enqueue(new Uint8Array(1024 * 1024 + 1));
                },
                cancel,
              }),
            );
          }
          return op.fetch(input, init);
        },
      };
      async function run() {
        const client = await createSolidOidcClient(options);
        if (flow === "discovery") return;
        const { url, state } = await client.authorizationUrl();
        const callback = op.authorize(url);
        if (flow === "code") hostile = true;
        await client.handleCallback(
          { params: { code: callback.code, state: callback.state } },
          state,
        );
        if (flow === "refresh") {
          hostile = true;
          await client.refresh();
        }
      }
      expect(
        await promptly(
          run().then(
            () => "accepted",
            () => "rejected",
          ),
        ),
      ).toBe("rejected");
      if (phase !== "transport") expect(cancel).toHaveBeenCalledOnce();
    });
  }
});
