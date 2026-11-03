// AUTHORED-BY Codex GPT-6.1-Sol
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { resolveRoute } from "../../scripts/route-resolver.mjs";

const types = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** Serve raw paths via E3, including HTML, Flight and segment-prefetch transports. */
export async function serveExport(directory) {
  const manifest = JSON.parse(await readFile(join(directory, "route-manifest.json"), "utf8"));
  const requests = [];
  const server = createServer(async (request, response) => {
    try {
      const rawPath = request.url.split("?")[0];
      const resolved = resolveRoute(manifest, rawPath);
      const body = await readFile(join(directory, resolved.path));
      requests.push({ rawPath, ...resolved, prefetch: request.headers["next-router-prefetch"] });
      const headers = {
        "content-type": types[extname(resolved.path)] ?? "application/octet-stream",
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      };
      if (resolved.path.endsWith(".html")) {
        const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(
          body.toString(),
        )?.[1];
        if (!policy) throw new Error("Export has no final CSP");
        headers["content-security-policy"] = policy;
      }
      response.writeHead(resolved.status, headers);
      response.end(body);
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
