// Real HTTP servers on 127.0.0.1 driven by Fetch API handlers, so tests exercise actual request/response
// flows (headers, redirects, bodies) rather than mocked function calls.

import { once } from "node:events";
import { createServer } from "node:http";

/**
 * @param {(request: Request, server: {url: string}) => Promise<Response> | Response} handler
 * @returns {Promise<{url: string, requests: Request[], close(): Promise<void>}>}
 */
export async function serve(handler) {
  const state = { url: "", requests: [] };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, state.url);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body =
        chunks.length === 0 || req.method === "GET" || req.method === "HEAD"
          ? undefined
          : Buffer.concat(chunks);
      const request = new Request(url, { method: req.method, headers: req.headers, body });
      state.requests.push(request.clone());
      const response =
        req.method === "OPTIONS"
          ? new Response(null, { status: 204 })
          : await handler(request, state);
      // Permissive CORS so the same servers work for browser smoke tests.
      const headers = new Headers(response.headers);
      headers.set("access-control-allow-origin", "*");
      headers.set("access-control-allow-headers", "authorization, dpop, content-type");
      headers.set("access-control-allow-methods", "GET, HEAD, POST, PUT, PATCH, DELETE");
      headers.set("access-control-expose-headers", "www-authenticate, link, dpop-nonce, location");
      res.writeHead(response.status, [...headers].flat());
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(error?.stack ?? error));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  state.url = `http://127.0.0.1:${server.address().port}`;
  return {
    get url() {
      return state.url;
    },
    requests: state.requests,
    async close() {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}

/** Plain transport for tests: the real global fetch, never a reactive one. */
export const transport = globalThis.fetch.bind(globalThis);

/** HttpOptions allowing the plain-HTTP local servers (the explicit development opt-in under test). */
export const insecure = { fetch: transport, allowInsecureRequests: true };
