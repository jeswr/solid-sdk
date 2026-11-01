// AUTHORED-BY Codex GPT-6.1-Sol
import { type AddressInfo, createServer } from "node:http";
import { Request as UndiciRequest } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNodeGuardedFetch } from "../src/node.js";

const received: Array<{ method: string | undefined; body: string }> = [];
const server = createServer((request, response) => {
  void (async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    received.push({ method: request.method, body });
    response.end(body);
  })().catch((error: Error) => response.destroy(error));
});
let target: string;

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  target = `http://localhost:${(server.address() as AddressInfo).port}/upload`;
});

afterAll(async () => {
  server.closeAllConnections();
  if (server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

function replacementStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("replacement upload"));
      controller.close();
    },
  });
}

for (const [name, RequestImpl] of Object.entries({ native: Request, undici: UndiciRequest })) {
  describe(`createNodeGuardedFetch: ${name} Request over a real undici connection`, () => {
    it.each([
      "fresh",
      "consumed",
      "locked",
    ] as const)("uploads a stream override of a %s POST with inherited duplex half", async (state) => {
      const input = new RequestImpl(target, {
        method: "POST",
        body: "original",
      }) as unknown as Request;
      if (state === "consumed") await input.text();
      const reader = state === "locked" ? input.body?.getReader() : undefined;
      const wasUsed = input.bodyUsed;
      const wasLocked = input.body?.locked;
      const before = received.length;
      const guarded = createNodeGuardedFetch({
        allowLoopback: true,
        timeoutMs: 1_000,
        resolveAll: async () => [{ address: "127.0.0.1", family: 4 }],
      });
      try {
        const response = await guarded(input, { body: replacementStream() });
        expect(await response.text()).toBe("replacement upload");
        expect(received.slice(before)).toEqual([{ method: "POST", body: "replacement upload" }]);
        expect(input.bodyUsed).toBe(wasUsed);
        expect(input.body?.locked).toBe(wasLocked);
      } finally {
        reader?.releaseLock();
      }
      if (state !== "consumed") expect(await input.text()).toBe("original");
    });

    it.each([
      false,
      true,
    ])("matches main for a body-less POST stream override (explicit duplex %s)", async (explicitDuplex) => {
      const input = new RequestImpl(target, { method: "POST" }) as unknown as Request;
      const before = received.length;
      const guarded = createNodeGuardedFetch({
        allowLoopback: true,
        timeoutMs: 1_000,
        resolveAll: async () => [{ address: "127.0.0.1", family: 4 }],
      });
      const pending = guarded(input, {
        body: replacementStream(),
        ...(explicitDuplex ? { duplex: "half" } : {}),
      } as RequestInit);
      if (explicitDuplex) {
        expect(await (await pending).text()).toBe("replacement upload");
        expect(received.slice(before)).toEqual([{ method: "POST", body: "replacement upload" }]);
      } else {
        await expect(pending).rejects.toThrow(/duplex/i);
        expect(received).toHaveLength(before);
      }
      expect(input.body).toBeNull();
      expect(input.bodyUsed).toBe(false);
    });
  });
}
