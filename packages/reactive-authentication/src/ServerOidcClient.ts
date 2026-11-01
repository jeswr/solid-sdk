// AUTHORED-BY Codex GPT-6.1-Sol
import * as oauth from "oauth4webapi";
import { withDPoPNonceRetry } from "./dpopNonce.js";
import { type HttpOptions, oauthOptions } from "./transport.js";

/** Sensitive Node vault envelope. Never use this format for browser persistence. */
export type ServerDpopJwk = JsonWebKey;
export interface ServerDpopKey {
  keys: CryptoKeyPair;
  envelope: ServerDpopJwk;
}
export interface ServerAuthorizationState {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
}
export interface ServerOidcTokens {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresIn?: number;
}
export interface ServerOidcOptions {
  issuer: string;
  clientId: string;
  redirectUri: string;
  fetch: typeof fetch;
  dpopKeyPair?: ServerDpopKey;
}
export const SERVER_MAX_REPLAY_BODY_BYTES = 10 * 1024 * 1024;

/** Import a sealed server key into non-extractable signing material. */
export async function importServerDpopKey(envelope: ServerDpopJwk): Promise<ServerDpopKey> {
  const algorithm = { name: "ECDSA", namedCurve: "P-256" };
  const { d: _private, ...publicJwk } = envelope;
  const keys = {
    privateKey: await crypto.subtle.importKey("jwk", envelope, algorithm, false, ["sign"]),
    publicKey: await crypto.subtle.importKey(
      "jwk",
      { ...publicJwk, key_ops: ["verify"] },
      algorithm,
      true,
      ["verify"],
    ),
  };
  // Refuse a vault envelope containing unrelated public and private keys.
  const proof = new Uint8Array([1, 2, 3]);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keys.privateKey,
    proof,
  );
  if (
    !(await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keys.publicKey,
      signature,
      proof,
    ))
  )
    throw new Error("Mismatched server DPoP keys");
  return { keys, envelope };
}
export async function exportServerDpopKey(key: ServerDpopKey): Promise<ServerDpopJwk> {
  return structuredClone(key.envelope);
}
async function generateKey(): Promise<ServerDpopKey> {
  // JSON-only encrypted server vaults cannot persist CryptoKeys. Export once at creation,
  // then use a non-extractable key for every signature. Browser keys never use this path.
  const keys = await oauth.generateKeyPair("ES256", { extractable: true });
  return importServerDpopKey(await crypto.subtle.exportKey("jwk", keys.privateKey));
}

/** Split authorization flow for server brokers whose callback may reach another worker.
 * The caller owns single-use state, encrypted envelopes, refresh CAS and credential scope.
 */
export async function createServerOidcClient(options: ServerOidcOptions) {
  const http: HttpOptions = { fetch: options.fetch };
  const issuer = new URL(options.issuer);
  const as = await oauth.processDiscoveryResponse(
    issuer,
    await oauth.discoveryRequest(issuer, oauthOptions(http)),
  );
  const client: oauth.Client = {
    client_id: options.clientId,
    token_endpoint_auth_method: "none",
  };
  const dpopKeyPair = options.dpopKeyPair ?? (await generateKey());
  const dpop = oauth.DPoP(client, dpopKeyPair.keys);
  let current: ServerOidcTokens | undefined;
  let webId: string | undefined;
  const tokens = async (response: Response, authorization?: ServerAuthorizationState) => {
    const processed =
      authorization === undefined
        ? await oauth.processRefreshTokenResponse(as, client, response)
        : await oauth.processAuthorizationCodeResponse(as, client, response, {
            expectedNonce: authorization.nonce,
            requireIdToken: true,
          });
    if (processed.token_type.toLowerCase() !== "dpop") throw new Error("DPoP tokens required");
    const claims = oauth.getValidatedIdTokenClaims(processed);
    if (claims !== undefined) {
      await oauth.validateApplicationLevelSignature(as, response, oauthOptions(http));
      const id = claims.webid;
      if (typeof id !== "string" || !id) throw new Error("Missing verified WebID");
      const parsed = new URL(id);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password)
        throw new Error("Invalid verified WebID");
      webId = id;
    } else webId = undefined;
    const refreshToken = processed.refresh_token ?? current?.refreshToken;
    // Restored refreshes may omit rotation. The caller supplies the original below.
    current = {
      accessToken: processed.access_token,
      refreshToken: refreshToken ?? "",
      ...(processed.id_token === undefined ? {} : { idToken: processed.id_token }),
      ...(processed.expires_in === undefined ? {} : { expiresIn: processed.expires_in }),
    };
    return current;
  };
  return {
    dpopKeyPair,
    async authorizationUrl() {
      const state: ServerAuthorizationState = {
        state: oauth.generateRandomState(),
        nonce: oauth.generateRandomNonce(),
        codeVerifier: oauth.generateRandomCodeVerifier(),
        redirectUri: options.redirectUri,
      };
      if (!as.authorization_endpoint) throw new Error("Missing authorization endpoint");
      const url = new URL(as.authorization_endpoint);
      if (url.protocol !== "https:") throw new Error("Unsafe authorization endpoint");
      url.search = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: options.redirectUri,
        response_type: "code",
        scope: "openid webid offline_access",
        state: state.state,
        nonce: state.nonce,
        code_challenge_method: "S256",
        code_challenge: await oauth.calculatePKCECodeChallenge(state.codeVerifier),
        prompt: "consent",
        dpop_jkt: await dpop.calculateThumbprint(),
      }).toString();
      return { url: url.href, state };
    },
    async handleCallback(input: { url: string }, state: ServerAuthorizationState) {
      const url = new URL(input.url);
      if (
        url.origin + url.pathname !== options.redirectUri ||
        url.hash ||
        url.username ||
        url.password ||
        state.redirectUri !== options.redirectUri
      )
        throw new Error("Pod callback mismatch");
      const parameters = oauth.validateAuthResponse(as, client, url, state.state);
      const result = await withDPoPNonceRetry(async () =>
        tokens(
          await oauth.authorizationCodeGrantRequest(
            as,
            client,
            oauth.None(),
            parameters,
            options.redirectUri,
            state.codeVerifier,
            { ...oauthOptions(http), DPoP: dpop },
          ),
          state,
        ),
      );
      return { webId: webId as string, issuer: options.issuer, tokens: result };
    },
    async refresh(refreshToken: string) {
      const result = await withDPoPNonceRetry(async () =>
        tokens(
          await oauth.refreshTokenGrantRequest(as, client, oauth.None(), refreshToken, {
            ...oauthOptions(http),
            DPoP: dpop,
          }),
        ),
      );
      if (!result.refreshToken) result.refreshToken = refreshToken;
      return result;
    },
    currentWebId: () => webId,
    async fetch(input: RequestInfo | URL, init?: RequestInit) {
      const request = new Request(input, { ...init, duplex: "half" } as RequestInit);
      const body = await replayBody(request);
      if (!current) throw new Error("No pod credentials");
      // protectedResourceRequest retains nonce state on the handle and generates new proofs.
      let attempts = 0;
      const send = async () => {
        attempts++;
        try {
          return await oauth.protectedResourceRequest(
            current!.accessToken,
            request.method,
            new URL(request.url),
            new Headers(request.headers),
            body,
            { ...oauthOptions(http, request.signal), DPoP: dpop },
          );
        } catch (error) {
          if (error instanceof oauth.WWWAuthenticateChallengeError)
            await error.response.body?.cancel();
          throw error;
        }
      };
      const response = await withDPoPNonceRetry(send);
      // Retain header-only challenges within the same two-attempt budget.
      if (attempts === 1 && response.status === 401 && response.headers.has("dpop-nonce")) {
        await response.body?.cancel();
        return send();
      }
      return response;
    },
  };
}
export type ServerOidcClient = Awaited<ReturnType<typeof createServerOidcClient>>;

/** Own and bound the body once, including cancellation before/while reading. */
async function replayBody(request: Request): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => {
    void reader?.cancel(request.signal.reason).catch(() => {});
  };
  request.signal.addEventListener("abort", abort, { once: true });
  try {
    request.signal.throwIfAborted();
    if (!reader) return null;
    for (;;) {
      const { done, value } = await reader.read();
      request.signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > SERVER_MAX_REPLAY_BODY_BYTES)
        throw new Error("Request body exceeds replay buffer cap");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (error) {
    if (!request.signal.aborted) await reader?.cancel(error);
    else if (reader && request.signal.aborted) abort();
    throw error;
  } finally {
    request.signal.removeEventListener("abort", abort);
    reader?.releaseLock();
  }
}
