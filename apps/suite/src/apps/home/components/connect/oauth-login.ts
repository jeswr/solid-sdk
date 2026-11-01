// AUTHORED-BY Codex GPT-6
import { IntegrationAuthError, type OAuthAppConfig, type TokenSet } from "@jeswr/pod-connectors";
import {
  authorize,
  buildAuthorizationUrl,
  exchangeCodeForToken,
  generatePkcePair,
  generateState,
  OAUTH_CALLBACK_PATH,
  parseCallbackUrl,
} from "@jeswr/pod-connectors/oauth";

// Captured at module initialization, before a session can install Pod auth.
export const sourceFetch: typeof fetch = globalThis.fetch.bind(globalThis);

/** Use the package popup flow first. If the browser blocks that popup, offer a
 * native link backed by a fresh PKCE request and the same callback protocol. */
export async function login(
  id: string,
  config: OAuthAppConfig,
  signal: AbortSignal,
  onBlocked: (href: string) => void,
): Promise<TokenSet> {
  signal.throwIfAborted();
  // Reserve the named popup while still inside the click gesture. The package
  // navigates this same window after asynchronous PKCE generation.
  const popup = window.open("", "pod-manager-oauth", "popup,width=520,height=720");
  let stop: (() => void) | undefined;
  try {
    const cancelled = new Promise<never>((_resolve, reject) => {
      stop = () => {
        popup?.close();
        reject(signal.reason);
      };
      signal.addEventListener("abort", stop, { once: true });
    });
    const token = await Promise.race([authorize(id, config, sourceFetch), cancelled]);
    signal.throwIfAborted();
    return token;
  } catch (error) {
    popup?.close();
    signal.throwIfAborted();
    if (!(error instanceof IntegrationAuthError) || error.reason !== "popup-blocked") throw error;
  } finally {
    if (stop) signal.removeEventListener("abort", stop);
  }
  const pair = await generatePkcePair();
  signal.throwIfAborted();
  const state = generateState();
  const redirectUri = new URL(OAUTH_CALLBACK_PATH, window.location.href).href;
  const href = buildAuthorizationUrl(config, { state, challenge: pair.challenge, redirectUri });
  const callback = await new Promise<string>((resolve, reject) => {
    const channel = new BroadcastChannel("suite-connector-oauth");
    const cleanup = () => {
      window.removeEventListener("message", message);
      signal.removeEventListener("abort", abort);
      clearTimeout(timeout);
      channel.close();
    };
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    const message = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.data?.type !== "pod-manager-oauth" ||
        typeof event.data.url !== "string"
      )
        return;
      let answer: URL;
      try {
        answer = new URL(event.data.url);
      } catch {
        return;
      }
      if (
        answer.origin !== window.location.origin ||
        answer.pathname !== OAUTH_CALLBACK_PATH ||
        answer.searchParams.get("state") !== state
      )
        return;
      cleanup();
      resolve(answer.href);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new IntegrationAuthError(id, "cancelled"));
    }, 120000);
    signal.addEventListener("abort", abort, { once: true });
    window.addEventListener("message", message);
    channel.onmessage = (event) =>
      message({ origin: window.location.origin, data: event.data } as MessageEvent);
    onBlocked(href);
  });
  signal.throwIfAborted();
  const { code } = parseCallbackUrl(id, callback, state);
  return exchangeCodeForToken(
    id,
    config,
    { code, verifier: pair.verifier, redirectUri },
    sourceFetch,
  );
}
