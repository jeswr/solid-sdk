// AUTHORED-BY Codex GPT-6.1-Sol
import { createServer, IncomingMessage, type ServerResponse } from "node:http";
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

function requestFixture(method = "GET", body?: string, complete = true) {
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
  if (complete) request.push(null);
  request.complete = complete;
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
    expect(response.headers.get("connection")).toBeUndefined();
  });

  it.each([
    "response",
    "empty response",
    "handler error",
    "locked body",
  ])("finalizes an unread request after a %s", async (mode) => {
    const adapted: {
      body?: ReadableStream<Uint8Array>;
      reader?: ReadableStreamDefaultReader<Uint8Array>;
    } = {};
    vi.mocked(handler).mockImplementationOnce(async (request) => {
      if (!request.body) throw new Error("missing fixture body");
      adapted.body = request.body;
      if (mode === "locked body") adapted.reader = request.body.getReader();
      if (mode === "handler error") throw new Error("fixture failure");
      return new Response(mode === "empty response" ? null : "done");
    });
    const request = requestFixture("POST", "partial body", false);
    const response = await invoke(request);
    expect(response.writableFinished).toBe(true);
    expect(response.headers.get("connection")).toBe("close");
    expect(request.destroyed).toBe(true);
    if (adapted.reader) {
      // Already buffered data may be delivered, but the destroyed source must terminate.
      await adapted.reader.read();
      await expect(adapted.reader.read()).rejects.toThrow();
      adapted.reader.releaseLock();
    } else {
      expect((await adapted.body?.getReader().read())?.done).toBe(true);
    }
  });

  it("closes an unread POST connection with a pipelined second request without hanging", async () => {
    vi.mocked(handler).mockResolvedValue(new Response("done"));
    const server = createServer((request, response) => void nodeHandler(request, response));
    const socket = new Socket();
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("missing fixture port");
      const chunks: Buffer[] = [];
      socket.setTimeout(2000, () => socket.destroy(new Error("fixture connection stalled")));
      socket.on("data", (chunk) => chunks.push(chunk));
      const closed = new Promise<void>((resolve, reject) => {
        socket.once("close", () => resolve());
        socket.once("error", reject);
      });
      socket.connect(address.port, "127.0.0.1", () => {
        // Exceed both adapters' read-ahead buffers so an unread source remains paused.
        const body = Buffer.alloc(256 * 1024, "x");
        socket.write(
          Buffer.concat([
            Buffer.from(
              `POST /first HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${body.length}\r\nConnection: keep-alive\r\n\r\n`,
            ),
            body,
            Buffer.from(
              "GET /second HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n",
            ),
          ]),
        );
      });
      await closed;
      const response = Buffer.concat(chunks).toString();
      expect(response).toMatch(/^HTTP\/1\.1 200/);
      expect(response).toMatch(/connection: close\r\n/i);
      expect(response).toContain("done");
    } finally {
      socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      vi.mocked(handler).mockReset();
    }
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

  it("finalizes an unread request if the client disconnects during the error response", async () => {
    const finishing = Promise.withResolvers<void>();
    const response = new ResponseFixture();
    response._final = () => finishing.resolve();
    vi.mocked(handler).mockRejectedValueOnce(new Error("fixture failure"));
    const request = requestFixture("POST", "partial body", false);
    const pending = invoke(request, response);
    await finishing.promise;
    response.destroy();
    await pending;
    expect(request.destroyed).toBe(true);
    expect(request.listenerCount("aborted")).toBe(0);
  });
  it.each(["request", "response"])("aborts the handler when the %s disconnects", async (source) => {
    const started = Promise.withResolvers<void>();
    const cancel = vi.fn();
    let signal: AbortSignal | undefined;
    vi.mocked(handler).mockImplementationOnce(async (request) => {
      signal = request.signal;
      started.resolve();
      await new Promise<void>((resolve) =>
        request.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      return new Response(new ReadableStream({ cancel }));
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
    expect(response.status).toBe(0);
    expect(response.chunks).toEqual([]);
    expect(cancel).toHaveBeenCalledOnce();
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
  it("does not write an error response after a request abort", async () => {
    const started = Promise.withResolvers<void>();
    vi.mocked(handler).mockImplementationOnce(async (request) => {
      started.resolve();
      await new Promise<void>((resolve) =>
        request.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      throw new Error("cancelled fixture work");
    });
    const request = requestFixture();
    const response = new ResponseFixture();
    const pending = invoke(request, response);
    await started.promise;
    request.emit("aborted");
    await pending;
    expect(response.status).toBe(0);
    expect(response.chunks).toEqual([]);
  });

  it("cancels an active response stream immediately on request abort", async () => {
    const firstChunk = Promise.withResolvers<void>();
    const cancel = vi.fn();
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
            controller.enqueue(new TextEncoder().encode("first"));
          },
          cancel,
        }),
      ),
    );
    const request = requestFixture();
    const pending = invoke(request, response);
    await firstChunk.promise;
    request.emit("aborted");
    await pending;
    expect(Buffer.concat(response.chunks).toString()).toBe("first");
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.destroyed).toBe(true);
  });
});
