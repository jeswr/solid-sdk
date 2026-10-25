// AUTHORED-BY Codex GPT-6.1-Sol
import { IncomingMessage, type ServerResponse } from "node:http";
import { Socket } from "node:net";
import { Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { handler } from "./handler.js";
import { nodeHandler } from "./node-handler.js";

vi.mock("./handler.js", () => ({ handler: vi.fn() }));

class ResponseFixture extends Writable {
  headers = new Map<string, string | string[]>();
  headersSent = false;
  status = 0;
  chunks: Buffer[] = [];
  setHeader(name: string, value: string | string[]) {
    this.headers.set(name, value);
  }
  writeHead(status: number) {
    this.status = status;
    this.headersSent = true;
  }
  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }
}

function requestFixture(method = "GET", body?: string) {
  // Unconnected socket: no real HTTP service, accounts or network.
  const request = new IncomingMessage(new Socket());
  request.method = method;
  request.url = "/mcp?session=fixture";
  request.headers = { host: "localhost:3000" };
  request.rawHeaders = [
    "Host",
    "localhost:3000",
    "Origin",
    "https://client.example",
    "Content-Type",
    "application/json",
  ];
  if (body) request.push(Buffer.from(body));
  request.push(null);
  return request;
}

async function invoke(request: IncomingMessage, response = new ResponseFixture()) {
  await nodeHandler(request, response as unknown as ServerResponse);
  return response;
}

describe("Node/Web scaffold adapter", () => {
  it("preserves request method, URL, headers and streamed body", async () => {
    vi.mocked(handler).mockImplementationOnce(async (request) => {
      expect(request.method).toBe("POST");
      expect(request.url).toBe("http://localhost:3000/mcp?session=fixture");
      expect(request.headers.get("origin")).toBe("https://client.example");
      expect(await request.json()).toEqual({ fixture: true });
      return new Response("created", {
        status: 201,
        headers: { "x-fixture": "yes", "set-cookie": "a=1" },
      });
    });
    const response = await invoke(requestFixture("POST", '{"fixture":true}'));
    expect(response.status).toBe(201);
    expect(response.headers.get("x-fixture")).toBe("yes");
    expect(response.headers.get("set-cookie")).toEqual(["a=1"]);
    expect(Buffer.concat(response.chunks).toString()).toBe("created");
  });

  it("streams a response before the producer closes it", async () => {
    let producer: ReadableStreamDefaultController<Uint8Array> | undefined;
    const firstChunk = Promise.withResolvers<void>();
    const response = new ResponseFixture();
    const originalWrite = response._write.bind(response);
    response._write = (chunk, encoding, callback) => {
      originalWrite(chunk, encoding, callback);
      firstChunk.resolve();
    };
    vi.mocked(handler).mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            producer = controller;
          },
        }),
      ),
    );
    const pending = invoke(requestFixture(), response);
    producer?.enqueue(new TextEncoder().encode("first"));
    await firstChunk.promise;
    expect(Buffer.concat(response.chunks).toString()).toBe("first");
    producer?.close();
    await pending;
  });

  it.each(["GET", "HEAD"])("does not attach a request body for %s", async (method) => {
    vi.mocked(handler).mockImplementationOnce(async (request) => {
      expect(request.body).toBeNull();
      return method === "HEAD" ? new Response("ignored") : new Response(null, { status: 204 });
    });
    const response = await invoke(requestFixture(method));
    expect(response.chunks).toEqual([]);
  });

  it("closes a failed response stream after headers have been sent", async () => {
    vi.mocked(handler).mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("fixture stream failure"));
          },
        }),
      ),
    );
    const response = await invoke(requestFixture());
    expect(response.status).toBe(200);
    expect(response.destroyed).toBe(true);
  });

  it("returns a generic error when the Web handler fails", async () => {
    vi.mocked(handler).mockRejectedValueOnce(new Error("fixture failure"));
    const response = await invoke(requestFixture());
    expect(response.status).toBe(500);
    expect(Buffer.concat(response.chunks).toString()).toBe("Internal server error\n");
  });
  it.each(["request", "response"])("aborts the handler when the %s disconnects", async (source) => {
    const started = Promise.withResolvers<void>();
    let signal: AbortSignal | undefined;
    vi.mocked(handler).mockImplementationOnce(async (request) => {
      signal = request.signal;
      started.resolve();
      await new Promise<void>((resolve) =>
        request.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      return new Response(null, { status: 204 });
    });
    const request = requestFixture();
    const response = new ResponseFixture();
    const pending = invoke(request, response);
    await started.promise;
    if (source === "request") request.emit("aborted");
    else response.destroy();
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(request.listenerCount("aborted")).toBe(0);
    expect(response.listenerCount("close")).toBe(0);
    expect(response.status).toBe(source === "request" ? 204 : 0);
  });

  it("removes disconnect listeners after a successful response", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(handler).mockImplementationOnce(async (request) => {
      signal = request.signal;
      return new Response(null, { status: 204 });
    });
    const request = requestFixture();
    const response = await invoke(request);
    expect(request.listenerCount("aborted")).toBe(0);
    expect(response.listenerCount("close")).toBe(0);
    request.emit("aborted");
    expect(signal?.aborted).toBe(false);
  });

  it("cancels the returned body if the response was already disconnected", async () => {
    const cancel = vi.fn();
    vi.mocked(handler).mockImplementationOnce(async (request) => {
      expect(request.signal.aborted).toBe(true);
      return new Response(new ReadableStream({ cancel }));
    });
    const response = new ResponseFixture();
    response.destroy();
    await invoke(requestFixture(), response);
    expect(response.status).toBe(0);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
