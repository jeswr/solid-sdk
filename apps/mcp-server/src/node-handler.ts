// AUTHORED-BY Codex GPT-6.1-Sol
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { handler } from "./handler.js";

/** Adapt Node HTTP requests to the Web handler without buffering either body. */
export async function nodeHandler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const controller = new AbortController();
  let body: ReadableStream<Uint8Array> | undefined;
  const closeUnreadRequest = () => {
    if (body && !request.readableEnded && !response.headersSent) {
      response.setHeader("connection", "close");
    }
  };
  const abort = () => controller.abort();
  const close = () => {
    if (!response.writableFinished) abort();
  };
  request.once("aborted", abort);
  response.once("close", close);
  if (request.aborted || response.destroyed) abort();
  try {
    const headers = new Headers();
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index];
      const value = request.rawHeaders[index + 1];
      if (name !== undefined && value !== undefined) headers.append(name, value);
    }
    const method = request.method ?? "GET";
    const init: RequestInit & { duplex?: "half" } = { method, headers, signal: controller.signal };
    if (method !== "GET" && method !== "HEAD") {
      body = Readable.toWeb(request) as ReadableStream<Uint8Array>;
      init.body = body;
      init.duplex = "half";
    }
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const result = await handler(new Request(url, init));
    if (controller.signal.aborted || response.destroyed) {
      await result.body?.cancel();
      return;
    }
    for (const [name, value] of result.headers) {
      if (name !== "set-cookie") response.setHeader(name, value);
    }
    const cookies = result.headers.getSetCookie();
    if (cookies.length > 0) response.setHeader("set-cookie", cookies);
    closeUnreadRequest();
    response.writeHead(result.status, result.statusText);
    if (method === "HEAD" || result.body === null) {
      await result.body?.cancel();
      response.end();
      await finished(response, { cleanup: true });
    } else {
      await pipeline(Readable.fromWeb(result.body), response, { signal: controller.signal });
    }
  } catch {
    if (controller.signal.aborted || response.destroyed) return;
    if (response.headersSent) {
      response.destroy();
    } else {
      closeUnreadRequest();
      response.writeHead(500, { "content-type": "text/plain" });
      response.end("Internal server error\n");
      await finished(response, { cleanup: true }).catch(() => {});
    }
  } finally {
    request.off("aborted", abort);
    response.off("close", close);
    if (body) {
      const unread = !request.readableEnded;
      // Cancel any read-ahead bytes too. A handler may retain a reader lock;
      // destroying the source still terminates that stream without draining it.
      await body.cancel().catch(() => {});
      if (unread) request.destroy();
    }
  }
}
