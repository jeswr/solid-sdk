// AUTHORED-BY GPT-5.6 Codex
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

// An explicit file map keeps encoded traversal, symlinks and arbitrary host files out of the server.
const FILES = [
  "index.html",
  "index.js",
  "hostile.html",
  "hostile.js",
  "ios-probes.js",
  "navigation.html",
  "navigation.js",
  "foreign.html",
];

export function fixturePorts(port = "4173", iframePort = "4174") {
  const parse = (value) => {
    if (!/^\d+$/.test(String(value)) || Number(value) < 1024 || Number(value) > 65535) {
      throw new Error("Fixture ports must be integers between 1024 and 65535");
    }
    return Number(value);
  };
  const ports = { port: parse(port), iframePort: parse(iframePort) };
  if (ports.port === ports.iframePort) throw new Error("Fixture origins need distinct ports");
  return ports;
}

export async function startFixtureServer(options = {}) {
  const { port, iframePort } = fixturePorts(options.port, options.iframePort);
  const config = {
    suiteOrigin: `http://localhost:${port}`,
    foreignOrigin: `http://localhost:${iframePort}`,
  };
  const files = new Map(
    await Promise.all(
      FILES.map(async (name) => [
        `/${name}`,
        await readFile(new URL(`fixture/${name}`, import.meta.url)),
      ]),
    ),
  );
  const servers = [];
  const close = async () =>
    Promise.all(
      servers.map(
        (server) =>
          new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
            server.closeAllConnections();
          }),
      ),
    );
  try {
    for (const listenPort of [port, iframePort]) {
      const server = createServer((req, res) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.writeHead(405, { Allow: "GET, HEAD" }).end();
          return;
        }
        // Do not normalise paths: nothing except the allowlist is served.
        const path = (req.url ?? "").split("?")[0];
        const key = path === "/" ? "/index.html" : path;
        const json =
          key === "/config.json"
            ? config
            : key === "/health"
              ? { fixture: "suite-mobile-e2e" }
              : null;
        const body = json ? JSON.stringify(json) : files.get(key);
        if (body === undefined) {
          res.writeHead(404).end("Not found");
          return;
        }
        res.writeHead(200, {
          "Content-Type": json
            ? "application/json"
            : key.endsWith(".js")
              ? "text/javascript"
              : "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(req.method === "HEAD" ? undefined : body);
      });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(listenPort, "127.0.0.1", resolve);
      });
      servers.push(server);
    }
    return { ...config, close };
  } catch (error) {
    await close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await startFixtureServer({
    port: process.env.E2E_PORT,
    iframePort: process.env.E2E_IFRAME_PORT,
  });
  console.log(`Fixture suite: ${fixture.suiteOrigin}; hostile origin: ${fixture.foreignOrigin}`);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await fixture.close();
    });
}
