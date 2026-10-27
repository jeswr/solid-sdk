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
