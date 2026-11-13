// AUTHORED-BY Codex GPT-6.1-Sol
import { request as httpRequest } from "node:http";
import type { ExecutorOptions } from "@jeswr/site-executor";

/** Instrument the real executor's loopback HTTP boundary without any ambient network API. */
export function liveTransport(
  origin: string,
  calls: Array<{ method: string; path: string }>,
): NonNullable<ExecutorOptions["fetch"]> {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== origin || url.hostname !== "127.0.0.1")
      throw new Error("Live transport requires the configured loopback origin");
    calls.push({ method: request.method, path: url.pathname });
    const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
    return new Promise<Response>((resolve, reject) => {
      const connection = httpRequest(
        url,
        {
          method: request.method,
          headers: Object.fromEntries(request.headers),
          signal: request.signal,
        },
        (incoming) => {
          const headers = new Headers();
          for (let n = 0; n < incoming.rawHeaders.length; n += 2) {
            const name = incoming.rawHeaders[n],
              value = incoming.rawHeaders[n + 1];
            if (name && value !== undefined) headers.append(name, value);
          }
          if (headers.get("location")?.startsWith("http://localhost:7780")) {
            incoming.destroy();
            reject(new Error("Sandbox redirects to http://localhost:7780; stop"));
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          incoming.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 5 * 1024 * 1024) {
              incoming.destroy();
              reject(new Error("Live response size limit"));
            } else chunks.push(chunk);
          });
          incoming.on("error", reject);
          incoming.on("end", () =>
            resolve(
              new Response(
                [204, 304].includes(incoming.statusCode ?? 200) ? null : Buffer.concat(chunks),
                { status: incoming.statusCode ?? 200, headers },
              ),
            ),
          );
        },
      );
      connection.on("error", reject);
      connection.end(body);
    });
  };
}
