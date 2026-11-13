// AUTHORED-BY Codex GPT-6.1-Sol
import { createNodeGuardedFetch, refuseRedirects } from "@jeswr/guarded-fetch/node";
import {
  buildConnectionRecord,
  classifyConnection,
  connectionRecordUrl,
  connectionsContainer,
  MAX_CONNECTION_BYTES,
  MCP,
  parseConnectionRecord,
  touchLastUsed,
} from "@jeswr/mcp-connections";
import type {
  AccessPrincipal,
  AuthorizationServerOptions,
  PodSessionProvider,
} from "@jeswr/mcp-oauth";
import { ensureOwnerOnlyContainer } from "@jeswr/pkg-memory";
import { createStoragePodPort } from "@jeswr/solid-mcp";
import { podRootFor, withCssCompatibility } from "./pod.js";

type GrantEvent = Parameters<NonNullable<AuthorizationServerOptions["grantCreated"]>>[0];
export function provenanceId(clientId: string, origin: string): string {
  try {
    return new URL(clientId).href;
  } catch {
    return `${origin}/clients/${encodeURIComponent(clientId)}`;
  }
}
const strong = (etag: string | null): etag is string =>
  etag !== null && /^"[^"\r\n]+"(?![\s\S])/.test(etag);

/** Abort the transport and stop waiting even if a broker ignores its signal. */
async function deadline<T>(ms: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Connection operation timed out"));
        }, ms);
      }),
      operation(controller.signal),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
function transport(fetcher: typeof fetch, signal: AbortSignal): typeof fetch {
  const noRedirects = refuseRedirects(fetcher);
  return async (input, init) => {
    signal.throwIfAborted();
    const request = new Request(input, init);
    const response = await noRedirects(
      new Request(request, { signal: AbortSignal.any([signal, request.signal]) }),
    );
    if (response.redirected || (response.url && response.url !== request.url)) {
      void response.body?.cancel().catch(() => {});
      throw new Error("Unexpected connection location");
    }
    return response;
  };
}
class InvalidRecordBytes extends Error {}
async function text(response: Response, signal: AbortSignal) {
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => {
    void reader?.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (reader)
      while (true) {
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > MAX_CONNECTION_BYTES) throw new InvalidRecordBytes("Invalid connection record");
        chunks.push(chunk.value);
      }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new InvalidRecordBytes("Invalid connection record");
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
}

/** Pod records can only deny a verified vault grant. Never accepts a caller-selected URL. */
export function createConnectionGate(options: {
  resource: string;
  origin: string;
  sessions: PodSessionProvider;
  upstreamFetch?: typeof fetch;
  now: () => number;
}) {
  const upstream =
    options.upstreamFetch ??
    createNodeGuardedFetch({ maxBytes: MAX_CONNECTION_BYTES, timeoutMs: 3000, maxRedirects: 0 });
  const date = () => new Date(options.now() * 1000);
  return {
    async record(event: GrantEvent, access: "ReadOnly" | "ReadWrite") {
      await deadline(3000, async (signal) => {
        const root = await podRootFor(event.grant.session.webId, transport(upstream, signal));
        const fetcher = transport(
          withCssCompatibility(
            transport(await options.sessions.fetchFor(event.grant.session.id), signal),
          ),
          signal,
        );
        // System writes are separate from the tools' read-only capability.
        const systemPod = createStoragePodPort(
          { fetch: fetcher, podRoot: root, webId: event.grant.session.webId, readOnly: false },
          transport(upstream, signal),
        );
        const container = connectionsContainer(root);
        await ensureOwnerOnlyContainer(systemPod, container, {
          allowAclUrl: (url) =>
            url.startsWith(new URL("private/pkg/", root).href) ||
            url === new URL("private/.acl", root).href,
        });
        const url = await connectionRecordUrl(root, options.resource, event.grant.id);
        const body = buildConnectionRecord(url, {
          resource: options.resource,
          client: provenanceId(event.grant.clientId, options.origin),
          ...(event.client.client_name === undefined ? {} : { title: event.client.client_name }),
          redirectOrigin: `${new URL(event.redirectUri).origin}/`,
          scope: event.grant.scope,
          access: `${MCP}${access}`,
          personalDataMode: `${MCP}OwnerPolicy`,
          purposes: [
            "https://w3id.org/dpv#ServiceProvision",
            "https://w3id.org/dpv#Personalisation",
          ],
          created: new Date(event.issuedAt * 1000),
          expiresAt: new Date(event.grant.expiresAt * 1000),
        });
        await systemPod.write(url, new TextEncoder().encode(body), "text/turtle", {
          ifNoneMatch: "*",
        });
        const read = await fetcher(url, { cache: "no-store", headers: { accept: "text/turtle" } });
        if (read.status !== 200) {
          void read.body?.cancel().catch(() => {});
          throw new Error("Connection verification failed");
        }
        const actual = await parseConnectionRecord(
          await text(read, signal),
          read.headers.get("content-type") ?? "",
          url,
        );
        const expected = await parseConnectionRecord(body, "text/turtle", url);
        if (JSON.stringify(actual) !== JSON.stringify(expected))
          throw new Error("Connection verification failed");
        signal.throwIfAborted();
      });
    },
    async check(principal: AccessPrincipal, podRoot: string) {
      try {
        const result = await deadline(3000, async (signal) => {
          const url = await connectionRecordUrl(podRoot, options.resource, principal.grantId);
          const fetcher = transport(
            withCssCompatibility(
              transport(await options.sessions.fetchFor(principal.sessionId), signal),
            ),
            signal,
          );
          const response = await fetcher(url, {
            cache: "no-store",
            headers: { accept: "text/turtle" },
          });
          if (response.status !== 200) {
            void response.body?.cancel().catch(() => {});
            return {
              state: classifyConnection(response.status, undefined, {
                resource: options.resource,
                client: provenanceId(principal.clientId, options.origin),
              }),
            };
          }
          // Transport failure is unavailable; malformed bytes/RDF are authoritative denial.
          let body: string;
          try {
            body = await text(response, signal);
          } catch (error) {
            if (!(error instanceof InvalidRecordBytes) || signal.aborted) throw error;
            return { state: "revoked" as const };
          }
          const contentType = response.headers.get("content-type") ?? "";
          const record = await parseConnectionRecord(body, contentType, url).catch(() => undefined);
          const state = classifyConnection(200, record, {
            resource: options.resource,
            client: provenanceId(principal.clientId, options.origin),
          });
          return { state, record, body, contentType, etag: response.headers.get("etag"), url };
        });
        if (
          result.state === "live" &&
          result.record &&
          result.record.lastUsed?.toISOString().slice(0, 10) !==
            date().toISOString().slice(0, 10) &&
          strong(result.etag ?? null)
        ) {
          try {
            await deadline(2000, async (signal) => {
              const fetcher = transport(
                withCssCompatibility(
                  transport(await options.sessions.fetchFor(principal.sessionId), signal),
                ),
                signal,
              );
              const body = await touchLastUsed(result.body, result.contentType, result.url, date());
              const response = await fetcher(result.url, {
                method: "PUT",
                headers: { "content-type": "text/turtle", "if-match": result.etag as string },
                body,
              });
              void response.body?.cancel().catch(() => {});
            });
          } catch {
            /* Last-used metadata is best effort, including concurrent 412s. */
          }
        }
        return result.state;
      } catch {
        return "unavailable" as const;
      }
    },
  };
}
