// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { expect, test, vi } from "vitest";
import { nodeHandler } from "./node.js";
import type { createRelay } from "./relay.js";

function fixture(response: () => Promise<Response> = async () => new Response("ok")) {
  const handle = vi.fn(response);
  const handler = nodeHandler(
    { handle } as unknown as ReturnType<typeof createRelay>,
    "https://relay.example",
  );
  const req = Object.assign(Readable.from([Buffer.from("body")]), {
    headers: { host: "relay.example" },
    rawHeaders: ["Host", "relay.example"],
    url: "/register",
    method: "POST",
  }) as unknown as IncomingMessage;
  const res = Object.assign(new EventEmitter(), {
    headersSent: false,
    writeHead: vi.fn(function (
      this: { headersSent: boolean },
      _status: number,
      _headers?: unknown,
    ) {
      this.headersSent = true;
      return this;
    }),
    end: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(() => true),
  }) as unknown as ServerResponse;
  return { handler, req, res, handle };
}

test("preserves bytes and headers and completes normal and bodyless responses", async () => {
  const f = fixture();
  await f.handler(f.req, f.res);
  const request = f.handle.mock.calls[0]![0] as Request;
  expect(await request.text()).toBe("body");
  expect(request.url).toBe("https://relay.example/register");
  expect(f.res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
  expect(f.res.end).toHaveBeenCalled();
  expect(f.res.listenerCount("close")).toBe(0);
  const g = fixture(async () => new Response(null, { status: 204 }));
  const req = Object.assign(Readable.from([]), {
    headers: { host: "relay.example" },
    rawHeaders: [],
    url: "/stream/id",
    method: "GET",
  }) as unknown as IncomingMessage;
  await g.handler(req, g.res);
  expect(g.res.writeHead).toHaveBeenCalledWith(204, expect.any(Object));
});

test("rejects wrong authority, ambiguous targets and duplicate security headers", async () => {
  for (const [host, url] of [
    ["wrong.example", "/register"],
    ["relay.example", "//evil.example/"],
    ["relay.example", undefined],
    ["relay.example", "https://evil.example/"],
  ]) {
    const f = fixture();
    f.req.headers.host = host;
    f.req.url = url;
    await f.handler(f.req, f.res);
    expect(f.res.writeHead).toHaveBeenCalledWith(400);
    expect(f.handle).not.toHaveBeenCalled();
  }
  for (const header of ["content-digest", "dpop", "authorization", "installation-proof"]) {
    const f = fixture();
    f.req.rawHeaders.push(header, "one", header, "two");
    await f.handler(f.req, f.res);
    expect(f.res.writeHead).toHaveBeenCalledWith(401, { "www-authenticate": "DPoP" });
    expect(f.handle).not.toHaveBeenCalled();
  }
  const g = fixture();
  g.req.rawHeaders.push("X-Custom", "one", "X-Custom", "two");
  await g.handler(g.req, g.res);
  expect(g.handle).toHaveBeenCalled();
});

test("bounds raw request bodies before parsing", async () => {
  const f = fixture();
  const req = Object.assign(Readable.from([Buffer.alloc(1_048_577)]), {
    headers: { host: "relay.example" },
    rawHeaders: [],
    url: "/register",
    method: "POST",
  }) as unknown as IncomingMessage;
  await f.handler(req, f.res);
  expect(f.res.writeHead).toHaveBeenCalledWith(413);
  expect(f.handle).not.toHaveBeenCalled();
});

test("observes response backpressure and cancels on client disconnect", async () => {
  const f = fixture();
  vi.mocked(f.res.write).mockImplementationOnce(() => {
    queueMicrotask(() => f.res.emit("drain"));
    return false;
  });
  await f.handler(f.req, f.res);
  expect(f.res.end).toHaveBeenCalled();
  const g = fixture();
  vi.mocked(g.res.write).mockImplementationOnce(() => {
    queueMicrotask(() => g.res.emit("close"));
    return false;
  });
  await g.handler(g.req, g.res);
  expect(g.res.end).toHaveBeenCalled();
  expect(g.res.writeHead).toHaveBeenCalledTimes(1);
});

test("handles transport failures before headers without leaking errors", async () => {
  const f = fixture(async () => {
    throw new Error("secret detail");
  });
  await f.handler(f.req, f.res);
  expect(f.res.writeHead).toHaveBeenCalledWith(500);
  expect(f.res.end).toHaveBeenCalledWith();
});
