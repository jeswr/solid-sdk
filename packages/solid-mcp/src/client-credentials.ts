// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  acquireToken,
  assertEndpointTransport,
  authedFetch,
  createSession,
  discoveryUrl,
  type FetchLike,
  type SolidSessionState,
} from "@jeswr/solid-dpop";
import { podScopedUrlOrUndefined } from "./auth.js";
import type { CliConfig } from "./cli-config.js";

const MAX_PROFILE_REDIRECTS = 5;

/** CSS login with a process-local token/key cache shared by every stdio tool. */
export async function createCliFetch(
  config: CliConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
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
  const authTransport: FetchLike = async (url, init) => {
    try {
      if (url === discovery && !init?.method) {
        if (!endpoint) {
          const response = await fetchImpl(url, { redirect: "manual", credentials: "omit" });
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
      const response = await fetchImpl(url, {
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
          if (session) {
            const token = await acquireToken(creds, session.keyPair, authTransport);
            session = { ...session, ...token };
          } else session = await createSession(creds, authTransport);
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

  return async (input, init) => {
    const request = new Request(input, init);
    if (!podScopedUrlOrUndefined(config, request.url)) {
      // Off-pod WebID discovery never receives this pod's credentials.
      const headers = new Headers(request.headers);
      headers.delete("authorization");
      headers.delete("dpop");
      const follow = request.redirect === "follow" && ["GET", "HEAD"].includes(request.method);
      let anonymousRequest = request;
      for (let hop = 0; ; hop++) {
        const response = await fetchImpl(anonymousRequest, {
          headers,
          redirect: "manual",
          credentials: "omit",
        });
        const location = response.headers.get("location");
        if (!follow || ![301, 302, 303, 307, 308].includes(response.status) || !location)
          return response;
        await response.body?.cancel();
        if (hop === MAX_PROFILE_REDIRECTS) throw new Error("Too many anonymous profile redirects.");
        let target: URL;
        try {
          target = new URL(location, anonymousRequest.url);
          if (!["https:", "http:"].includes(target.protocol) || target.username || target.password)
            throw new Error();
        } catch {
          throw new Error("Invalid anonymous profile redirect.");
        }
        // Stay anonymous even when a profile redirects back into the pod.
        anonymousRequest = new Request(target, anonymousRequest);
      }
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
  };
}
