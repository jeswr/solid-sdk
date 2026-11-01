// AUTHORED-BY Codex GPT-6.1-Sol
import type { IncomingMessage, RequestListener, Server, ServerResponse } from "node:http";

const handlers = new Map<number, RequestListener>();
let nextPort = 31000;

/** Exercise the actual listener handler without requiring permission to bind local sockets. */
export function createServer(handler: RequestListener): Server {
  const port = nextPort++;
  const server = {
    listening: false,
    listen(_port: number, host: string, ready: () => void) {
      if (host !== "127.0.0.1") throw new Error("Listener must bind loopback.");
      handlers.set(port, handler);
      server.listening = true;
      queueMicrotask(ready);
      return server;
    },
    address: () => ({ port, address: "127.0.0.1", family: "IPv4" }),
    close(done: () => void) {
      handlers.delete(port);
      server.listening = false;
      done();
    },
  };
  return server as unknown as Server;
}

export async function loopbackFetch(input: string): Promise<Response> {
  const url = new URL(input);
  const handler = handlers.get(Number(url.port));
  if (!handler) throw new Error("No loopback listener.");
  let status = 200;
  let headers: Record<string, string> = {};
  return new Promise<Response>((resolve) => {
    const response = {
      writeHead(code: number, values?: Record<string, string>) {
        status = code;
        headers = values ?? {};
        return response;
      },
      end(body: string) {
        resolve(new Response(body, { status, headers }));
      },
    };
    handler(
      { url: `${url.pathname}${url.search}` } as IncomingMessage,
      response as unknown as ServerResponse,
    );
  });
}
