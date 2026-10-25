// AUTHORED-BY Codex GPT-6.1-Sol
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { handler } from "./handler.js";

/** Adapt Node HTTP requests to the Web handler without buffering either body. */
export async function nodeHandler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const headers = new Headers();
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index];
      const value = request.rawHeaders[index + 1];
      if (name !== undefined && value !== undefined) headers.append(name, value);
    }
    const method = request.method ?? "GET";
    const init: RequestInit & { duplex?: "half" } = { method, headers };
    if (method !== "GET" && method !== "HEAD") {
      init.body = Readable.toWeb(request) as ReadableStream<Uint8Array>;
      init.duplex = "half";
    }
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const result = await handler(new Request(url, init));
    for (const [name, value] of result.headers) {
      if (name !== "set-cookie") response.setHeader(name, value);
    }
    const cookies = result.headers.getSetCookie();
    if (cookies.length > 0) response.setHeader("set-cookie", cookies);
    response.writeHead(result.status, result.statusText);
    if (method === "HEAD" || result.body === null) {
      await result.body?.cancel();
      response.end();
    } else {
      await pipeline(Readable.fromWeb(result.body), response);
    }
  } catch {
    if (response.headersSent) {
      response.destroy();
    } else {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end("Internal server error\n");
    }
  }
}
