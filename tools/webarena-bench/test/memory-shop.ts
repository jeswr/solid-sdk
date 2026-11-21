// AUTHORED-BY Claude Opus 5.5
// Only the socket boundary is substituted. @jeswr/test-shop owns every route and state transition.
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Transport } from "../src/types.js";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;
const handlers = new Map<string, Handler>();
let nextPort = 21000;
export function createMemoryServer(handler: Handler) {
  const port = nextPort++;
  const origin = `http://127.0.0.1:${port}`;
  handlers.set(origin, handler);
  return Object.assign(new EventEmitter(), {
    listen(_port: number, _host: string, ready: () => void) {
      ready();
    },
    address() {
      return { address: "127.0.0.1", family: "IPv4", port };
    },
    closeAllConnections() {},
    close(done: () => void) {
      handlers.delete(origin);
      done();
    },
  });
}

export const transport: Transport = async (input, init) => {
  const request = new Request(input, init);
  request.signal.throwIfAborted();
  const url = new URL(request.url);
  const handler = handlers.get(url.origin);
  if (!handler) throw new Error("No test-shop handler for this origin.");
  const incoming = Object.assign(Readable.from([Buffer.from(await request.text())]), {
    method: request.method,
    url: `${url.pathname}${url.search}`,
    headers: Object.fromEntries(request.headers),
  }) as IncomingMessage;
  return new Promise<Response>((resolve) => {
    let headers = new Headers();
    const events = new EventEmitter();
    const response = Object.assign(events, {
      statusCode: 200,
      headersSent: false,
      writeHead(status: number, values: Record<string, string | string[]>) {
        this.statusCode = status;
        this.headersSent = true;
        headers = new Headers();
        for (const [name, value] of Object.entries(values))
          for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
      },
      end(body?: string) {
        events.emit("finish");
        resolve(
          new Response([204, 205, 304].includes(this.statusCode) ? null : body, {
            status: this.statusCode,
            headers,
          }),
        );
      },
    });
    handler(incoming, response as unknown as ServerResponse);
  });
};
