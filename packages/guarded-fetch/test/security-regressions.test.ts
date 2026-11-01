// AUTHORED-BY Codex GPT-6.1-Sol
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGuardedFetch,
  createPodScopedFetch,
  isPublicAddress,
  PodScopeError,
  RedirectRefusedError,
  refuseRedirects,
  SsrfError,
} from "../src/index.js";
import {
  createNodeGuardedFetch,
  createPinningDispatcher,
  createValidatingLookup,
} from "../src/node.js";

const BASE = "https://pod.example/public/";
const PUBLIC = [{ address: "8.8.8.8", family: 4 }];
const dnsLookup = async () => PUBLIC;
const wrappers = [
  {
    name: "SSRF",
    error: SsrfError,
    wrap: (fetch: typeof globalThis.fetch, maxRedirects = 5) =>
      createGuardedFetch({ fetch, dnsLookup, maxRedirects }),
  },
  {
    name: "pod scope",
    error: PodScopeError,
    wrap: (fetch: typeof globalThis.fetch, maxRedirects = 5) =>
      createPodScopedFetch(BASE, { fetch, maxRedirects }),
  },
];

afterEach(() => vi.useRealTimers());

for (const { name, error, wrap } of wrappers) {
  describe(`${name}: captured redirect modes`, () => {
    for (const mode of ["manual", "error"] as const) {
      for (const override of ["absent", "undefined", "getter"] as const) {
        it(`inherits Request ${mode} mode with ${override} redirect in a body override`, async () => {
          const transport = vi.fn<typeof fetch>(
            async (): Promise<Response> =>
              transport.mock.calls.length === 1
                ? new Response("redirect body", { status: 307, headers: { location: "next" } })
                : new Response("mutation replayed"),
          );
          const redirect = vi.fn(() => undefined);
          const init: RequestInit = { body: "private override" };
          if (override === "undefined") init.redirect = undefined;
          if (override === "getter")
            Object.defineProperty(init, "redirect", { enumerable: true, get: redirect });
          const request = new Request(`${BASE}item`, {
            method: "PUT",
            body: "original",
            headers: { authorization: "Bearer secret" },
            redirect: mode,
          });
          const pending = wrap(transport)(request, init);
          if (mode === "manual") {
            const response = await pending;
            expect(response.status).toBe(307);
            expect(await response.text()).toBe("redirect body");
          } else await expect(pending).rejects.toBeInstanceOf(error);
          expect(transport).toHaveBeenCalledTimes(1);
          expect(transport.mock.calls[0]?.[1]?.body).toBe("private override");
          expect(new Headers(transport.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
            "Bearer secret",
          );
          expect(redirect).toHaveBeenCalledTimes(override === "getter" ? 1 : 0);
        });
      }
    }
    it("leaves an unfollowable redirect body readable", async () => {
      const response = await wrap(async () => new Response("no location", { status: 302 }))(
        `${BASE}item`,
      );
      expect(await response.text()).toBe("no location");
    });
    for (const status of [301, 302, 303, 307, 308]) {
      for (const source of ["init", "Request"] as const) {
        it(`returns ${status} unfollowed in manual mode from ${source}`, async () => {
          const transport = vi.fn(
            async (): Promise<Response> =>
              transport.mock.calls.length === 1
                ? new Response("redirect body", {
                    status,
                    headers: { location: "/private/secret" },
                  })
                : new Response("followed"),
          );
          const f = wrap(transport, 0);
          const response = await (source === "init"
            ? f(`${BASE}item`, { redirect: "manual" })
            : f(new Request(`${BASE}item`, { redirect: "manual" })));
          expect(response.status).toBe(status);
          expect(await response.text()).toBe("redirect body");
          expect(transport).toHaveBeenCalledTimes(1);
        });
      }
    }
    for (const mode of [undefined, "follow"] as const) {
      it(`follows with revalidation for ${String(mode)}`, async () => {
        const transport = vi.fn(
          async (): Promise<Response> =>
            transport.mock.calls.length === 1
              ? new Response(null, { status: 307, headers: { location: "next" } })
              : new Response("ok"),
        );
        expect(await (await wrap(transport)(`${BASE}item`, { redirect: mode })).text()).toBe("ok");
        expect(transport).toHaveBeenCalledTimes(2);
      });
    }
    for (const location of [undefined, "next"]) {
      it(`rejects error mode even with Location=${location}`, async () => {
        const transport = vi.fn(
          async (): Promise<Response> =>
            transport.mock.calls.length === 1
              ? new Response(null, { status: 302, headers: location ? { location } : {} })
              : new Response("followed"),
        );
        await expect(
          wrap(transport)(new Request(`${BASE}item`, { redirect: "error" })),
        ).rejects.toBeInstanceOf(error);
        expect(transport).toHaveBeenCalledTimes(1);
      });
    }
    it("uses the captured init override rather than rereading a redirect getter", async () => {
      const transport = vi.fn(
        async (): Promise<Response> =>
          transport.mock.calls.length === 1
            ? new Response(null, { status: 302, headers: { location: "next" } })
            : new Response("followed"),
      );
      const redirect = vi.fn().mockReturnValueOnce("manual").mockReturnValue("follow");
      const response = await wrap(transport)(new Request(`${BASE}item`, { redirect: "follow" }), {
        get redirect() {
          return redirect();
        },
      });
      expect(response.status).toBe(302);
      expect(redirect).toHaveBeenCalledTimes(1);
      expect(transport).toHaveBeenCalledTimes(1);
    });
  });

  describe(`${name}: discarded redirect cleanup`, () => {
    for (const [label, location, maxRedirects, redirect] of [
      ["malformed Location", "https://alice:password@ho st/x?code=secret#token", 5, "follow"],
      [
        "scope/private target",
        name === "SSRF" ? "https://10.0.0.1/x" : "/private/secret",
        5,
        "follow",
      ],
      ["scheme downgrade", "http://127.0.0.1/x", 5, "follow"],
      ["too many redirects", "next", 0, "follow"],
      ["redirect loop", `${BASE}item`, 5, "follow"],
      ["error mode", "next", 5, "error"],
      ...(name === "pod scope"
        ? ([["scheme relative", "//pod.example/public/next", 5, "follow"]] as const)
        : []),
    ] as const) {
      it(`cancels and aborts on ${label} without waiting for cancel`, async () => {
        vi.useFakeTimers();
        const cancel = vi.fn(() => new Promise<void>(() => {}));
        let signal: AbortSignal | null | undefined;
        const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          signal = init?.signal;
          const body = new ReadableStream<Uint8Array>({ cancel });
          return new Response(body, { status: 307, headers: { location } });
        });
        let outcome: unknown;
        const pending = wrap(transport, maxRedirects)(`${BASE}item`, { redirect }).then(
          () => {
            outcome = "resolved";
          },
          (e: unknown) => {
            outcome = e;
          },
        );
        await vi.advanceTimersByTimeAsync(1);
        expect(outcome).toBeInstanceOf(error);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(signal?.aborted).toBe(true);
        expect(transport).toHaveBeenCalledTimes(1);
        await pending;
      });
    }
  });
}

describe("guard composition", () => {
  for (const location of ["/private/secret", "https://elsewhere.example/public/item"]) {
    it(`scope over SSRF guard refuses ${location} before credentials or body reach it`, async () => {
      const transport = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
          transport.mock.calls.length === 1
            ? new Response(null, { status: 307, headers: { location } })
            : new Response("leaked"),
      );
      const f = createPodScopedFetch(BASE, {
        fetch: createGuardedFetch({ fetch: transport, dnsLookup }),
      });
      await expect(
        f(`${BASE}item`, {
          method: "PUT",
          headers: { authorization: "Bearer secret" },
          body: "private bytes",
        }),
      ).rejects.toBeInstanceOf(PodScopeError);
      expect(transport).toHaveBeenCalledTimes(1);
      expect(transport.mock.calls[0]?.[0]).toBe(`${BASE}item`);
      expect(new Headers(transport.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
        "Bearer secret",
      );
      expect(transport.mock.calls[0]?.[1]?.body).toBe("private bytes");
    });
  }
  it("refuseRedirects around a guarded fetch sees and refuses the first redirect", async () => {
    const transport = vi.fn(
      async (): Promise<Response> =>
        transport.mock.calls.length === 1
          ? new Response(null, { status: 302, headers: { location: "next" } })
          : new Response("followed"),
    );
    await expect(
      refuseRedirects(createGuardedFetch({ fetch: transport, dnsLookup }))(`${BASE}item`),
    ).rejects.toBeInstanceOf(RedirectRefusedError);
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe("manual responses retain guard limits", () => {
  for (const declared of [false, true]) {
    it(`caps a manual redirect body (${declared ? "declared" : "streamed"})`, async () => {
      const fetch = vi.fn(
        async () =>
          new Response("oversized", {
            status: 307,
            headers: { location: "next", ...(declared ? { "content-length": "999" } : {}) },
          }),
      );
      const f = createGuardedFetch({ fetch, dnsLookup, maxBytes: 2 });
      await expect(f(`${BASE}item`, { redirect: "manual" })).rejects.toBeInstanceOf(SsrfError);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  }
  it("times out a stalled manual redirect body even when the injected stream ignores abort", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetch = vi.fn(
      async () =>
        new Response(new ReadableStream({ cancel }), {
          status: 307,
          headers: { location: "next" },
        }),
    );
    let outcome: unknown;
    const pending = createGuardedFetch({ fetch, dnsLookup, timeoutMs: 10 })(`${BASE}item`, {
      redirect: "manual",
    }).catch((e: unknown) => {
      outcome = e;
    });
    await vi.advanceTimersByTimeAsync(11);
    expect(outcome).toBeInstanceOf(SsrfError);
    expect(String(outcome)).toMatch(/timed out/);
    expect(cancel).toHaveBeenCalledTimes(1);
    await pending;
  });
});

describe("NAT64 address policy", () => {
  for (const address of [
    "64:ff9b:1::808:808",
    "64:ff9b:1:0:a:0:800:0",
    "64:ff9b:1:ffff:ffff:ffff:808:808",
  ]) {
    it(`blocks the local-use /48 ${address} in classifier, URL guard and connection lookup`, async () => {
      expect(isPublicAddress(address, false)).toBe(false);
      expect(isPublicAddress(address, true)).toBe(false);
      const fetch = vi.fn(async () => new Response("unsafe"));
      await expect(createGuardedFetch({ fetch })(`https://[${address}]/`)).rejects.toBeInstanceOf(
        SsrfError,
      );
      expect(fetch).not.toHaveBeenCalled();
      const lookup = createValidatingLookup(async () => [{ address, family: 6 }], false, false);
      await expect(
        new Promise((resolve, reject) =>
          lookup("pod.example", {}, (err, result) => (err ? reject(err) : resolve(result))),
        ),
      ).rejects.toBeInstanceOf(SsrfError);
    });
  }
  it("retains embedded IPv4 classification for the well-known /96", () => {
    expect(isPublicAddress("64:ff9b::808:808", false)).toBe(true);
    expect(isPublicAddress("64:ff9b::a00:8", false)).toBe(false);
    expect(isPublicAddress("64:ff9b::7f00:1", false)).toBe(false);
    expect(isPublicAddress("64:ff9b::7f00:1", true)).toBe(true);
  });
});

describe("DNS deadlines and cancellation", () => {
  for (const abort of ["deadline", "caller", "already aborted"] as const) {
    it(`rejects a stalled lookup promptly on ${abort} and never starts a late transport`, async () => {
      vi.useFakeTimers();
      let resolveLookup!: (value: typeof PUBLIC) => void;
      const lookup = vi.fn(
        () =>
          new Promise<typeof PUBLIC>((resolve) => {
            resolveLookup = resolve;
          }),
      );
      const fetch = vi.fn(async () => new Response("too late"));
      const cancel = vi.fn(() => new Promise<void>(() => {}));
      const pull = vi.fn();
      const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
      const ac = new AbortController();
      if (abort === "already aborted") ac.abort();
      let outcome: unknown;
      const pending = createGuardedFetch({ fetch, dnsLookup: lookup, timeoutMs: 10 })(BASE, {
        signal: ac.signal,
        method: "POST",
        body,
      }).catch((e: unknown) => {
        outcome = e;
      });
      await vi.advanceTimersByTimeAsync(0);
      if (abort === "caller") ac.abort();
      await vi.advanceTimersByTimeAsync(abort === "deadline" ? 11 : 0);
      expect(outcome).toBeInstanceOf(SsrfError);
      expect(String(outcome)).toMatch(/timed out/);
      resolveLookup?.(PUBLIC);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(pull).not.toHaveBeenCalled();
      expect(body.locked).toBe(false);
      await pending;
    });
  }
  it("shares one deadline across redirects and the next hop's DNS lookup", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://next.example/" } }),
    );
    const lookup = vi.fn(async () => {
      if (lookup.mock.calls.length === 1) {
        await new Promise((resolve) => setTimeout(resolve, 8));
        return PUBLIC;
      }
      return new Promise<typeof PUBLIC>(() => {});
    });
    let outcome: unknown;
    const pending = createGuardedFetch({ fetch, dnsLookup: lookup, timeoutMs: 10 })(BASE).catch(
      (e: unknown) => {
        outcome = e;
      },
    );
    await vi.advanceTimersByTimeAsync(11);
    expect(outcome).toBeInstanceOf(SsrfError);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(1);
    await pending;
  });
});

describe("error URL sanitisation", () => {
  const secretUrl =
    "https://alice:password@pod.example/public/callback?code=oauth-secret#access-token";
  const malformed = "https://alice:password@ho st/callback?code=oauth-secret#access-token";
  it("keeps transport diagnostics while sanitising any URL in them", async () => {
    for (const url of [secretUrl, malformed]) {
      const f = createGuardedFetch({
        dnsLookup,
        fetch: async () => {
          throw new TypeError(`duplex is required for ${url}`, {
            cause: Object.assign(new Error(`transport failed at ${url}`), { secret: "password" }),
          });
        },
      });
      const error = await f(BASE).catch((e: unknown) => e);
      expect(String(error)).toContain("duplex");
      expectSafe(error);
    }
  });
  function expectSafe(error: unknown) {
    expect(error).toBeInstanceOf(Error);
    const seen = new Set<unknown>();
    for (let current = error; current !== undefined; ) {
      expect(seen.has(current)).toBe(false);
      seen.add(current);
      for (const secret of ["alice", "password", "code=", "oauth-secret", "access-token"]) {
        expect(String(current)).not.toContain(secret);
        expect(inspect(current, { depth: null })).not.toContain(secret);
      }
      current = current instanceof Error ? current.cause : undefined;
    }
  }
  it("does not expose the native fetch cause for a secret-bearing malformed referrer", async () => {
    const f = createGuardedFetch({ dnsLookup });
    expectSafe(await f(BASE, { referrer: malformed }).catch((e: unknown) => e));
  });
  it("drops a quoted header value echoed by a header-validation error", async () => {
    const credential = Buffer.from("alice:password-that-is-long-enough-to-wrap").toString("base64");
    const wrapped = `${credential.slice(0, 20)}\n${credential.slice(20)}`;
    const f = createGuardedFetch({
      dnsLookup,
      fetch: async () => {
        throw new TypeError(`Headers.append: "Basic ${wrapped}" is an invalid header value.`);
      },
    });
    const error = await f(BASE).catch((e: unknown) => e);
    expect(String(error)).toContain("invalid header value");
    for (const chunk of [credential.slice(0, 20), credential.slice(20)]) {
      expect(String(error)).not.toContain(chunk);
      expect(inspect(error, { depth: null })).not.toContain(chunk);
    }
  });
  it.each([
    "https:/alice:password@ho st/callback?code=oauth-secret#access-token",
    "https:\\\\alice:password@ho st/callback?code=oauth-secret#access-token",
    "https:\\alice:password@host/callback?code=oauth-secret#access-token",
    "https:alice:password@ho st/callback?code=oauth-secret#access-token",
    "alice:password@ho st/callback?code=oauth-secret#access-token",
    "https: ho st/callback?code=oauth-secret#access-token",
    "/callback?code=oauth-secret#access-token",
  ])("does not expose a malformed referrer spelling %s", async (referrer) => {
    const f = createGuardedFetch({ dnsLookup });
    expectSafe(await f(BASE, { referrer }).catch((e: unknown) => e));
  });
  it("does not expose a raw DNS failure cause", async () => {
    const f = createGuardedFetch({
      dnsLookup: async () => {
        throw new Error(`lookup failed at ${secretUrl}`);
      },
    });
    expectSafe(await f(BASE).catch((e: unknown) => e));
  });
  it("retains sanitised connection refusal diagnostics without retaining a transport cause chain", async () => {
    const refusal = new SsrfError(`non-public address refused for ${secretUrl}`);
    // Connection failures from undici nest the useful refusal under a generic TypeError.
    const cause = new TypeError("fetch failed", { cause: refusal });
    refusal.cause = cause;
    const f = createGuardedFetch({
      dnsLookup,
      fetch: async () => {
        throw cause;
      },
    });
    const error = await f(BASE).catch((e: unknown) => e);
    expect(String(error)).toContain("non-public address refused");
    expectSafe(error);
  });
  it("does not expose a raw timeout cause", async () => {
    const controller = new AbortController();
    const f = createGuardedFetch({
      dnsLookup,
      fetch: async () => {
        controller.abort();
        throw new Error(`aborted at ${secretUrl}`);
      },
    });
    const error = await f(BASE, { signal: controller.signal }).catch((e: unknown) => e);
    expect(String(error)).toContain("timed out");
    expectSafe(error);
  });
  for (const { name, wrap } of wrappers) {
    it(`${name} sanitises malformed URL and malformed Location errors`, async () => {
      const f = wrap(
        async () => new Response(null, { status: 302, headers: { location: malformed } }),
      );
      expectSafe(await f(malformed).catch((e: unknown) => e));
      expectSafe(await f(`${BASE}item?code=oauth-secret#access-token`).catch((e: unknown) => e));
    });
    it(`${name} sanitises redirect rejection URLs`, async () => {
      const f = wrap(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "/private/secret?code=oauth-secret#access-token" },
          }),
        0,
      );
      expectSafe(await f(`${BASE}item?code=oauth-secret#access-token`).catch((e: unknown) => e));
    });
  }
  it("refuseRedirects sanitises message and properties while retaining host/path", async () => {
    const f = refuseRedirects(
      async () => new Response(null, { status: 302, headers: { location: secretUrl } }),
    );
    const error = (await f(secretUrl).catch((e: unknown) => e)) as RedirectRefusedError;
    expectSafe(error);
    expect(error.url).toBe(`${BASE}callback`);
    expect(error.location).toBe(`${BASE}callback`);
    expect(error.message).toContain(`${BASE}callback`);
  });
  it("refuseRedirects sanitises relative Locations and malformed Locations", async () => {
    for (const location of ["../callback?code=oauth-secret#access-token", malformed]) {
      const error = (await refuseRedirects(
        async () => new Response(null, { status: 302, headers: { location } }),
      )(`${BASE}item`).catch((e: unknown) => e)) as RedirectRefusedError;
      expectSafe(error);
      expect(error.location).not.toMatch(/password|oauth-secret|access-token/);
      expect(error.location).toBe(location === malformed ? "(invalid URL)" : "../callback");
    }
  });
  it("sanitises the legacy redirect error constructor", () =>
    expectSafe(new RedirectRefusedError(secretUrl, 302)));
});

describe("numeric option validation at construction", () => {
  for (const value of [null, "10", true]) {
    for (const option of ["maxBytes", "maxRedirects", "timeoutMs"]) {
      it(`rejects non-number ${option}=${value}`, () => {
        expect(() => createGuardedFetch({ [option]: value })).toThrow(TypeError);
      });
    }
  }
  for (const [option, values] of [
    ["maxBytes", [Number.NaN, Infinity, -Infinity, -1, 0.5]],
    ["maxRedirects", [Number.NaN, Infinity, -Infinity, -1, 0.5]],
    ["timeoutMs", [Number.NaN, Infinity, -Infinity, -1, 0]],
  ] as const) {
    for (const value of values) {
      for (const factory of [createGuardedFetch, createNodeGuardedFetch]) {
        it(`${factory.name} rejects ${option}=${value}`, () =>
          expect(() => factory({ [option]: value })).toThrow(TypeError));
      }
      if (option === "maxRedirects")
        it(`pod scope rejects ${option}=${value}`, () =>
          expect(() => createPodScopedFetch(BASE, { maxRedirects: value })).toThrow(TypeError));
    }
  }
  it("accepts zero byte/redirect caps and a positive fractional timeout", () => {
    expect(() =>
      createGuardedFetch({ maxBytes: 0, maxRedirects: 0, timeoutMs: 0.5 }),
    ).not.toThrow();
    expect(() => createPodScopedFetch(BASE, { maxRedirects: 0 })).not.toThrow();
  });
});

describe("bare dispatcher supported options", () => {
  it("rejects inherited guard options too", async () => {
    let dispatcher: ReturnType<typeof createPinningDispatcher> | undefined;
    try {
      expect(() => {
        dispatcher = createPinningDispatcher(Object.create({ timeoutMs: 10 }));
      }).toThrow(TypeError);
    } finally {
      await dispatcher?.close();
    }
  });
  for (const option of [
    "timeoutMs",
    "maxBytes",
    "maxRedirects",
    "requireDnsPinning",
    "allowUnresolvedHosts",
    "hostnameDenylist",
    "allowedContentTypes",
    "enforcePortGate",
  ]) {
    it(`rejects the ignored ${option} option when defined`, async () => {
      let dispatcher: ReturnType<typeof createPinningDispatcher> | undefined;
      try {
        expect(() => {
          dispatcher = createPinningDispatcher({ [option]: option.endsWith("Ms") ? 10 : 0 });
        }).toThrow(TypeError);
      } finally {
        await dispatcher?.close();
      }
    });
  }
  it("accepts supported fields and undefined legacy fields", async () => {
    const dispatcher = createPinningDispatcher({
      allowLoopback: true,
      resolveAll: dnsLookup,
      timeoutMs: undefined,
      maxBytes: undefined,
    });
    await dispatcher.close();
  });
});
