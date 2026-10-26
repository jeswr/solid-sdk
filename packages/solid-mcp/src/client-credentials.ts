// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { Readable } from "node:stream";
import { assertSafeUrl, type DnsLookup } from "@jeswr/guarded-fetch";
import { createPinningDispatcher } from "@jeswr/guarded-fetch/node";
import {
  acquireToken,
  assertEndpointTransport,
  authedFetch,
  createSession,
  discoveryUrl,
  type FetchLike,
  isLoopbackHost,
  type SolidSessionState,
} from "@jeswr/solid-dpop";
import { podScopedUrlOrUndefined } from "./auth.js";
import { withAuthLimits } from "./auth-limits.js";
import type { CliConfig } from "./cli-config.js";
import { withProfileLimits } from "./profile-limits.js";
import { withProfileRedirects } from "./profile-redirects.js";

const MAX_PROFILE_REDIRECTS = 5;

/** CSS login with a process-local token/key cache shared by every stdio tool. */
export async function createCliFetch(
  config: CliConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
  dnsLookup?: DnsLookup,
): Promise<typeof fetch> {
  if (!config.clientId) return fetchImpl;
  const creds = {
    id: config.clientId,
    secret: config.clientSecret as string,
    issuer: config.oidcIssuer ?? new URL(config.tokenUrl as string).origin,
  };
  const discovery = discoveryUrl(creds.issuer);
  let endpoint = config.tokenUrl;

  // Auth traffic never uses the pod fetch or follows redirects with credentials.
  const authTransport =
    (boundedFetch: typeof fetch): FetchLike =>
    async (url, init) => {
      try {
        if (url === discovery && !init?.method) {
          if (!endpoint) {
            const response = await boundedFetch(url, { redirect: "manual", credentials: "omit" });
            if (!response.ok) throw new Error();
            const metadata = await response.json();
            if (metadata.issuer !== creds.issuer || typeof metadata.token_endpoint !== "string")
              throw new Error();
            endpoint = metadata.token_endpoint;
          }
          assertEndpointTransport(endpoint as string, "token_endpoint");
          const target = new URL(endpoint as string);
          if (target.username || target.password || target.hash) throw new Error();
          return Response.json({ token_endpoint: endpoint });
        }
        const response = await boundedFetch(url, {
          ...init,
          body: init?.body as BodyInit | undefined,
          redirect: "manual",
          credentials: "omit",
        });
        // Upstream error bodies may echo secrets. Preserve only nonce challenges.
        if (!response.ok) {
          await response.body?.cancel();
          return new Response(null, { status: response.status, headers: response.headers });
        }
        const token = await response.json();
        if (
          token.token_type?.toLowerCase() !== "dpop" ||
          typeof token.access_token !== "string" ||
          !/^[\x21-\x7e]+$/.test(token.access_token) ||
          (token.expires_in !== undefined &&
            (typeof token.expires_in !== "number" ||
              !Number.isFinite(token.expires_in) ||
              token.expires_in <= 0))
        )
          throw new Error();
        return Response.json(token);
      } catch {
        throw new Error(
          "CSS client-credentials login failed; check issuer, endpoint and credentials.",
        );
      }
    };

  let session: SolidSessionState;
  let pending: Promise<SolidSessionState> | undefined;
  const currentSession = async (): Promise<SolidSessionState> => {
    if (session && Date.now() < session.expiresAt) return session;
    if (!pending) {
      pending = (async () => {
        try {
          // In-flight requests keep their token while signing proofs and retrying nonces.
          session = await withAuthLimits(async (boundedFetch) => {
            const transport = authTransport(boundedFetch);
            if (session) {
              const token = await acquireToken(creds, session.keyPair, transport);
              return { ...session, ...token };
            }
            return createSession(creds, transport);
          }, fetchImpl);
          return session;
        } catch {
          throw new Error(
            "CSS client-credentials login failed; check issuer, endpoint and credentials.",
          );
        } finally {
          pending = undefined;
        }
      })();
    }
    return pending;
  };
  await currentSession();

  return withProfileRedirects(async (input, init) => {
    const request = new Request(input, init);
    if (!podScopedUrlOrUndefined(config, request.url)) {
      return withProfileLimits(request, async (request) => {
        // Off-pod WebID discovery never receives this pod's credentials.
        const headers = new Headers(request.headers);
        headers.delete("authorization");
        headers.delete("dpop");
        const follow = request.redirect === "follow" && ["GET", "HEAD"].includes(request.method);
        let anonymousRequest = request;
        let allowLoopback = false;
        for (let hop = 0; ; hop++) {
          anonymousRequest.signal.throwIfAborted();
          // The generic Node guard follows redirects itself. Use its pinning
          // dispatcher here so this loop can enforce same-origin before each hop.
          const dispatcher =
            hop > 0
              ? createPinningDispatcher({
                  allowLoopback,
                  resolveAll: dnsLookup,
                })
              : undefined;
          let response: Response;
          try {
            if (dispatcher) {
              // Use the dispatcher's matching HTTP client: Node's built-in fetch
              // may use a different major version of the dispatcher protocol.
              // A fresh dispatcher has no redirect interceptor; this loop follows hops.
              const target = new URL(anonymousRequest.url);
              const result = await dispatcher.request({
                origin: target.origin,
                path: target.pathname + target.search,
                method: anonymousRequest.method as "GET" | "HEAD",
                // dispatcher.request returns wire bytes, without Fetch decoding.
                headers: { ...Object.fromEntries(headers), "accept-encoding": "identity" },
                signal: anonymousRequest.signal,
              });
              const responseHeaders = new Headers();
              for (const [name, values] of Object.entries(result.headers))
                for (const value of Array.isArray(values)
                  ? values
                  : values === undefined
                    ? []
                    : [values])
                  responseHeaders.append(name, value);
              const encoding = responseHeaders.get("content-encoding");
              if (encoding !== null && encoding.trim().toLowerCase() !== "identity") {
                result.body.destroy();
                throw new Error("Unsupported anonymous profile encoding.");
              }
              const noBody =
                anonymousRequest.method === "HEAD" || [204, 205, 304].includes(result.statusCode);
              if (noBody) result.body.destroy();
              response = new Response(
                noBody
                  ? null
                  : (Readable.toWeb(result.body, {
                      strategy: {
                        highWaterMark: result.body.readableHighWaterMark,
                        size: (chunk) => chunk.byteLength,
                      },
                    }) as ReadableStream<Uint8Array>),
                {
                  status: result.statusCode,
                  headers: responseHeaders,
                },
              );
              Object.defineProperty(response, "url", { value: anonymousRequest.url });
            } else {
              response = await fetchImpl(anonymousRequest, {
                headers,
                redirect: "manual",
                credentials: "omit",
              });
            }
          } catch (error) {
            if (dispatcher)
              throw new Error("Invalid anonymous profile redirect.", { cause: error });
            throw error;
          } finally {
            void dispatcher?.close().catch(() => {});
          }
          const location = response.headers.get("location");
          if (!follow || ![301, 302, 303, 307, 308].includes(response.status) || !location)
            return response;
          await response.body?.cancel();
          if (hop === MAX_PROFILE_REDIRECTS)
            throw new Error("Too many anonymous profile redirects.");
          let target: URL;
          try {
            target = new URL(location, anonymousRequest.url);
            if (location.trim().startsWith("//") || target.origin !== new URL(request.url).origin)
              throw new Error();
            // Only operator-configured loopback origins retain the local development allowance.
            allowLoopback =
              isLoopbackHost(target.hostname) &&
              [config.podRoot, config.webId].some(
                (url) => url && new URL(url).origin === target.origin,
              );
            await assertSafeUrl(target.href, { allowLoopback, dnsLookup });
          } catch {
            throw new Error("Invalid anonymous profile redirect.");
          }
          anonymousRequest = new Request(target, anonymousRequest);
        }
      });
    }
    const state = await currentSession();
    const headers = Object.fromEntries(request.headers);
    const body = request.body ? new Uint8Array(await request.arrayBuffer()) : undefined;
    const resourceTransport: FetchLike = (url, options) =>
      fetchImpl(url, {
        ...options,
        body: options?.body as BodyInit | undefined,
        redirect: "manual",
        credentials: "omit",
        signal: request.signal,
      });
    return authedFetch(
      state,
      undefined,
      request.method,
      request.url,
      { headers, body },
      resourceTransport,
    );
  });
}
