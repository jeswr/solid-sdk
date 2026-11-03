// AUTHORED-BY Codex GPT-6.1-Sol
import { once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { createRelay } from "./relay.js";

/** Raw-body Node/Vercel adapter; never trust forwarded scheme or authority headers. */
export function nodeHandler(relay: ReturnType<typeof createRelay>, publicUrl: string) {
  const base = new URL(publicUrl);
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const abort = new AbortController();
    const onClose = () => abort.abort();
    response.on("close", onClose);
    try {
      if (
        request.headers.host !== base.host ||
        !request.url?.startsWith("/") ||
        request.url.startsWith("//")
      ) {
        response.writeHead(400).end();
        return;
      }
      const headers = new Headers();
      const unique = new Set<string>();
      for (let i = 0; i < request.rawHeaders.length; i += 2) {
        const name = (request.rawHeaders[i] as string).toLowerCase();
        if (
          unique.has(name) &&
          [
            "signature",
            "signature-input",
            "content-digest",
            "content-type",
            "authorization",
            "host",
          ].includes(name)
        ) {
          response.writeHead(401).end();
          return;
        }
        unique.add(name);
        headers.append(name, request.rawHeaders[i + 1] as string);
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 1_048_576) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const result = await relay.handle(
        new Request(`${base.origin}${request.url}`, {
          method: request.method,
          headers,
          signal: abort.signal,
          ...(chunks.length ? { body: new Uint8Array(Buffer.concat(chunks)) } : {}),
        }),
      );
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.flushHeaders();
      if (result.body) {
        const reader = result.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!response.write(value)) await once(response, "drain", { signal: abort.signal });
          }
        } finally {
          await reader.cancel();
        }
      }
      response.end();
    } catch {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    } finally {
      response.removeListener("close", onClose);
    }
  };
}
