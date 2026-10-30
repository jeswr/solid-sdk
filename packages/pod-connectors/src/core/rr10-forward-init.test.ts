// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { githubAdapter } from "../github/adapter.js";
import { createFixtureRecorder } from "./fixture-recorder.js";
import { createSourceAuth } from "./import-runner.js";

const TARGET = "https://api.github.com/user";
const wrappers = {
  "import runner": (transport: typeof fetch) =>
    createSourceAuth(
      "github",
      githubAdapter,
      { accessToken: "synthetic-token", tokenType: "Bearer" },
      transport,
    ).fetch,
  "fixture recorder": (transport: typeof fetch) =>
    createFixtureRecorder({
      fetch: transport,
      routes: [{ url: TARGET, safeFields: ["total"] }],
    }).fetch,
};

it.each(["inherited", "hidden"])("recorder honours %s method, body and headers", async (kind) => {
  const values = { method: "PUT", body: "replacement", headers: { "x-option": "keep" } };
  const init =
    kind === "inherited"
      ? Object.create(values)
      : Object.defineProperties(
          {},
          Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])),
        );
  await wrappers["fixture recorder"](async (input, init) => {
    const request = new Request(input, init);
    expect(request.method).toBe("PUT");
    expect(request.headers.get("x-option")).toBe("keep");
    expect(await request.text()).toBe("replacement");
    return Response.json({ total: 1 });
  })(new Request(TARGET), init);
});

it.each([
  "inherited",
  "hidden",
])("source-auth preserves %s headers while ignoring other non-spread options", async (kind) => {
  const values = {
    headers: { "x-option": "keep" },
    method: "PUT",
    body: "discard",
    signal: AbortSignal.abort(),
  };
  const init =
    kind === "inherited"
      ? Object.create(values)
      : Object.defineProperties(
          {},
          Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])),
        );
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    expect(request.headers.get("x-option")).toBe("keep");
    expect(request.headers.get("authorization")).toBe("Bearer synthetic-token");
    expect(request.method).toBe("GET");
    expect(request.signal.aborted).toBe(false);
    expect(await request.text()).toBe("");
    return Response.json({ total: 1 });
  });
  await wrappers["import runner"](transport)(new Request(TARGET), init);
  expect(transport).toHaveBeenCalledOnce();
});

it("source-auth keeps main's two enumerable header reads and uses the first value", async () => {
  const headers = vi
    .fn()
    .mockReturnValueOnce({ "x-first": "keep" })
    .mockReturnValue({ "x-second": "discard" });
  await wrappers["import runner"](async (input, init) => {
    const request = new Request(input, init);
    expect(request.headers.get("x-first")).toBe("keep");
    expect(request.headers.has("x-second")).toBe(false);
    return Response.json({ total: 1 });
  })(new Request(TARGET), {
    get headers() {
      return headers();
    },
  });
  expect(headers).toHaveBeenCalledTimes(2);
});

for (const [name, wrap] of Object.entries(wrappers)) {
  it(`${name}: reads a replacement stream accessor only once through composed wrappers`, async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("replacement"));
        controller.close();
      },
    });
    const getBody = vi.fn().mockReturnValueOnce(stream).mockReturnValue(undefined);
    const input = new Request(TARGET, { method: "POST", body: "original" });
    await wrap(async (input, init) => {
      expect(await new Request(input, init).text()).toBe("replacement");
      return Response.json({ total: 1 });
    })(input, {
      method: "PUT",
      duplex: "half",
      get body() {
        return getBody();
      },
    } as RequestInit);
    expect(getBody).toHaveBeenCalledOnce();
    expect(await input.text()).toBe("original");
  });
}

for (const [name, wrap] of Object.entries(wrappers)) {
  describe(`${name}: explicit Request init`, () => {
    it("rejects an already-aborted init.signal before the transport sends", async () => {
      const controller = new AbortController();
      const reason = new DOMException("Per-request cancellation", "AbortError");
      controller.abort(reason);
      const send = vi.fn();
      const transport = vi.fn<typeof fetch>(async (input, init) => {
        // Injected transports may use init for cancellation, as the CLI wrapper does.
        init?.signal?.throwIfAborted();
        send(new Request(input, init));
        return Response.json({ total: 1 });
      });
      const request = new Request(TARGET);

      await expect(wrap(transport)(request, { signal: controller.signal })).rejects.toBe(reason);

      expect(transport).toHaveBeenCalledOnce();
      expect(transport.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
      expect(send).not.toHaveBeenCalled();
      expect(request.signal.aborted).toBe(false);
    });

    it.each([
      "fresh",
      "consumed",
      "locked",
    ])("forwards method, headers and a replacement stream for a %s Request body", async (state) => {
      const request = new Request(TARGET, {
        method: "POST",
        headers: { "x-original": "discard" },
        body: "original",
      });
      if (state === "consumed") await request.text();
      const reader = state === "locked" ? request.body?.getReader() : undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("replacement payload"));
          controller.close();
        },
      });
      const init: RequestInit = {
        method: "PUT",
        headers: { "x-explicit": "keep" },
        body,
        duplex: "half",
        signal: new AbortController().signal,
      } as RequestInit;
      const sent: { url: string; method: string; headers: Headers; body: string }[] = [];
      const transport = vi.fn<typeof fetch>(async (input, options) => {
        const effective = new Request(input, options);
        sent.push({
          url: effective.url,
          method: effective.method,
          headers: effective.headers,
          body: await effective.text(),
        });
        return Response.json({ total: 1 });
      });
      try {
        await wrap(transport)(request, init);

        expect(transport).toHaveBeenCalledOnce();
        expect(transport.mock.calls[0]?.[1]).toMatchObject({
          method: "PUT",
          body,
          duplex: "half",
          signal: init.signal,
        });
        expect(transport.mock.calls[0]?.[1]?.body).toBe(body);
        expect(transport.mock.calls[0]?.[1]?.signal).toBe(init.signal);
        expect(new Headers(transport.mock.calls[0]?.[1]?.headers).get("x-explicit")).toBe("keep");
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({
          url: TARGET,
          method: "PUT",
          body: "replacement payload",
        });
        expect(sent[0]?.headers.get("x-explicit")).toBe("keep");
        expect(sent[0]?.headers.has("x-original")).toBe(false);
        expect(request.bodyUsed).toBe(state === "consumed");
      } finally {
        reader?.releaseLock();
      }
      if (state !== "consumed") expect(await request.text()).toBe("original");
    });

    it.each([true, false])("validates the real Request target (allowed: %s)", async (allowed) => {
      const foreign = "https://foreign.example/steal";
      const request = new Request(allowed ? TARGET : foreign);
      Object.defineProperty(request, "url", { value: allowed ? foreign : TARGET });
      const sent: string[] = [];
      const transport = vi.fn<typeof fetch>(async (input, init) => {
        sent.push(new Request(input, init).url);
        return Response.json({ total: 1 });
      });

      if (allowed) {
        await wrap(transport)(request);
        expect(transport).toHaveBeenCalledOnce();
        expect(sent).toEqual([TARGET]);
      } else {
        await expect(wrap(transport)(request)).rejects.toThrow(/outside|no configured/);
        expect(transport).not.toHaveBeenCalled();
        expect(sent).toEqual([]);
      }
    });
  });
}
