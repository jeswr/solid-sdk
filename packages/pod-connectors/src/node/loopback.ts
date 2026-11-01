// AUTHORED-BY Codex GPT-6.1-Sol
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { refuseRedirects } from "@jeswr/guarded-fetch";
import {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  generatePkcePair,
  generateState,
} from "../core/oauth.js";
import type { OAuthAppConfig, TokenSet } from "../core/types.js";
import { httpsUrl, NodeRuntimeError, object, textValue, validateCallbackPort } from "./errors.js";

/** Node source login supports installed-app secrets without persisting any token. */
export interface NodeOAuthConfig extends OAuthAppConfig {
  readonly clientSecret?: string;
  /** Fixed registered callback port; omitted selects an ephemeral port when supported. */
  readonly callbackPort?: number;
}

/** The host displays/opens the authorization URL; listener host and path cannot be overridden. */
export interface LoopbackLoginOptions {
  readonly openAuthorizationUrl: (url: string) => void | Promise<void>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** Source OAuth code + S256 PKCE, using an IPv4 loopback listener only. */
export async function authorizeLoopback(
  adapterId: string,
  config: NodeOAuthConfig,
  sourceFetch: typeof fetch,
  options: LoopbackLoginOptions,
): Promise<TokenSet> {
  const callbackPort =
    config.callbackPort === undefined ? undefined : validateCallbackPort(config.callbackPort);
  if (config.requiresCallbackPort && callbackPort === undefined)
    throw new NodeRuntimeError(
      "config",
      "This source requires callbackPort (1024-65535) and a matching registered redirect URI: http://127.0.0.1:<callbackPort>/oauth-callback.",
    );
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, options.timeoutMs ?? 120_000);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const server = createServer();
  try {
    // A locally configured secret is sent directly to the adapter's token endpoint.
    // Use the same selection for validation and exchange; proxy hosts keep proxy mode.
    const exchangeConfig: NodeOAuthConfig = config.clientSecret
      ? { ...config, tokenExchange: "public" }
      : config;
    textValue(exchangeConfig.clientId);
    httpsUrl(exchangeConfig.authorizationEndpoint);
    httpsUrl(exchangeConfig.tokenEndpoint);
    if (exchangeConfig.tokenExchange === "proxy") httpsUrl(exchangeConfig.tokenProxyUrl);
    const reserved = new Set([
      "response_type",
      "client_id",
      "redirect_uri",
      "scope",
      "state",
      "code_challenge",
      "code_challenge_method",
    ]);
    if (Object.keys(config.extraAuthParams ?? {}).some((key) => reserved.has(key)))
      throw new Error("Reserved OAuth parameter");
    controller.signal.throwIfAborted();
    const { verifier, challenge } = await generatePkcePair();
    const state = generateState();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port: callbackPort ?? 0, exclusive: true }, resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string" || address.address !== "127.0.0.1")
      throw new Error("Invalid listener");
    const redirectUri = `http://127.0.0.1:${address.port}/oauth-callback`;
    const authorizationUrl = buildAuthorizationUrl(config, { state, challenge, redirectUri });
    const code = await new Promise<string>((resolve, reject) => {
      const cancelled = () => reject(new Error("Login cancelled"));
      controller.signal.addEventListener("abort", cancelled, { once: true });
      const finish = (error?: Error, code?: string) => {
        controller.signal.removeEventListener("abort", cancelled);
        if (error) reject(error);
        else resolve(code as string);
      };
      server.on("request", (request, response) => {
        response.setHeader("content-type", "text/plain; charset=utf-8");
        response.setHeader("cache-control", "no-store");
        response.setHeader("referrer-policy", "no-referrer");
        response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
        if (request.method !== "GET") {
          response.writeHead(405).end("Use GET.");
          return;
        }
        if (request.headers.host !== new URL(redirectUri).host || !request.url?.startsWith("/")) {
          response.writeHead(400).end("Invalid callback.");
          return;
        }
        let callback: URL;
        try {
          callback = new URL(request.url, redirectUri);
        } catch {
          response.writeHead(400).end("Invalid callback.");
          return;
        }
        if (
          callback.origin !== new URL(redirectUri).origin ||
          callback.pathname !== "/oauth-callback"
        ) {
          response.writeHead(404).end("Not found.");
          return;
        }
        const params = callback.searchParams;
        const received = Buffer.from(params.get("state") ?? "");
        const expected = Buffer.from(state);
        if (
          params.getAll("state").length !== 1 ||
          received.length !== expected.length ||
          !timingSafeEqual(received, expected) ||
          params.has("error") ||
          params.getAll("code").length !== 1 ||
          !params.get("code")
        ) {
          response.writeHead(400).end("Authorization failed.");
          finish(new Error("Invalid authorization response"));
          return;
        }
        response.writeHead(200).end("Connected. You can close this window.");
        finish(undefined, params.get("code") as string);
      });
      if (controller.signal.aborted) cancelled();
      else
        Promise.resolve()
          .then(() => options.openAuthorizationUrl(authorizationUrl))
          .catch(finish);
    });
    const safeFetch = refuseRedirects(sourceFetch);
    const exchange: typeof fetch = async (input, init) => {
      const body = new URLSearchParams(init?.body as string);
      const headers = new Headers(init?.headers);
      if (exchangeConfig.tokenExchange === "public") headers.set("accept", "application/json");
      let requestBody: BodyInit = body;
      if (config.clientSecret) {
        if (config.tokenRequest === "basic-form" || config.tokenRequest === "basic-json") {
          // The shared exchange adds a public client's secret to the form; Basic replaces it.
          body.delete("client_secret");
          headers.set(
            "authorization",
            `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
          );
          if (config.tokenRequest === "basic-json") {
            headers.set("content-type", "application/json");
            body.delete("client_id");
            requestBody = JSON.stringify(Object.fromEntries(body));
          }
        } else body.set("client_secret", config.clientSecret);
      }
      const response = await safeFetch(input, {
        ...init,
        headers,
        body: requestBody,
        signal: controller.signal,
      });
      if (response.ok) {
        const token = object(await response.clone().json());
        textValue(token.access_token);
        if (token.token_type !== undefined && String(token.token_type).toLowerCase() !== "bearer")
          throw new Error("Invalid source token");
        if (token.refresh_token !== undefined) textValue(token.refresh_token);
        if (
          token.expires_in !== undefined &&
          (typeof token.expires_in !== "number" ||
            !Number.isFinite(token.expires_in) ||
            token.expires_in <= 0)
        )
          throw new Error("Invalid token expiry");
      }
      return response;
    };
    return await exchangeCodeForToken(
      adapterId,
      exchangeConfig,
      { code, verifier, redirectUri },
      exchange,
    );
  } catch {
    if (options.signal?.aborted) throw new NodeRuntimeError("cancelled", "Import cancelled.");
    throw new NodeRuntimeError("auth", "Source loopback login failed or timed out.");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    server.close();
    server.closeAllConnections();
  }
}
