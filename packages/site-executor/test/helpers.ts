// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
// Test helpers: an ActionRequest built from Turtle (n3, test-only stand-in for
// site-model's parseActionRequest) and a tiny 127.0.0.1 HTTP server harness.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { ActionRequest } from "@jeswr/site-model";
import { Parser, Store, type Term } from "n3";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

function norm(iri: string): string {
  return iri.replace(/^http:\/\/schema\.org\//, "https://schema.org/");
}

const PREFIXES = `@prefix schema: <https://schema.org/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
`;

/** Parse Turtle and expose the single schema.org *Action node as an ActionRequest. */
export function actionRequest(turtle: string): ActionRequest {
  const store = new Store(
    new Parser({ baseIRI: "https://planner.test/" }).parse(PREFIXES + turtle),
  );
  const nodes = store
    .getQuads(null, RDF_TYPE, null, null)
    .filter((q) => /^https?:\/\/schema\.org\/\w*Action$/.test(q.object.value))
    .map((q) => q.subject);
  const unique = [...new Map(nodes.map((n) => [n.value, n])).values()];
  if (unique.length !== 1) throw new Error(`expected one action node, found ${unique.length}`);
  const node = unique[0] as Term;
  const types = store.getQuads(node, RDF_TYPE, null, null).map((q) => norm(q.object.value));
  return {
    node: node.termType === "BlankNode" ? `_:${node.value}` : node.value,
    types,
    values(path: string[]): string[] {
      let current: Term[] = [node];
      for (const step of path) {
        const want = norm(step);
        current = current.flatMap((t) =>
          store
            .getQuads(t, null, null, null)
            .filter((q) => norm(q.predicate.value) === want)
            .map((q) => q.object),
        );
      }
      return current.map((t) => (t.termType === "BlankNode" ? `_:${t.value}` : t.value));
    },
  };
}

export interface LoggedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

export interface TestServer {
  url: string;
  requests: LoggedRequest[];
  close(): Promise<void>;
}

export type Handler = (req: LoggedRequest, res: ServerResponse) => void | Promise<void>;

export async function startServer(handler: Handler): Promise<TestServer> {
  const requests: LoggedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const logged: LoggedRequest = {
        method: req.method ?? "GET",
        url: req.url ?? "/",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      requests.push(logged);
      Promise.resolve(handler(logged, res)).catch((e: unknown) => {
        res.statusCode = 500;
        res.end(String(e));
      });
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    return memoryServer(handler, requests);
  }
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

// Sandboxed runs cannot bind sockets. Exercise the same fixture handlers via
// Fetch Request/Response objects, without skipping HTTP behavior assertions.
let memoryPort = 20000;
const memoryRoutes = new Map<string, { handler: Handler; requests: LoggedRequest[] }>();
function memoryServer(handler: Handler, requests: LoggedRequest[]): TestServer {
  const url = `http://127.0.0.1:${memoryPort++}`;
  memoryRoutes.set(url, { handler, requests });
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.signal.aborted) throw request.signal.reason;
    const target = new URL(request.url);
    const route = memoryRoutes.get(target.origin);
    if (!route) throw new Error("no fixture on this origin");
    const logged: LoggedRequest = {
      method: request.method,
      url: target.pathname + target.search,
      headers: { ...Object.fromEntries(request.headers), host: target.host },
      body: await request.text(),
    };
    route.requests.push(logged);
    return new Promise<Response>((resolve, reject) => {
      let status = 200;
      let headers = new Headers();
      const response = {
        statusCode: 200,
        writeHead(code: number, values: Record<string, string | string[]>) {
          status = code;
          headers = new Headers();
          for (const [name, value] of Object.entries(values)) {
            for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
          }
        },
        end(body: string) {
          resolve(
            new Response([204, 205, 304].includes(status) ? null : body, { status, headers }),
          );
        },
      } as unknown as ServerResponse;
      Promise.resolve(route.handler(logged, response)).catch(reject);
    });
  };
  return {
    url,
    requests,
    async close() {
      memoryRoutes.delete(url);
    },
  };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function send(
  res: ServerResponse,
  status: number,
  body: string,
  type = "text/html",
  headers: Record<string, string | string[]> = {},
): void {
  res.writeHead(status, { "content-type": type, ...headers });
  res.end(body);
}

export function json(
  res: ServerResponse,
  status: number,
  value: unknown,
  headers: Record<string, string | string[]> = {},
): void {
  send(res, status, JSON.stringify(value), "application/json", headers);
}
