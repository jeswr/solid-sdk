// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCliFetch } from "../src/client-credentials.js";
import { ISSUER, mockCss, POD, TOKEN } from "./fixtures/css.mjs";

const config = {
  podRoot: POD,
  readOnly: true,
  clientId: "fixture-id",
  clientSecret: "fixture-secret",
  oidcIssuer: ISSUER,
};
const failure = "CSS client-credentials login failed; check issuer, endpoint and credentials.";
const encode = (text: string) => new TextEncoder().encode(text);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("authentication response budgets", () => {
  it.each([
    "declared",
    "streamed",
    "dishonest length",
  ])("rejects oversized discovery JSON (%s) without a token request", async (kind) => {
    const cancel = vi.fn();
    const bytes = encode(
      JSON.stringify({
        issuer: ISSUER,
        token_endpoint: TOKEN,
        secret: "fixture-secret".repeat(6000),
      }),
    );
    const raw = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes.subarray(0, 32_768));
              controller.enqueue(bytes.subarray(32_768));
            },
            cancel,
          }),
          {
            headers:
              kind === "streamed"
                ? {}
                : {
                    "content-length": kind === "declared" ? String(bytes.length) : "1",
                  },
          },
        ),
    );
    await expect(createCliFetch(config, raw)).rejects.toThrow(failure);
    expect(raw).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("accepts discovery JSON at the 64 KiB boundary", async () => {
    const css = mockCss();
    const metadata = JSON.stringify({ issuer: ISSUER, token_endpoint: TOKEN });
    const fetch = await createCliFetch(config, async (input, init) => {
      if (new Request(input, init).url.endsWith("openid-configuration"))
        return new Response(metadata.padEnd(64 * 1024, " "));
      return css.fetch(input, init);
    });
    expect((await fetch(`${POD}note`)).ok).toBe(true);
    expect(css.stats.tokens).toBe(1);
  });

  it.each(["token", "nonce retry", "error"])("bounds the %s response body", async (kind) => {
    let attempts = 0;
    const cancel = vi.fn(async () => {
      throw new Error("fixture-secret");
    });
    const raw: typeof fetch = async () => {
      if (++attempts === 1 && kind === "nonce retry")
        return new Response(null, { status: 400, headers: { "DPoP-Nonce": "fixture-nonce" } });
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(64 * 1024 + 1));
          },
          cancel,
        }),
        { status: kind === "error" ? 500 : 200 },
      );
    };
    await expect(createCliFetch({ ...config, tokenUrl: TOKEN }, raw)).rejects.toThrow(failure);
    expect(attempts).toBe(kind === "nonce retry" ? 2 : 1);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    "pending",
    "rejecting",
  ])("bounds endless token bodies with %s cancellation", async (kind) => {
    vi.useFakeTimers();
    const started = Promise.withResolvers<void>();
    const cancel = vi.fn(() =>
      kind === "pending"
        ? new Promise<void>(() => {})
        : Promise.reject(new Error("fixture-secret")),
    );
    let signal!: AbortSignal;
    const login = createCliFetch({ ...config, tokenUrl: TOKEN }, async (_input, init) => {
      signal = init?.signal as AbortSignal;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encode('{"access_token":"fixture-secret'));
          },
          pull() {
            started.resolve();
          },
          cancel,
        }),
      );
    });
    const rejection = expect(login).rejects.toThrow(failure);
    await started.promise;
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("aborts a slow token endpoint at the acquisition deadline", async () => {
    vi.useFakeTimers();
    const started = Promise.withResolvers<void>();
    let signal!: AbortSignal;
    const login = createCliFetch({ ...config, tokenUrl: TOKEN }, async (_input, init) => {
      signal = init?.signal as AbortSignal;
      started.resolve();
      // An injected transport may ignore AbortSignal; callers must still finish.
      return new Promise<Response>(() => {});
    });
    const rejection = expect(login).rejects.toThrow(failure);
    await started.promise;
    await vi.advanceTimersByTimeAsync(29_999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(signal.aborted).toBe(true);
  });

  it("uses one deadline across discovery and the token nonce retry", async () => {
    const css = mockCss();
    vi.useFakeTimers();
    const discovered = Promise.withResolvers<void>();
    const releaseDiscovery = Promise.withResolvers<void>();
    const challenged = Promise.withResolvers<void>();
    const releaseChallenge = Promise.withResolvers<void>();
    const retryStarted = Promise.withResolvers<void>();
    let attempts = 0;
    const login = createCliFetch(config, async (input, init) => {
      const request = new Request(input, init);
      if (request.url !== TOKEN) {
        discovered.resolve();
        await releaseDiscovery.promise;
        return css.fetch(input, init);
      }
      if (++attempts === 1) {
        challenged.resolve();
        await releaseChallenge.promise;
        return new Response(null, { status: 400, headers: { "DPoP-Nonce": "fixture-nonce" } });
      }
      retryStarted.resolve();
      return new Promise<Response>(() => {});
    });
    const rejection = expect(login).rejects.toThrow(failure);
    await discovered.promise;
    await vi.advanceTimersByTimeAsync(10_000);
    releaseDiscovery.resolve();
    await challenged.promise;
    await vi.advanceTimersByTimeAsync(10_000);
    releaseChallenge.resolve();
    await retryStarted.promise;
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(attempts).toBe(2);
  });

  it("clears a timed-out shared renewal so later authenticated calls can retry", async () => {
    const css = mockCss();
    const renewalStarted = Promise.withResolvers<void>();
    const late = Promise.withResolvers<Response>();
    const cancel = vi.fn();
    let attempts = 0;
    let timedOutSignal!: AbortSignal;
    const fetch = await createCliFetch(config, async (input, init) => {
      if (new Request(input, init).url === TOKEN && ++attempts === 2) {
        timedOutSignal = init?.signal as AbortSignal;
        renewalStarted.resolve();
        return late.promise;
      }
      return css.fetch(input, init);
    });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    const first = fetch(`${POD}note`);
    const second = fetch(`${POD}note`);
    const rejections = Promise.all([
      expect(first).rejects.toThrow(failure),
      expect(second).rejects.toThrow(failure),
    ]);
    await renewalStarted.promise;
    await vi.advanceTimersByTimeAsync(30_000);
    await rejections;
    expect(timedOutSignal.aborted).toBe(true);
    expect(attempts).toBe(2);
    expect(css.stats.reads).toBe(0);
    expect((await fetch(`${POD}note`)).ok).toBe(true);
    expect(attempts).toBe(3);
    // A late response from the abandoned attempt must be cancelled, not cached.
    late.resolve(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect((await fetch(`${POD}note`)).ok).toBe(true);
    expect(css.stats).toMatchObject({ tokens: 2, reads: 2 });
    expect(attempts).toBe(3);
  });
});
